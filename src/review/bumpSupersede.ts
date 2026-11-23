/**
 * Which of the owner's open dependency-bump pull requests are SUPERSEDED, and the evidence that says so — the
 * pure core of `github bump-drive`'s `close-superseded` act.
 *
 * The rule: when a bump of the owner's is overtaken by a Renovate pull request that merges anyway, the answer is
 * to close it. A superseded pull request open a few hours before it is closed is harmless; days or weeks
 * afterwards is a concern. MEASURED: an owner bump (`@ai-sdk/openai` to v3.0.119) stayed open for two days after
 * Renovate's pull request (`@ai-sdk/openai` to v3.0.124) merged.
 *
 * ## Two arms, each one a fact rather than a resemblance
 *
 * - **`renovate-merged`** — a Renovate pull request merged into the same base AFTER the owner's opened, bumping
 *   the same subject ({@link renovateTitleParts}) to a target at least as new. Renovate re-titles its pull
 *   request as newer versions arrive, so the merged one is usually NEWER than the re-raise copied. When either
 *   target is not a plain version (a range Renovate writes as `^0.13.0` parses; a digest or a group with no
 *   target does not), only an IDENTICAL title counts. The merge-after rule holds in every case, because a group
 *   title recurs and an old merge says nothing about a pull request raised since.
 * - **`no-diff`** — GitHub's own test merge of the owner's head into the base has exactly the base's tree, so
 *   merging it would change nothing. Read off `potentialMergeCommit`, and only believed when its parents are
 *   exactly the base's current tip and the owner's current head: a test merge computed before either moved says nothing about a base a
 *   revert has since changed. Conflicting, unknown or stale reads are `unanswerable`, never a close.
 *
 * Either arm closes only a pull request that changes dependency files and nothing else
 * ({@link changesOnlyDependencies}): a title is a resemblance, and a Renovate merge of the bare bump never carried
 * code the owner wrote beside it.
 *
 * Missing a close is the safe direction everywhere here: the next four-hourly firing asks again.
 *
 * Pure. No network, no clock.
 */

import { isBumpTitle } from "./bumpSelection.js";
import { renovateTitleParts } from "./renovateTitle.js";

/** GitHub's test merge of one pull request, as the read found it. Every oid absent when GitHub gave none. */
export interface TestMergeReading {
  /** GitHub's `mergeable`: `MERGEABLE`, `CONFLICTING` or `UNKNOWN`. */
  readonly mergeable: string;
  readonly mergeTreeOid: string | undefined;
  /** Every parent of the test merge commit, empty when there is none. */
  readonly parentOids: readonly string[];
  /** The base branch's tip, and that tip's tree, as the same read saw them. */
  readonly baseTipOid: string | undefined;
  readonly baseTipTreeOid: string | undefined;
}

/** One open pull request of the owner's, as much of it as the supersede decision reads. */
export interface OwnOpenPr {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headOid: string;
  readonly createdAtIso: string;
  readonly labels: readonly string[];
  readonly testMerge: TestMergeReading;
  /** Every path the pull request itself changes, or `past-one-page` when it changes more than one read holds. */
  readonly changedPaths: readonly string[] | "past-one-page";
}

/** One Renovate pull request merged into a repository. */
export interface MergedRenovatePr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly mergedAtIso: string;
}

/** Why one of the owner's bumps is superseded. */
export type SupersedeEvidence =
  | { readonly kind: "renovate-merged"; readonly by: MergedRenovatePr }
  | { readonly kind: "no-diff"; readonly baseOid: string };

/** What merging one pull request into its base would do, as far as GitHub's test merge can say. */
export type MergeEffect =
  | { readonly kind: "no-diff"; readonly baseOid: string }
  | { readonly kind: "changes" }
  | { readonly kind: "unanswerable"; readonly why: string };

/** A ticket prefix the fleet puts ahead of a title (`[RRRR-640] `), peeled before the bump wording is tested. */
const TICKET_PREFIX = /^\[[A-Z][A-Z0-9]*-\d+\]\s*/u;

