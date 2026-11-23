/**
 * The pass ledger — answering "which passes ran on this branch, and are they still current?".
 *
 * The absence this fills: 247 immutable run directories existed on the author's machine with no way to query
 * them, so a loop that skipped its plan and all three reviews did so in complete silence. Nobody noticed
 * until the PR had merged. A ledger does not make skipping impossible; it makes it VISIBLE, which is the
 * thing that has to exist before any gate can be built on top.
 *
 * DERIVED, never stored. There is no index file to fall out of date, to lock, or to lose an update from when
 * two sessions run passes at once — the run directories are the source of truth and this is a scan over them.
 * That is the same shape as the corpus tiers: an append-only bronze and free, rebuildable views above it.
 *
 * Pure. The caller supplies the already-read records and the tree to compare against, so every classification
 * rule here is unit-testable without a filesystem.
 */

import { isRecord } from "#lib/parsers.js";
import { carriedReviewReason } from "./diffCarry.js";
import { sameTree, shortDigest, type TreeFingerprint } from "./fingerprint.js";
import { cappedPlanNextStep } from "./ledgerCapClauses.js";
import { concluded, newestFaultClause } from "./ledgerNewestClauses.js";
import { reviewHalf } from "./ledgerReviewHalf.js";
import { formatPassOutcomeContext } from "./outcomeContext.js";
import type { CodexQuotaEvidence } from "./quotaTypes.js";
import type { ReviewLeftover } from "./reviewLeftovers.js";
import type { Supersession } from "./supersession.js";
import type { CodexArtifactRecord, CodexPassId, CodexPassScope, CodexPassTree } from "./types.js";
import { toUnplaceable, type UnplaceableRecord, wordingRetirement } from "./unplaceable.js";

/** Whether a recorded pass still describes the tree in front of us. */
export type PassFreshness =
  /**
   * The verdict still applies: the tree has not moved since the pass read it, or — for a REVIEW only — the tree
   * moved and the diff it judged did not ({@link freshnessOf}). `reason` is present exactly in the second case,
   * so a carried row never reads as an ordinary one.
   */
  | { readonly kind: "current"; readonly reason?: string }
  /** The tree moved. The verdict describes code that no longer exists. */
  | { readonly kind: "stale"; readonly reason: string }
  /**
   * The pass predates tree provenance, or capture failed.
   *
   * Deliberately NOT folded into `stale`. "We cannot tell" and "we checked and it moved" are different facts,
   * and a gate that treats the first as the second would reject every artifact written before this feature
   * existed while claiming to have detected drift.
   */
  | { readonly kind: "unknown"; readonly reason: string };

/** One row of the ledger: what ran, what it concluded, and whether it still counts. */
export interface LedgerEntry {
  readonly artifactId: string;
  readonly pass: CodexPassId;
  readonly createdAtIso: string;
  /** The property id for a review pass; `undefined` for a planning pass, which reviews no single claim. */
  readonly propertyId: string | undefined;
  /**
   * Which ARM this pass belongs to, taken from the record's own `scope.mode`.
   *
   * Not derived from {@link pass}'s `p`/`r` prefix, which is what {@link loopFailures} used to read. The two
   * agree in every record the tool writes, but `scanPassRecords` shallow-decodes disk JSON, so a record
   * pairing `pass: "p1"` with `mode: "review"` parses fine — and a prefix test then counted it as the plan
   * the floor requires. Found by a Codex review of this gate.
   */
  readonly mode: CodexPassScope["mode"];
  /** The verdict as recorded — `READY`, `BROKEN`, `CLEAN`, `NO_VERDICT:<reason>`, or a fault. */
  readonly verdict: string;
  readonly freshness: PassFreshness;
  /** Composed from the record's own outcome/attempts/salvage — see `outcomeContext.ts`. `undefined` for a clean first-try result, which needs no extra context. */
  readonly outcomeContext: string | undefined;
  /**
   * The retirement standing against this pass, when one does — see `./supersession.ts`.
   *
   * A retired pass is never removed and never hidden. It keeps its row, its verdict and its freshness, and
   * gains this; only the landing gate stops counting it. That visibility is the property the owner's ruling
   * chose this shape FOR, over reading only the latest verdict per property id, which would
   * have let a softened re-run bury a real finding with nothing on the page to show it happened.
   */
  readonly superseded: Supersession | undefined;
  /**
   * Who performed the pass. `codex` for every pass record under `orchestration/`; `claude-code` for a
   * fallback review receipt (`./fallbackReview.ts`), which stands in a review slot only because Codex was
   * capped when the review was needed. Rendered on the row and never collapsed, so a reader can see which
   * brain read the diff. The floor judges the two by the same freshness and verdict rules.
   */
  readonly provider: LedgerProvider;
  /**
   * What sent a `claude-code` row to Claude: `cap` (Codex could not take the pass), `cyber-policy` (Codex
   * refused the review on policy twice, `./policyFallback.ts`) or `codex-provider-unregistered` (no Codex plan
   * is registered, `./providerUnregistered.ts`). Absent on a `codex` row. Read so only a `cap` receipt is ever
   * taken as a cap witness — neither other ground says anything about Codex's capacity.
   */
  readonly fallbackGround?: FallbackGroundKind;
  /**
   * Whether this pass FAILED on a Codex usage cap — a `fatal` outcome whose transport cause classified to a
   * quota kind. Carried so each half of the floor can name its way through when the newest row is a cap
   * rather than a finding: a Claude fallback review for the review half, the reasoned
   * `codex-loop-incomplete` acknowledgement for the plan half.
   */
  readonly capped: boolean;
  /**
   * The sha256 of the diff a REVIEW row judged — the identity of one review PASS (`./reviewPassCap.ts`), so
   * every property of a fan-out, r1/r2/r3 over one diff, a retry and a carried rebase are one pass and a fix
   * that changes the diff is the next. `undefined` on a plan row, which reads no diff.
   */
  readonly diffSha256: string | undefined;
  /** A review answer's own one-line summary, printed beside a named leftover; `undefined` when none was answered. */
  readonly reviewSummary: string | undefined;
}

