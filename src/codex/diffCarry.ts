/**
 * The pure half of the rule that a review whose DIFF did not move is still current after a conflict-free
 * rebase: which base refs need a current diff, and whether a stale review's recorded diff matches one.
 *
 * `./ledger.ts`'s `freshnessOf` applies it and documents why; `./diffsNow.ts` takes the diffs it compares.
 *
 * ## Two diffs a recorded review can match, and why the second exists
 *
 * The first is the diff the head produces against the record's OWN base ref. That carries a review taken with
 * a moving ref such as `--base origin/main` across a rebase, and nothing else: a review taken with `--base
 * <full SHA>` re-diffs the rebased head against the OLD base and folds in every commit main gained since.
 * MEASURED: most review records on the machine this was found on name a full SHA as their base ref, and four
 * pull requests each needed a `codex-loop-incomplete` acknowledgement at the lap after a rebase that changed no
 * line of their own diff.
 *
 * The second is the diff a pull request presents against the base it would land on — GitHub's `baseRefOid`,
 * which only a landing reader has. The record proves Codex judged patch bytes D; the pull request now offers
 * exactly D against the commit it merges into. That is patch identity, the same contract `./duplicate.ts`
 * keys a re-run on and the moving-ref carry already accepts, and the owner's rule that an identical patch
 * after a rebase gets no extra review.
 */
import type { CodexArtifactRecord } from "./types.js";

/** A sha256 digest's shape. A recorded value that is not one never matches, so never lifts a row. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The diff a pull request head presents against the base commit it would land on, as a landing reader took it. */
export interface LandingBaseDiff {
  /** The pull request's base commit (GitHub's `baseRefOid`) the diff was taken against. */
  readonly baseSha: string;
  /** The sha256 of that diff, hashed exactly as `codex review` records one. */
  readonly sha256: string;
}

/**
 * The diff digest a REVIEW record carries, when it carries a usable one. Read through `unknown`, because
 * `scanPassRecords` shallow-decodes disk JSON. Shared by both carries (this module's and the ratchet-bump
 * witness's, `./baselineBumpWitness.ts`), so the two can never disagree on what a usable digest is.
 *
 * @param record the pass record
 * @returns the lowercase sha256 hex digest, or `undefined` for a plan or a value that is not one
 */
export function recordedReviewDiffSha256({ record }: { record: CodexArtifactRecord }): string | undefined {
  const recorded: unknown = record.scope.mode === "review" ? record.scope.diffSha256 : undefined;
  return typeof recorded === "string" && SHA256_HEX.test(recorded) ? recorded : undefined;
}

/**
 * The reason a STALE review still counts: the diff the tree being judged produces against the record's own
 * base ref, or — when a landing reader supplies one — against the pull request's current base, is the one
 * whose sha256 the record carries. The record's own base ref is tried first, so a row both would carry reads
 * exactly as it always has.
 *
 * @param record the pass record the tree judged stale
 * @param staleReason what the tree check said moved
 * @param diffsNow base ref → sha256 of the diff the tree being judged produces against it; omitted means none
 *   was taken
 * @param landingBaseDiff the diff the pull request head presents against its current base; omitted outside a
 *   landing read, or when git could not take it
 * @returns the carried reason, or `undefined` when the row stays stale: a plan, a digest that is not one, or
 *   neither diff hashing to the recorded digest
 */
export function carriedReviewReason({
  record,
  staleReason,
  diffsNow,
  landingBaseDiff,
}: {
  record: CodexArtifactRecord;
  staleReason: string;
  diffsNow: ReadonlyMap<string, string> | undefined;
  landingBaseDiff?: LandingBaseDiff | undefined;
}): string | undefined {
  const scope = record.scope;
  const recorded = recordedReviewDiffSha256({ record });
  if (scope.mode !== "review" || recorded === undefined) {
    return undefined;
  }
  if (diffsNow?.get(scope.baseRef) === recorded) {
    return `${staleReason}, but the diff it judged against ${scope.baseRef} is byte-identical`;
  }
  if (landingBaseDiff?.sha256 === recorded) {
    return `${staleReason}, but the diff it judged is byte-identical against the pull request's current base ${landingBaseDiff.baseSha.slice(0, 12)}`;
  }
  return undefined;
}

/**
 * The distinct base refs this checkout's REVIEW passes on `branch` were taken against — the only refs a
 * caller needs a current diff for before building the ledger.
 *
 * A value that is not a non-empty string, or that begins with `-`, is dropped: `scanPassRecords` shallow-
 * decodes disk JSON, and this value is about to reach git's argv.
 *
 * @param records every pass record that could be read
 * @param repoRoot the checkout the ledger is about
 * @param branch the branch the ledger is about
 * @returns the base refs, each once, in first-seen order
 */
export function reviewBaseRefs({
  records,
  repoRoot,
  branch,
}: {
  records: readonly CodexArtifactRecord[];
  repoRoot: string;
  branch: string;
}): readonly string[] {
  const refs = new Set<string>();
  for (const record of records) {
    const baseRef: unknown = record.scope.mode === "review" ? record.scope.baseRef : undefined;
    const placed = record.repoRoot === repoRoot && record.tree?.branch === branch;
    if (placed && typeof baseRef === "string" && baseRef.length > 0 && !baseRef.startsWith("-")) {
      refs.add(baseRef);
    }
  }
  return [...refs];
}
