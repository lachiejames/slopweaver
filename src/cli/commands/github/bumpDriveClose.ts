/**
 * `github bump-drive`'s `close-superseded` act: read the owner's open pull requests and Renovate's merges, decide which of
 * the owner's bumps are superseded, and close each through `github close` with a comment naming why.
 *
 * A superseded pull request may stay open for a few hours, never days or weeks, so the act rides the existing
 * bump job rather than a new one. The
 * four-hourly `bump-drive-<repo>` rows fire this verb, so a Renovate merge is answered within one cadence. The
 * evidence rule is `../../../review/bumpSupersede.ts`; this module only reads, sequences and writes.
 *
 * **Only the owner's pull requests.** The read is `viewer.pullRequests`, so a bot's or a colleague's pull request can never
 * be closed here: a Renovate bump closes itself, and anybody else's is theirs to close.
 */

import { githubToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { readMergedRenovatePrs, readOwnOpenPrs } from "../../../live/github/supersedeReads.js";
import { recheckOwnPr } from "../../../live/github/supersedeRecheck.js";
import type { DependencyBotActors } from "../../../organisation/dependencyBots.js";
import {
  changesOnlyDependencies,
  isOwnBumpTitle,
  type MergedRenovatePr,
  type OwnOpenPr,
  recheckSupersede,
  type SupersedeEvidence,
  supersedeComment,
  supersedeEvidence,
} from "../../../review/bumpSupersede.js";
import { EXIT_OK } from "../../exitCodes.js";
import { bumpCloseLedgerRow } from "./bumpDriveLedger.js";
import type { BumpDriveOutcome } from "./bumpDriveReport.js";
import { BUMP_CLOSE_CAP } from "./bumpDriveUsage.js";
import { type GithubCloseDeps, productionGithubCloseDeps, runGithubClose } from "./closeRun.js";

/** One of the owner's pull requests this pass closes, and why. */
export interface SupersedeClose {
  readonly own: OwnOpenPr;
  readonly evidence: SupersedeEvidence;
  /** Past this pass's {@link BUMP_CLOSE_CAP}, so the next firing takes it. */
  readonly capped: boolean;
}

/** What one repository's supersede pass decided, and every read it could not complete. */
export interface SupersedePlan {
  readonly closes: readonly SupersedeClose[];
  /** What the pass read, then one line per read that failed or arm that did not run, for the report. */
  readonly notes: readonly string[];
}

/**
 * The key one pull request is matched on between this pass and the ladder, case-folded because the two reads
 * spell a repository each in its own way.
 *
 * @param repoSlug `owner/name`
 * @param number the pull request's number
 * @returns `owner/name#n`, lower-cased
 */
export function supersedeKey({ repoSlug, number }: { repoSlug: string; number: number }): string {
  return `${repoSlug.toLowerCase()}#${String(number)}`;
}

/** The coverage line: how many of the owner's open bumps the whole read found, and how many are superseded. */
function coverageNote({
  repoSlug,
  own,
  closes,
}: {
  repoSlug: string;
  own: readonly OwnOpenPr[];
  closes: readonly SupersedeClose[];
}): string {
  const bumps = own.filter((pr) => isOwnBumpTitle({ title: pr.title }));
  const dependencyOnly = bumps.filter((pr) => changesOnlyDependencies({ changedPaths: pr.changedPaths })).length;
  return (
    `${repoSlug}: ${String(bumps.length)} open bump(s) of the owner's, ${String(dependencyOnly)} changing only dependency ` +
    `files, of ${String(own.length)} open pull request(s) read whole; ${String(closes.length)} superseded`
  );
}

/** The seams the close act adds to the drive's own. */
export interface BumpCloseDeps {
  /** Every open pull request of the owner's in one repository, with GitHub's test merge. */
  readonly ownOpenPrs: (args: { home: string | undefined; repoSlug: string }) => Promise<Result<readonly OwnOpenPr[]>>;
  /**
   * Every pull request one of `authors` merged into one repository since an instant — each author a Renovate
   * identity as search spells it, `app/<login>`.
   */
  readonly mergedRenovatePrs: (args: {
    home: string | undefined;
    repoSlug: string;
    sinceIso: string;
    authors: readonly string[];
  }) => Promise<Result<readonly MergedRenovatePr[]>>;
  /** Re-read one pull request just before it is closed: `undefined` when it is no longer open. */
  readonly recheckPr: (args: {
    home: string | undefined;
    repoSlug: string;
    number: number;
  }) => Promise<Result<OwnOpenPr | undefined>>;
  /** Close one pull request through `github close`. Returns its exit code. */
  readonly closePr: (args: { rest: readonly string[]; quiet: boolean }) => Promise<number>;
  readonly recordAutonomy: (args: {
    home: string | undefined;
    row: ReturnType<typeof bumpCloseLedgerRow>;
  }) => Promise<string | undefined>;
  readonly sessionRef: () => string;
  readonly now: () => Date;
}

/**
 * Decide every close for one repository's reads.
 *
 * An opt-out label holds a pull request back from this act as it does from every other.
 *
 * @param own the owner's open pull requests in the repository
 * @param merged Renovate's merges into it
 * @param optOutLabels labels that hold a pull request back, lower-cased
 * @returns one entry per superseded pull request, oldest first, each saying whether this pass's cap reaches it
 */
export function planSupersedeCloses({
  own,
  merged,
  optOutLabels,
}: {
  own: readonly OwnOpenPr[];
  merged: readonly MergedRenovatePr[];
  optOutLabels: readonly string[];
}): readonly SupersedeClose[] {
  const closes: SupersedeClose[] = [];
  const oldestFirst = own.toSorted((a, b) => a.number - b.number);
  for (const pr of oldestFirst) {
    if (pr.labels.some((label) => optOutLabels.includes(label.toLowerCase()))) {
      continue;
    }
    const evidence = supersedeEvidence({ merged, own: pr });
    if (evidence !== undefined) {
      closes.push({ capped: closes.length >= BUMP_CLOSE_CAP, evidence, own: pr });
    }
  }
  return closes;
}

/**
 * Read one repository and decide its closes. A failed open read closes nothing; a failed merged read leaves the
 * `no-diff` arm, which needs no merged list. Either is named in `notes`.
 *
 * @param repoSlug `owner/name`
 * @param home the state home whose credential reads
 * @param optOutLabels labels that hold a pull request back, lower-cased
 * @param deps the two read seams
 * @param bots the dependency-bot identities this install recognises, whose Renovate merges are searched
 * @returns the closes and the notes
 */
export async function readSupersedePlan({
  repoSlug,
  home,
  optOutLabels,
  deps,
  bots,
}: {
  repoSlug: string;
  home: string | undefined;
  optOutLabels: readonly string[];
  deps: Pick<BumpCloseDeps, "ownOpenPrs" | "mergedRenovatePrs">;
  bots: DependencyBotActors;
}): Promise<SupersedePlan> {
  const own = await deps.ownOpenPrs({ home, repoSlug });
  if (own.isErr()) {
    return { closes: [], notes: [`${repoSlug}: closed nothing superseded — ${own.error.join("; ")}`] };
  }
  const sinceIso = own.value.map((pr) => pr.createdAtIso).toSorted()[0];
  if (sinceIso === undefined) {
    return { closes: [], notes: [coverageNote({ closes: [], own: [], repoSlug })] };
  }
  const merged = await deps.mergedRenovatePrs({ authors: bots.renovateSearchAuthors, home, repoSlug, sinceIso });
  if (merged.isErr()) {
    const closes = planSupersedeCloses({ merged: [], optOutLabels, own: own.value });
    return {
      closes,
      notes: [
        coverageNote({ closes, own: own.value, repoSlug }),
        `${repoSlug}: Renovate's merges could not be read, so only the no-diff arm ran — ${merged.error.join("; ")}`,
      ],
    };
  }
  const closes = planSupersedeCloses({ merged: merged.value, optOutLabels, own: own.value });
  return { closes, notes: [coverageNote({ closes, own: own.value, repoSlug })] };
}

/**
 * The `github close` argv for one close. It names the head the close-time re-read judged, so `github close`'s
 * own read — the last before the comment and the close — refuses a pull request pushed to since.
 *
 * @param close the pull request and its evidence
 * @param home the state home the close's credential and door use
 * @returns the argv after `github close`
 */
export function closeArgv({ close, home }: { close: SupersedeClose; home: string | undefined }): readonly string[] {
  return [
    "--repo",
    close.own.repoSlug,
    "--number",
    String(close.own.number),
    "--expect-head",
    close.own.headOid,
    "--why",
    supersedeComment({ evidence: close.evidence, own: close.own }),
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/** The one-line reason, as the report prints it. */
function evidenceLine({ evidence }: { evidence: SupersedeEvidence }): string {
  if (evidence.kind === "renovate-merged") {
    return `superseded by Renovate's #${String(evidence.by.number)}, merged ${evidence.by.mergedAtIso}`;
  }
  return `merging it into its base would change nothing (base at ${evidence.baseOid.slice(0, 7)})`;
}

/** The identity fields of one close's outcome. */
function outcomeBase({ close }: { close: SupersedeClose }): Omit<BumpDriveOutcome, "detail" | "outcome"> {
  return {
    act: "close-superseded",
    number: close.own.number,
    repoSlug: close.own.repoSlug,
    signal: "title",
    url: close.own.url,
  };
}

/**
 * Re-read one planned close's pull request and re-judge it, so no close stands on the pass's earlier read: the
 * base may have moved, or the owner may have pushed, between the plan and this close.
 */
async function recheckedClose({
  close,
  deps,
  home,
}: {
  close: SupersedeClose;
  deps: Pick<BumpCloseDeps, "recheckPr">;
  home: string | undefined;
}): Promise<
  | { readonly kind: "close"; readonly close: SupersedeClose }
  | { readonly kind: "held"; readonly outcome: BumpDriveOutcome }
> {
  const fresh = await deps.recheckPr({ home, number: close.own.number, repoSlug: close.own.repoSlug });
  if (fresh.isErr()) {
    const detail = `not closed — the close-time re-read failed: ${fresh.error.join("; ")}`;
    return { kind: "held", outcome: { ...outcomeBase({ close }), detail, outcome: "failed" } };
  }
  const verdict = recheckSupersede({ evidence: close.evidence, fresh: fresh.value, planned: close.own });
  if (verdict.kind === "moved") {
    const detail = `not closed — superseded on the pass's read, but ${verdict.why}`;
    return { kind: "held", outcome: { ...outcomeBase({ close }), detail, outcome: "skipped" } };
  }
  return { close: { ...close, evidence: verdict.evidence }, kind: "close" };
}

/**
 * Perform, or describe, one close, and record a performed one on the autonomy ledger.
 *
 * @param planned the pull request and its evidence, as the pass's read found them
 * @param deps the re-read, close and ledger seams
 * @param home the state home
 * @param dryRun describe rather than act
 * @param quiet keep the child verb's prose off stdout
 * @returns the outcome line
 */
async function performClose({
  planned,
  deps,
  home,
  dryRun,
  quiet,
}: {
  planned: SupersedeClose;
  deps: Pick<BumpCloseDeps, "recheckPr" | "closePr" | "recordAutonomy" | "sessionRef" | "now">;
  home: string | undefined;
  dryRun: boolean;
  quiet: boolean;
}): Promise<BumpDriveOutcome> {
  if (planned.capped) {
    return {
      ...outcomeBase({ close: planned }),
      detail: `this pass's cap of ${String(BUMP_CLOSE_CAP)} close(s) was already reached — the next firing takes it`,
      outcome: "skipped",
    };
  }
  if (dryRun) {
    const would = evidenceLine({ evidence: planned.evidence });
    return { ...outcomeBase({ close: planned }), detail: `would close: ${would}`, outcome: "would-act" };
  }
  const rechecked = await recheckedClose({ close: planned, deps, home });
  if (rechecked.kind === "held") {
    return rechecked.outcome;
  }
  const { close } = rechecked;
  const why = evidenceLine({ evidence: close.evidence });
  const code = await deps.closePr({ quiet, rest: closeArgv({ close, home }) });
  if (code !== EXIT_OK) {
    return {
      ...outcomeBase({ close }),
      detail: `\`github close\` refused it — its own lines are printed above; ${why}`,
      outcome: "failed",
    };
  }
  const unledgered = await deps.recordAutonomy({
    home,
    row: bumpCloseLedgerRow({ atIso: deps.now().toISOString(), bySession: deps.sessionRef(), close, why }),
  });
  if (unledgered !== undefined) {
    return {
      ...outcomeBase({ close }),
      detail: `closed it (${why}), but the AUTONOMY ledger row could not be written (${unledgered})`,
      outcome: "acted",
    };
  }
  return { ...outcomeBase({ close }), detail: `closed it with a comment: ${why}`, outcome: "acted" };
}

/** What the whole supersede pass did across every repository this firing read. */
export interface SupersedePassResult {
  readonly outcomes: readonly BumpDriveOutcome[];
  readonly notes: readonly string[];
  /**
   * {@link supersedeKey} of every superseded pull request, capped and failed ones included, which the ladder then
   * leaves alone: pressing a superseded bump to merge is the one wrong act left on it.
   */
  readonly closing: ReadonlySet<string>;
}

/**
 * Read, decide and close for every repository, before the ladder runs.
 *
 * @param repos the repositories this firing read
 * @param home the state home
 * @param optOutLabels labels that hold a pull request back, lower-cased
 * @param dryRun describe rather than act
 * @param quiet keep the child verb's prose off stdout
 * @param deps the read, close and ledger seams
 * @param bots the dependency-bot identities this install recognises, whose Renovate merges are searched
 * @returns every outcome, every note, and the set the ladder skips
 */
export async function runSupersedePass({
  repos,
  home,
  optOutLabels,
  dryRun,
  quiet,
  deps,
  bots,
}: {
  repos: readonly string[];
  home: string | undefined;
  optOutLabels: readonly string[];
  dryRun: boolean;
  quiet: boolean;
  deps: BumpCloseDeps;
  bots: DependencyBotActors;
}): Promise<SupersedePassResult> {
  const outcomes: BumpDriveOutcome[] = [];
  const notes: string[] = [];
  const closing = new Set<string>();
  for (const repoSlug of repos) {
    const plan = await readSupersedePlan({ bots, deps, home, optOutLabels, repoSlug });
    notes.push(...plan.notes);
    for (const close of plan.closes) {
      closing.add(supersedeKey(close.own));
      outcomes.push(await performClose({ deps, dryRun, home, planned: close, quiet }));
    }
  }
  return { closing, notes, outcomes };
}

/* The production edges: the two live reads, each on the credential of the home asked about, and `github close`
 * run in process so the door records the transition. */

/** The GraphQL seam authenticated with the credential of one state home. */
function graphqlFor({ home }: { home: string | undefined }): ReturnType<typeof githubReadGraphql> {
  return githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) });
}