/** Which ground sent a Claude fallback row to Claude. See {@link LedgerEntry.fallbackGround}. */
export type FallbackGroundKind = "cap" | "cyber-policy" | "codex-provider-unregistered";

/** Which brain a ledger row records. See {@link LedgerEntry.provider}. */
type LedgerProvider = "codex" | "claude-code";

/**
 * Whether a persisted provenance field is usable at all.
 *
 * Takes `unknown` on purpose. The TYPES declare these as strings, but `isRecordShaped` (`./ledgerStore.ts`)
 * checks five top-level fields and never looks inside `tree`, so the declared type asserts more than was ever
 * checked and a `null` or `""` from disk reaches here typed as `string`. Every such value compares unequal to
 * a real digest, which would read as measured drift — the one thing this module must never fake.
 *
 * Checks the SHAPE, not merely that something is there. `"x"` is a non-empty string and is not a digest, and
 * every value that is not one compares unequal to a real digest — which would read as measured drift, the one
 * thing this module must never fake. The caller says which WIDTH it expects, because the two fields differ
 * and accepting either for both is looser than the data: a git object name is 40 lowercase hex characters, a
 * tree fingerprint is a 64-character sha256, and a 40-character "fingerprint" is not one. Found by a Codex
 * review of the first, single-bound version.
 *
 * A type predicate, so a guarded field narrows to `string` for the comparison below. Predicates cannot take a
 * destructured object at all — TypeScript refuses it with TS1230 — which is the compiler's decision rather
 * than an exception to the named-object-params rule (`.claude/rules/typescript-patterns.md` says so).
 *
 * @returns true only for a lowercase-hex digest of exactly the expected width
 */
function isDigest(value: unknown, width: 40 | 64): value is string {
  return typeof value === "string" && value.length === width && /^[0-9a-f]+$/.test(value);
}

/**
 * The verdict as a single token, matching what the CLI prints.
 *
 * Reads the outcome rather than inferring anything from the exit code. That distinction is load-bearing
 * everywhere in this system: a `BROKEN` review exits 0, because a review that finds a defect succeeded.
 *
 * @param record the pass record
 * @returns the verdict token
 */
export function verdictOf({ record }: { record: CodexArtifactRecord }): string {
  const outcome = record.outcome;
  if (outcome.kind === "answered") {
    // Both arms carry `verdict`; the plan/review distinction is already in `scope.mode`, not repeated here.
    return outcome.answer.verdict;
  }
  if (outcome.kind === "no-verdict") {
    return `NO_VERDICT:${outcome.reason}`;
  }
  return `FATAL:${outcome.kind}`;
}