/**
 * The security family's own title head (`../../skills/vulnerability-fix/reference/the-flywheel.md`), and only when a
 * dependency verb opens it and a target or a dependency follows — `to <version>`, `past <advisory>`, `dependency`.
 * `fix(security):` alone also heads a pull request that bumps nothing (`fix(security): document the
 * incident-response process`). MEASURED, every one of the owner's open acme-admin security titles matches; repro:
 * `slopweaver github bump-drive --repo acme/acme-admin --dry-run` reads every open bump of the owner's.
 */
const SECURITY_BUMP_HEAD =
  /^fix\(security\):\s*(?:bump|update|upgrade|re-resolve|resolve|move|pin|raise|lift|override|remove|drop)\b.*?(?:\bto\s+[v^~=]?\d|\bpast\s|\bdependenc)/iu;

/**
 * The same family's head when an acme-admin title's scope is its Linear ticket: `fix(RRRR-640):
 * clear the joi date-parsing advisory from local dev startup (CVSS 7.5)`. The outcome leads, so the verb is what
 * it clears or moves, and the advisory score `vulnerabilityForm.ts`'s schema requires is what keeps a ticketed
 * `fix` that bumps nothing out.
 */
const TICKETED_SECURITY_BUMP_HEAD =
  /^fix\([A-Z][A-Z0-9]*-\d+(?:, [A-Z][A-Z0-9]*-\d+)*\):\s*(?:clear|close|patch|bump|update|upgrade|re-resolve|resolve|move|pin|raise|lift|override|remove|drop)\b.*\(CVSS\s/u;

/**
 * Whether one of the owner's titles is a dependency bump: a Renovate-style wording or the security family's head in
 * either convention, each after any leading ticket prefixes. `[DO NOT MERGE]` is not a ticket, so a title
 * carrying it never qualifies.
 *
 * @param title the pull request's title
 * @returns true when the title leads with a bump
 */
export function isOwnBumpTitle({ title }: { title: string }): boolean {
  let rest = title.trim();
  for (let ticket = TICKET_PREFIX.exec(rest); ticket !== null; ticket = TICKET_PREFIX.exec(rest)) {
    rest = rest.slice(ticket[0].length);
  }
  return isBumpTitle({ title: rest }) || SECURITY_BUMP_HEAD.test(rest) || TICKETED_SECURITY_BUMP_HEAD.test(rest);
}

/**
 * A target token as numeric parts — `v3.0.124`, `^0.13.0`, `~2.1`, `=1` — or `undefined` for anything else.
 *
 * @param target the token after `to` in a Renovate title
 * @returns the dotted parts, or `undefined` for a digest, a prerelease or a range wider than one prefix
 */
export function parseTargetVersion({ target }: { target: string }): readonly number[] | undefined {
  const bare = target.replace(/^[\^~=]?v?/u, "");
  if (!/^\d+(?:\.\d+)*$/u.test(bare)) {
    return undefined;
  }
  const parts = bare.split(".").map(Number);
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : undefined;
}

/**
 * Whether version `a` is at least version `b`, a missing part reading as zero.
 *
 * @param a the candidate that may be newer
 * @param b the version it is compared against
 * @returns true when `a` >= `b`
 */
export function versionAtLeast({ a, b }: { a: readonly number[]; b: readonly number[] }): boolean {
  const width = Math.max(a.length, b.length);
  const padded = ({ parts }: { parts: readonly number[] }): readonly number[] =>
    Array.from({ length: width }, (_, at) => (at < parts.length ? parts[at]! : 0));
  const left = padded({ parts: a });
  const right = padded({ parts: b });
  const differs = left.findIndex((part, at) => part !== right[at]);
  if (differs === -1) {
    return true;
  }
  return left[differs]! > right[differs]!;
}

/** A title with its whitespace collapsed and case folded, so two copies of one Renovate title compare equal. */
function foldTitle({ title }: { title: string }): string {
  return title.trim().split(/\s+/u).join(" ").toLowerCase();
}

/**
 * Whether one merged Renovate pull request already did what one of the owner's does.
 *
 * @param own the owner's open pull request
 * @param merged one Renovate pull request merged into the same repository
 * @returns true when it is the same subject into the same base, merged after the owner's opened, at a target at least as new
 */
export function renovateMergeSupersedes({ own, merged }: { own: OwnOpenPr; merged: MergedRenovatePr }): boolean {
  if (merged.baseRefName !== own.baseRefName || Date.parse(merged.mergedAtIso) <= Date.parse(own.createdAtIso)) {
    return false;
  }
  const mine = renovateTitleParts({ title: own.title });
  const theirs = renovateTitleParts({ title: merged.title });
  if (mine === undefined || theirs === undefined || mine.subject.toLowerCase() !== theirs.subject.toLowerCase()) {
    return false;
  }
  const mineVersion = mine.target === undefined ? undefined : parseTargetVersion({ target: mine.target });
  const theirVersion = theirs.target === undefined ? undefined : parseTargetVersion({ target: theirs.target });
  if (mineVersion !== undefined && theirVersion !== undefined) {
    return versionAtLeast({ a: theirVersion, b: mineVersion });
  }
  return foldTitle({ title: own.title }) === foldTitle({ title: merged.title });
}

/**
 * What merging one pull request into its base would do, off GitHub's test merge.
 *
 * GitHub documents no parent ORDER for `potentialMergeCommit`, so the test is the parent SET: exactly the base's
 * current tip and the pull request's current head. Either ref having moved since GitHub computed it is a stale
 * test merge, and stale is `unanswerable`.
 *
 * @param reading the test merge as the read found it
 * @param headOid the pull request's current head
 * @returns `no-diff` only when a mergeable test merge of the current head into the current tip has that tip's tree
 */
export function mergeEffect({ reading, headOid }: { reading: TestMergeReading; headOid: string }): MergeEffect {
  if (reading.mergeable !== "MERGEABLE") {
    return { kind: "unanswerable", why: `GitHub reads it ${reading.mergeable.toLowerCase()}` };
  }
  const { mergeTreeOid, parentOids, baseTipOid, baseTipTreeOid } = reading;
  if (mergeTreeOid === undefined || baseTipOid === undefined || baseTipTreeOid === undefined) {
    return { kind: "unanswerable", why: "GitHub gave no test merge commit or no base tip" };
  }
  const parents = new Set(parentOids);
  const current = parentOids.length === 2 && parents.size === 2 && parents.has(baseTipOid) && parents.has(headOid);
  if (!current) {
    return { kind: "unanswerable", why: "GitHub's test merge is not of the current head into the current base tip" };
  }
  if (mergeTreeOid === baseTipTreeOid) {
    return { baseOid: baseTipOid, kind: "no-diff" };
  }
  return { kind: "changes" };
}

/**
 * The files only a dependency change touches: a manifest, a lockfile, the package manager's own config. MEASURED,
 * 14 of the owner's 15 open acme-admin bumps change nothing else (`package.json`, `yarn.lock`, `.yarnrc.yml`); the
 * fifteenth migrates code with its bump, and neither arm closes it: Renovate's merge of the bare bump would
 * not carry that code. Repro:
 * `slopweaver github bump-drive --repo acme/acme-admin --dry-run` — its coverage line counts both.
 */
const DEPENDENCY_FILES: ReadonlySet<string> = new Set([
  ".npmrc",
  ".yarnrc.yml",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
]);

/**
 * Whether a pull request changes dependency files and nothing else — the FACT both arms close on, because a
 * title is a resemblance and a pull request worded like a bump can change anything (for example
 * `fix(security): update dependency documentation to 2 pages`). An empty change qualifies: it carries nothing.
 *
 * @param changedPaths the pull request's own changed paths
 * @returns false for any other file, and for a list too long to have been read whole
 */
export function changesOnlyDependencies({ changedPaths }: { changedPaths: OwnOpenPr["changedPaths"] }): boolean {
  if (changedPaths === "past-one-page") {
    return false;
  }
  return changedPaths.every((path) => DEPENDENCY_FILES.has(path.slice(path.lastIndexOf("/") + 1)));
}

/**
 * Why one of the owner's open pull requests is superseded, or `undefined` when nothing says so.
 *
 * A Renovate merge is preferred over `no-diff` when both hold, because it is the one the closing comment can NAME.
 * Of several matching merges the latest is named.
 *
 * @param own the owner's open pull request
 * @param merged every Renovate pull request merged into its repository that the read returned
 * @returns the evidence, or `undefined`
 */
export function supersedeEvidence({
  own,
  merged,
}: {
  own: OwnOpenPr;
  merged: readonly MergedRenovatePr[];
}): SupersedeEvidence | undefined {
  if (!isOwnBumpTitle({ title: own.title }) || !changesOnlyDependencies({ changedPaths: own.changedPaths })) {
    return undefined;
  }
  const matches = merged
    .filter((candidate) => renovateMergeSupersedes({ merged: candidate, own }))
    .toSorted((a, b) => Date.parse(b.mergedAtIso) - Date.parse(a.mergedAtIso));
  const latest = matches[0];
  if (latest !== undefined) {
    return { by: latest, kind: "renovate-merged" };
  }
  const effect = mergeEffect({ headOid: own.headOid, reading: own.testMerge });
  if (effect.kind === "no-diff") {
    return { baseOid: effect.baseOid, kind: "no-diff" };
  }
  return undefined;
}

/** Whether a planned close still stands on what the close-time re-read found. */
export type RecheckVerdict =
  { readonly kind: "still"; readonly evidence: SupersedeEvidence } | { readonly kind: "moved"; readonly why: string };

/**
 * Whether a close planned off the pass's read still stands on the pull request as it is NOW: still open, at the
 * same head, and superseded by the same KIND of evidence — the same Renovate merge, or a current empty test merge.
 *
 * A moved head is refused outright, whichever arm: the author may have pushed more than the bump since.
 *
 * @param planned the pull request as the pass's read found it
 * @param evidence what the plan closes it on
 * @param fresh the pull request as the re-read found it, `undefined` when no longer open
 * @returns `still` with the evidence the comment should name, or `moved` with why it is not closed
 */
export function recheckSupersede({
  planned,
  evidence,
  fresh,
}: {
  planned: OwnOpenPr;
  evidence: SupersedeEvidence;
  fresh: OwnOpenPr | undefined;
}): RecheckVerdict {
  if (fresh === undefined) {
    return { kind: "moved", why: "it is no longer open" };
  }
  if (fresh.url !== planned.url) {
    return { kind: "moved", why: `the re-read answered about another pull request, ${fresh.url}` };
  }
  if (fresh.headOid !== planned.headOid) {
    return { kind: "moved", why: "its head moved since the pass read it" };
  }
  const merged = evidence.kind === "renovate-merged" ? [evidence.by] : [];
  const now = supersedeEvidence({ merged, own: fresh });
  if (now === undefined || now.kind !== evidence.kind) {
    return { kind: "moved", why: "the evidence no longer holds on a fresh read" };
  }
  return { evidence: now, kind: "still" };
}

/** How much of an oid a comment quotes. */
const SHORT_OID = 7;

/**
 * The closing comment, which names the evidence so a reader of the closed pull request never has to guess why.
 *
 * @param own the pull request being closed
 * @param evidence why it is superseded
 * @returns the comment body `github close --why` posts
 */
export function supersedeComment({ own, evidence }: { own: OwnOpenPr; evidence: SupersedeEvidence }): string {
  const tail = "Closed by the bump drive; reopen it if this is wrong.";
  if (evidence.kind === "renovate-merged") {
    const { by } = evidence;
    return (
      `Superseded by #${String(by.number)} (${by.title}), which Renovate merged into \`${by.baseRefName}\` at ` +
      `${by.mergedAtIso}, so \`${own.baseRefName}\` already carries this bump. ${tail}`
    );
  }
  return (
    `Merging this into \`${own.baseRefName}\` would change nothing: GitHub's test merge of ${own.headOid.slice(0, SHORT_OID)} ` +
    `into \`${own.baseRefName}\` at ${evidence.baseOid.slice(0, SHORT_OID)} has exactly that tip's tree, so the bump ` +
    `is already there. ${tail}`
  );
}