/**
 * Production close-act edges.
 *
 * @returns the open read, the merged read across every Renovate identity, the close-time re-read, and the in-process close
 */
export function productionBumpCloseDeps(): Pick<
  BumpCloseDeps,
  "ownOpenPrs" | "mergedRenovatePrs" | "closePr" | "recheckPr"
> {
  const closeDeps = productionGithubCloseDeps();
  const quietDeps: GithubCloseDeps = {
    ...closeDeps,
    out: (line) => {
      logger.warn({ msg: line });
    },
  };
  return {
    closePr: ({ rest, quiet }) => runGithubClose({ deps: quiet ? quietDeps : closeDeps, rest }),
    mergedRenovatePrs: async ({ home, repoSlug, sinceIso, authors }) => {
      const graphql = graphqlFor({ home });
      const merged: MergedRenovatePr[] = [];
      for (const author of authors) {
        const read = await readMergedRenovatePrs({ author, graphql, repoSlug, sinceIso });
        if (read.isErr()) {
          return err([read.error.message]);
        }
        merged.push(...read.value);
      }
      return ok(merged);
    },
    ownOpenPrs: async ({ home, repoSlug }) =>
      (await readOwnOpenPrs({ graphql: graphqlFor({ home }), repoSlug })).mapErr((failure) => [failure.message]),
    recheckPr: async ({ home, repoSlug, number }) =>
      (await recheckOwnPr({ graphql: graphqlFor({ home }), number, repoSlug })).mapErr((failure) => [failure.message]),
  };
}