/**
 * Classify one recorded pass against the tree as it stands now.
 *
 * ## A review whose DIFF did not move is still current, and that is `./duplicate.ts`'s own key
 *
 * The duplicate-pass gate keys a review on diff + property + pass and deliberately not on the tree, because
 * a conflict-free rebase changes every SHA and no reviewed byte (the rebase is the
 * common case of duplicate spend). Keying the floor on the TREE would call every review STALE after
 * such a rebase while the gate refused to re-run one: `github enqueue`
 * would refuse `codex-loop-incomplete`, and `codex review` would refuse as a duplicate until the hatch was set.
 *
 * So a STALE review is lifted to current when `diffsNow` says the tree being judged produces, against the
 * record's own base ref, the diff whose sha256 the record carries — the one question on which the two gates
 * now agree. Nothing else is lifted: a plan has no diff and its floor WANTS stale, `unknown` has no
 * provenance to lift from, and a base ref missing from `diffsNow` (capture failed, or was never taken)
 * leaves the row stale, never current.
 *
 * @param record the pass record
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @param diffsNow base ref → sha256 of the diff the tree being judged produces against it; omitted means none
 *   was taken, so nothing is lifted
 * @returns whether the pass's verdict still describes the current tree
 */
export function freshnessOf({
  record,
  now,
  diffsNow,
}: {
  record: CodexArtifactRecord;
  now: TreeFingerprint | undefined;
  diffsNow?: ReadonlyMap<string, string> | undefined;
}): PassFreshness {
  const tree = record.tree;
  if (tree === undefined) {
    return { kind: "unknown", reason: "the pass recorded no tree provenance" };
  }
  const byTree = treeFreshness({ now, tree });
  if (byTree.kind !== "stale") {
    return byTree;
  }
  const reason = carriedReviewReason({ diffsNow, record, staleReason: byTree.reason });
  return reason === undefined ? byTree : { kind: "current", reason };
}

/**
 * Classify one RECORDED TREE against the tree as it stands now.
 *
 * The half of {@link freshnessOf} that does not care where the tree came from, so a fallback review receipt
 * (`./fallbackReview.ts`) is judged by exactly the rule a pass record is — same digest checks, same reasons.
 *
 * @param tree the tree a pass or a receipt recorded when it started
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @returns whether a verdict over `tree` still describes the current tree
 */
export function treeFreshness({ tree, now }: { tree: CodexPassTree; now: TreeFingerprint | undefined }): PassFreshness {
  if (now === undefined) {
    return { kind: "unknown", reason: "the current tree could not be read" };
  }
  // A record predating the tree object cannot be compared at all. Substituting a placeholder would make it
  // compare unequal and print STALE — asserting we checked and found drift, when we checked nothing. This is
  // the same distinction the type draws, violated once already by a `?? ""` the house lint rule caught.
  //
  // `=== undefined` is not the test, because `isRecordShaped` never inspects `tree`: a persisted `null`, or an
  // empty string, is equally unusable and equally accepted by the decoder. Anything that is not a non-empty
  // string is provenance we do not have. Found by a Codex review, which forged `treeSha: null`.
  if (!isDigest(tree.treeSha, GIT_OBJECT_HEX)) {
    return { kind: "unknown", reason: "the pass predates content-addressed provenance" };
  }
  // The same argument for the DIGEST, which the TYPE says is always present and disk JSON does not guarantee:
  // `isRecordShaped` (`./ledgerStore.ts`) checks five top-level fields and never inspects `tree` at all, so a
  // record with a `tree` object and no `fingerprint` is accepted and the declared type is asserting more than
  // was checked. Such a record compares unequal and would print STALE — drift nobody measured. Survivable
  // while STALE only meant "do not cite this"; the plan floor made STALE a positive REQUIREMENT, so an
  // unguarded miss hands the gate the one thing it asks for. Found by a Codex review of this gate.
  //
  // Read through `unknown` deliberately: comparing the declared `string` against `undefined` is a condition
  // the type-checker calls impossible, and the honest fix is to stop claiming the type knows.
  if (!isDigest(tree.fingerprint, SHA256_HEX)) {
    return { kind: "unknown", reason: "the pass recorded no tree digest, so drift cannot be measured" };
  }
  const recorded = {
    digest: tree.fingerprint,
    dirtyBytes: tree.dirtyBytes,
    headSha: tree.headSha,
    treeSha: tree.treeSha,
  };
  if (sameTree({ after: now, before: recorded })) {
    return { kind: "current" };
  }
  return { kind: "stale", reason: driftReason({ now, tree }) };
}

/**
 * What moved between a recorded tree and the one being judged, in words true in BOTH places it is read.
 *
 * A pass that read uncommitted bytes, judged against a tree carrying none on the same commit, gets its own
 * sentence. In a checkout the edits were discarded; at a landing, which judges the clean head commit, they were
 * never committed. "The working tree changed after the pass read it" was false at the landing, and it was the
 * only explanation the refusal could have given (`./checkoutLandingFloor.ts` carries that measurement).
 *
 * @param tree the tree the pass recorded, its digests already shape-checked
 * @param now the tree being judged
 * @returns the reason the two differ
 */
function driftReason({ tree, now }: { tree: CodexPassTree; now: TreeFingerprint }): string {
  if (tree.treeSha !== now.treeSha) {
    return `the committed tree changed after the pass read it (HEAD now ${shortDigest({ value: now.headSha })})`;
  }
  // Through `unknown`: `isRecordShaped` never inspects `tree`, so a count from disk is not known to be a number.
  const readBytes: unknown = tree.dirtyBytes;
  if (now.dirtyBytes === 0 && typeof readBytes === "number" && readBytes > 0) {
    return (
      `the pass read ${String(readBytes)} byte(s) of uncommitted change on top of HEAD ` +
      `${shortDigest({ value: now.headSha })}, and the tree being judged carries none of it`
    );
  }
  return "the working tree changed after the pass read it";
}

/**
 * Build the ledger for one CHECKOUT's branch.
 *
 * Records with no branch — a detached HEAD, or a pass predating provenance — are excluded from a branch query
 * rather than silently attributed to it, and the unattributed count is reported separately so an absence is
 * never mistaken for a clean answer.
 *
 * ## Why the repository root is part of the key, when it deliberately was not
 *
 * This filtered on branch ALONE until the plan floor landed, and the reasoning was sound at the time: a branch
 * can be checked out in more than one worktree, and the question a gate asks is about the pull request, which
 * is the branch. What changed is that {@link loopFailures} now has a floor a tree fingerprint cannot police.
 * Every review must be CURRENT, and a fingerprint is unforgeable across checkouts — but a plan must NOT be
 * current (see there), so with branch as the only key, a plan run against a completely different repository
 * that happens to use the same branch name satisfies the plan floor. `record.repoRoot` closes that, costs no
 * schema change because it was always persisted, and a worktree has its own root, which is the grain the rest
 * of this repository already works at.
 *
 * The trade, stated rather than discovered: planning in one worktree and landing the same branch from another
 * reports NOT RUN. That is the honest answer for a query ABOUT ONE CHECKOUT — `codex status` and
 * `codex supersede`, which are the two callers left asking that question.
 *
 * **The LANDING floor stopped asking it, and that is where the trade was actually being paid.** A session
 * dispatched to press a pull request stands in neither worktree, so it failed this filter every time and the
 * floor became a thing acknowledged on every press. `./landingGateRun.ts` now folds one of these ledgers per
 * checkout that HOLDS the pull request's head commit, which is a stronger answer to the same question this
 * key was introduced for — a plan from an unrelated repository sharing a branch name is excluded because that
 * repository does not have the commit, not because its path is spelled differently.
 *
 * @param records every pass record that could be read
 * @param repoRoot the checkout the query is about — a worktree has its own root, which is the right grain
 * @param branch the branch to report on
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @param supersessions retired wordings, keyed by artifact id; omitted means none are known
 * @param fallbackEntries Claude fallback review rows ALREADY folded for this checkout and branch by
 *   `fallbackReviewEntries` (`./fallbackReview.ts`); omitted means none are known. Folded by the caller so
 *   this module never imports the receipt shape, and merged HERE so every consumer of the ledger — the
 *   status report, both landing verbs and `codex supersede` — sees one list judged by one set of rules.
 *   Retirements are applied to these rows HERE too, keyed by receipt id, because a receipt IS a review row
 *   and a row the floor counts must be a row `codex supersede` can retire
 * @param diffsNow base ref → sha256 of the diff the tree being judged produces against it, for the refs
 *   `reviewBaseRefs` (`./diffCarry.ts`) names; omitted means none was taken. See {@link freshnessOf}
 * @returns the matching entries, newest first
 */
export function ledgerForBranch({
  records,
  repoRoot,
  branch,
  now,
  supersessions,
  fallbackEntries = [],
  diffsNow,
}: {
  records: readonly CodexArtifactRecord[];
  repoRoot: string;
  branch: string;
  now: TreeFingerprint | undefined;
  supersessions?: ReadonlyMap<string, Supersession>;
  fallbackEntries?: readonly LedgerEntry[];
  diffsNow?: ReadonlyMap<string, string>;
}): BranchLedger {
  const mine = records.filter((record) => record.repoRoot === repoRoot);
  const entries = [
    ...mine
      .filter((record) => record.tree?.branch === branch)
      .map((record) => ({
        ...toEntry({ diffsNow, now, record }),
        superseded: wordingRetirement({ row: supersessions?.get(record.artifactId) }),
      })),
    // A fallback receipt is folded with `superseded: undefined` — its folder holds no register — and is
    // marked HERE, at the one merge point, by the same lookup a pass record gets. MEASURED: a
    // BROKEN receipt stood CURRENT on a branch with a CLEAN receipt under the same property beside it, and
    // the landing floor refused forever because no row could ever be marked retired.
    ...fallbackEntries.map((entry) => ({
      ...entry,
      superseded: wordingRetirement({ row: supersessions?.get(entry.artifactId) }),
    })),
  ]
    // Newest first, tie-broken by artifact id. The tie-break is not cosmetic: `createdAtIso` is millisecond
    // resolution and two passes launched together can land on the same one, which left the order as whatever
    // the directory scan happened to yield — and {@link loopFailures} reads the FIRST conclusive plan as the
    // latest word. Found by a Codex review of this gate: a READY and a BLOCKED plan sharing a timestamp could
    // report the loop complete or refuse it depending on nothing at all.
    .toSorted((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId));
  // Records that RAN but carry no branch. Dropping these silently was a real defect, found by a Codex
  // review asking whether the ledger could ever under-report: tree capture is best-effort, so a pass in a
  // repository too large to diff persists a perfectly valid record with no `tree` — and the filter above
  // then made it vanish, printing NOT RUN for work that happened. Counting them cannot say WHICH branch
  // they belong to, but "5 passes ran somewhere and could not be attributed" is a true sentence, and
  // silence is not.
  //
  // `== null` catches BOTH shapes, and the loose comparison is the point: `tree` absent (capture failed) and
  // `tree.branch === null` (a pass run on a detached HEAD, which `CodexPassTree` types explicitly) are the
  // same fact to a reader — it ran, and it cannot be placed. Counting only the first left a detached-HEAD
  // record in neither `entries` nor this total, so it vanished exactly as the original defect did. A second
  // Codex review found it, once the landing guard started FAILING CLOSED on this count.
  const unattributed = mine.filter((record) => record.tree?.branch == null).length;
  const unplaceable = unplaceableIn({ branch, mine, supersessions });
  const unknowable = unplaceable.filter((record) => record.superseded === undefined).length;
  return { entries, unattributed, unknowable, unplaceable };
}

/**
 * The records in this checkout that cannot be placed on any branch, newest first.
 *
 * The test is whether the record can be PLACED and, failing that, whether it can be READ — not the shape of its
 * `tree` field. `isRecordShaped` never inspects `tree`, so `null`, `undefined` and `{}` all parse, and each is a
 * record carrying no branch and no measurable provenance: nothing is known about what it described. Two Codex
 * reviews forged `null` and then `{}` against narrower spellings of this.
 *
 * A no-tree record retired by `codex supersede` (`./supersession.ts`) stays LISTED, so its retirement is printed
 * forever, and stops counting in `unknowable` — the one number the landing floor fails closed on. Only a
 * `no-tree` row taken on THIS branch retires one (`./unplaceable.ts`).
 *
 * @param mine the records already narrowed to this checkout
 * @param branch the branch being judged, the only one a no-tree row may retire a record for
 * @param supersessions retirements keyed by artifact id; omitted means none are known
 * @returns every no-tree record, each marked with the retirement that holds on `branch`
 */
function unplaceableIn({
  mine,
  branch,
  supersessions,
}: {
  mine: readonly CodexArtifactRecord[];
  branch: string;
  supersessions: ReadonlyMap<string, Supersession> | undefined;
}): UnplaceableRecord[] {
  return mine
    .filter((record) => record.tree?.branch == null && !hasProvenance({ record }))
    .map((record) =>
      toUnplaceable({ branch, record, row: supersessions?.get(record.artifactId), verdict: verdictOf({ record }) }),
    )
    .toSorted((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId));
}

/** The ledger for one branch, plus what could not be attributed to any branch. */
export interface BranchLedger {
  readonly entries: readonly LedgerEntry[];
  /**
   * Passes that ran in this checkout and carry no branch, so they cannot be placed on one. REPORTED, and
   * deliberately wider than {@link unknowable}: it also counts a pass run on a detached HEAD, which a reader
   * wants to see even though it is not evidence about any branch.
   */
  readonly unattributed: number;
  /**
   * The subset whose tree capture FAILED outright, so nothing is known about what they described.
   *
   * The landing gate fails closed on THIS count and not on {@link unattributed}, and the difference is the
   * whole point. `tree === undefined` is absence of knowledge: the pass could have been about this branch,
   * and could have been the newest BLOCKED plan. `tree.branch === null` is the opposite — capture SUCCEEDED
   * and reported a detached HEAD, which is knowledge that the pass was NOT on the branch being landed.
   *
   * Measured, and the reason these are now two numbers: running `codex review` during a rebase records a
   * perfectly good pass on a detached HEAD, and folding that into the fail-closed count left this very
   * checkout permanently unable to land with no remedy short of deleting records. A gate with no way through
   * is the one people route around, which is exactly what `loopFailures` says a floor must never become.
   *
   * A record `codex supersede` has retired is NOT counted, and that is the only way out: explicit, with its
   * reason, and only beside a later pass that did capture a tree.
   */
  readonly unknowable: number;
  /** Every record behind {@link unknowable}, retired ones included, newest first — named so it can be retired. */
  readonly unplaceable: readonly UnplaceableRecord[];
}

/**
 * `formatPassOutcomeContext`, degraded rather than crashing.
 *
 * `scanPassRecords` only shallow-decodes disk JSON — it checks that `outcome` is an object, not that every
 * field the formatter reads actually exists (a legacy record can have `answer.blockers` genuinely absent,
 * for instance). This is the one call site that hands the formatter a record read from disk rather than one
 * this process just constructed, so it is the one place a malformed shape can reach it. A crash here would
 * take down `codex status` and, upstream of it, `codex status --check` — before the merge-gate logic that
 * override even runs. The gap is surfaced rather than silently absorbed: a reader sees that context could
 * not be composed, not a row that quietly looks like a clean result.
 *
 * @param record the pass record, as read from disk
 * @returns the composed context, or a note that it could not be composed
 */
function safeOutcomeContext({ record }: { record: CodexArtifactRecord }): string | undefined {
  try {
    return formatPassOutcomeContext({ record });
  } catch {
    return "outcome context unavailable — this record could not be formatted";
  }
}

/**
 * A review record's own answer summary, read through `unknown` because `scanPassRecords` shallow-decodes disk JSON.
 *
 * @param record the pass record, as read from disk
 * @returns the summary of an answered review, else `undefined`
 */
function reviewSummaryOf({ record }: { record: CodexArtifactRecord }): string | undefined {
  if (record.scope.mode !== "review" || record.outcome.kind !== "answered") {
    return undefined;
  }
  const summary: unknown = record.outcome.answer.summary;
  return typeof summary === "string" ? summary : undefined;
}

/** One record as a ledger row. */
function toEntry({
  record,
  now,
  diffsNow,
}: {
  record: CodexArtifactRecord;
  now: TreeFingerprint | undefined;
  diffsNow: ReadonlyMap<string, string> | undefined;
}): LedgerEntry {
  return {
    artifactId: record.artifactId,
    capped: cappedOutcome({ record }),
    createdAtIso: record.createdAtIso,
    diffSha256: record.scope.mode === "review" ? record.scope.diffSha256 : undefined,
    reviewSummary: reviewSummaryOf({ record }),
    freshness: freshnessOf({ diffsNow, now, record }),
    mode: record.scope.mode,
    // Filled in by `ledgerForBranch`, which is the only caller that knows the register. A row is never
    // retired by default: absence here means the pass counts, which is the safe direction.
    superseded: undefined,
    provider: "codex",
    outcomeContext: safeOutcomeContext({ record }),
    pass: record.scope.pass,
    propertyId: record.scope.mode === "review" ? record.scope.property.id : undefined,
    verdict: verdictOf({ record }),
  };
}

/**
 * Why a branch's loop is not fit to merge, or an empty list when it is.
 *
 * ## What this refuses, and what it deliberately does not
 *
 * It refuses on **objective ledger state**, never on a judgement of quality. "You declared no planning pass"
 * and "this review is CURRENT and BROKEN" are both indisputable and cannot false-positive; "this property was
 * weak" is an opinion and belongs in a comment on the PR, not in a red build. That line is what keeps a gate
 * from becoming the em-dash rule — a check nobody can argue with is a check nobody routes around.
 *
 * ## The floor is a PLAN and a REVIEW, and the two are judged by opposite freshness rules
 *
 * The owner's ruling: Codex and Claude work better together than either alone. Codex plans, Claude implements,
 * Codex reviews. A floor of one current review alone would not require a planning pass, so the half of
 * the pairing that catches a wrong PREMISE — the expensive half — would be invisible to every gate.
 *
 * A review must be CURRENT because a verdict over a tree that has since changed does not describe the code
 * being landed. **A plan must NOT be**, and reading that as an inconsistency is the trap: a plan reads the
 * tree BEFORE the work exists, so requiring currency would reject the intended sequence by construction and
 * accept only the post-hoc plan the rule exists to prevent. STALE is therefore the requirement rather than a
 * tolerance — it is the one thing on the record that says the tree moved AFTER the plan started.
 *
 * **What STALE proves, exactly.** That the tree changed after the plan read it. It does not prove the plan
 * caused the implementation, and one bypass survives and is stated rather than papered over: plan post-hoc,
 * make one more edit, and the plan is STALE. That is a deliberate act with a record of it, which is a
 * different thing from the silent skip measured before this existed — a plan and all three reviews skipped on
 * a merged PR with nobody noticing. `UNKNOWN` counts for neither floor: a pass whose provenance could not be
 * established has not been shown to describe this code, and treating "we could not tell" as "fine" is the
 * overclaim this whole feature exists to remove.
 *
 * ## Why every failure is reported, not just the first
 *
 * The caller is a status report and two landing guards, and each has to show the reader every independent
 * obligation at once. Returning early would make a session fix one, re-run, and discover the next.
 *
 * The review floor stays ONE current review — not three, and not a per-pass list. A docs-only change
 * genuinely does not need `r1`/`r2`/`r3`, and a gate that demands them anyway teaches people to bypass it,
 * which is worse than no gate because a bypassed gate still reads as green.
 *
 * ## The cap witness is supplied, because the ledger alone cannot see one
 *
 * A cap used to be witnessed only by a ROW — a pass that failed on one, or a Claude fallback receipt. That
 * makes a branch nobody has spent a pass on unable to report a cap it is sitting inside: measured,
 * `codex status --check` printed `no planning pass has run` while `codex quota show` on the same machine,
 * seconds later, printed `usage-limit` evidence. `cap` is the live quota gate's answer
 * (`./quotaNow.ts`), passed in rather than read here so this half stays pure. It never changes WHETHER the
 * floor refuses — a cap is not a plan and not a review — only whether the refusal can say why the transport
 * is not going to help.
 *
 * ## After the second review pass, a BROKEN finding is a leftover, never a re-review
 *
 * The owner caps Codex review at two passes, because a landing rate of about four pull requests a day against
 * about eighty was not acceptable to them, and named seven review passes on one change. So once the branch has had
 * `REVIEW_PASS_CAP` review passes (`./reviewPassCap.ts` — one pass is one distinct reviewed DIFF), a
 * CURRENT `BROKEN` review stops being a failure here and becomes a LEFTOVER: the landing verbs raise it as
 * `codex-loop-incomplete`, landed only on an acknowledgement with a reason (`./reviewLeftovers.ts`). Before the
 * second pass it is still a failure, and every other obligation above is unchanged — a current conclusive review
 * is still required, and the plan half does not move at all.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped — omitted when it is not, and
 *   omitted by every caller that has not read the gate
 * @returns one line per reason the loop is incomplete, plan floor first, and the leftovers the landing verbs raise
 */
export function assessCodexLoop({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap?: CodexQuotaEvidence | undefined;
}): CodexLoopAssessment {
  const review = reviewHalf({ cap, entries });
  return { failures: [...planFailures({ cap, entries }), ...review.failures], leftovers: review.leftovers };
}

/** What {@link assessCodexLoop} found: the floor's failures, and the leftovers the landing verbs raise. */
export interface CodexLoopAssessment {
  readonly failures: readonly string[];
  /** Current `BROKEN` review rows past the second review pass — each landed only on an acknowledgement with a reason. */
  readonly leftovers: readonly ReviewLeftover[];
}

/**
 * The floor's failures alone — {@link assessCodexLoop} without its leftovers, for a caller that never lands.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns one line per reason the loop is incomplete, plan floor first
 */
export function loopFailures({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap?: CodexQuotaEvidence | undefined;
}): readonly string[] {
  return assessCodexLoop({ cap, entries }).failures;
}

/**
 * Whether a record's tree can be compared to anything at all.
 *
 * The pair {@link BranchLedger.unattributed} and {@link BranchLedger.unknowable} turn on this: a pass on a
 * DETACHED HEAD carries no branch but full provenance, which is knowledge that it was not on the branch being
 * landed. A pass with no usable digests carries no knowledge either way, and the landing gate fails closed on
 * exactly that.
 *
 * @param record the pass record, as read from disk
 * @returns true when both provenance digests are present and well-formed
 */
function hasProvenance({ record }: { record: CodexArtifactRecord }): boolean {
  const tree = record.tree;
  return tree != null && isDigest(tree.treeSha, GIT_OBJECT_HEX) && isDigest(tree.fingerprint, SHA256_HEX);
}

/** A git object name's hex width, and a sha256 digest's — the two shapes {@link isDigest} is asked for. */
const GIT_OBJECT_HEX = 40;
const SHA256_HEX = 64;

/**
 * The plan half of the floor: one conclusive, STALE `READY` planning pass.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns at most one reason the plan half is unsatisfied
 */
function planFailures({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap: CodexQuotaEvidence | undefined;
}): readonly string[] {
  const plans = entries.filter((entry) => entry.mode === "plan");
  const capped = cappedPlanNextStep({ cap, entries });
  if (plans.length === 0) {
    return [
      // "on this branch", not "in this checkout": the landing floor folds every checkout that holds the pull
      // request's head commit and has evidence on its branch (`./landingGateRun.ts`), so naming one checkout
      // would send a reader to look in the wrong place. `codex status`, which really is about one checkout, names it in its header.
      "no planning pass has run on this branch — nothing planned the work before it was written" + capped,
    ];
  }
  const conclusive = plans.filter((entry) => concluded({ entry }));
  if (conclusive.length === 0) {
    return [
      `${String(plans.length)} planning pass(es) ran but none reached a verdict — ` +
        "each produced NO_VERDICT or failed outright, so nothing was established" +
        newestFaultClause({ entries: plans }) +
        capped,
    ];
  }
  // Newest first, so the first conclusive row is the latest word. A BLOCKED plan is evidence a consultation
  // happened AND that its own artifact said not to proceed; counting it would print "the loop is complete"
  // over an artifact listing blockers. A later READY supersedes it, which is exactly `codex plan` re-run.
  //
  // Every plan sharing the newest conclusive INSTANT is consulted, not just the first row, and one BLOCKED
  // among them refuses. Two passes can finish inside the same millisecond, and then no ordering can say which
  // ruled last — so the tie is read as unresolved rather than settled by the tie-break above, which exists to
  // make the order deterministic and cannot make it TRUE.
  const latest = conclusive[0]!;
  const newest = conclusive.filter((entry) => entry.createdAtIso === latest.createdAtIso);
  const blocked = newest.find((entry) => entry.verdict === "BLOCKED");
  if (blocked !== undefined) {
    // Codex's own word against proceeding is never ridden past on a cap: the clause belongs to the failures
    // that mean "no usable plan exists", not to the one that means "the plan said no".
    return [`${blocked.pass} is the latest planning pass and is BLOCKED — resolve its blockers, then run a later plan`];
  }
  const ordered = conclusive.filter((entry) => entry.freshness.kind === "stale" && entry.verdict === "READY");
  if (ordered.length === 0) {
    return [
      `${String(conclusive.length)} planning pass(es) reached a verdict but none is both STALE and READY — ` +
        "a CURRENT plan read the tree being landed, so it cannot show the work came after it, " +
        "and UNKNOWN provenance cannot show anything" +
        capped,
    ];
  }
  return [];
}

/**
 * Whether a record FAILED on a Codex usage cap.
 *
 * Read through `unknown`, because `cause` is typed as always present and a record written before the field
 * existed has none (`./types.ts` says so on the field). A fatal with no cause is a fault of unknown kind,
 * which is not a cap.
 *
 * @param record the pass record, as read from disk
 * @returns true only when the transport cause classified to a quota kind
 */
function cappedOutcome({ record }: { record: CodexArtifactRecord }): boolean {
  if (record.outcome.kind !== "fatal") {
    return false;
  }
  const cause: unknown = record.outcome.cause;
  return isRecord(cause) && cause["quota"] != null;
}
