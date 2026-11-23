/**
 * The pure half of the rule that a review whose DIFF did not move is still current after a conflict-free
 * rebase: which base refs need a current diff, and whether a stale review's recorded diff matches one.
 *
 * `./ledger.ts`'s `freshnessOf` applies it and documents why; `./diffsNow.ts` takes the diffs it compares.
 */
import type { CodexArtifactRecord } from "./types.js";

/** A sha256 digest's shape. A recorded value that is not one never matches, so never lifts a row. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The reason a STALE review still counts, when the diff the tree being judged produces against the record's
 * own base ref is the one whose sha256 the record carries.
 *
 * @param record the pass record the tree judged stale
 * @param staleReason what the tree check said moved
 * @param diffsNow base ref → sha256 of the diff the tree being judged produces against it; omitted means none
 *   was taken
 * @returns the carried reason, or `undefined` when the row stays stale: a plan, a digest that is not one, or a
 *   base ref absent from `diffsNow` or hashing differently
 */
export function carriedReviewReason({
  record,
  staleReason,
  diffsNow,
}: {
  record: CodexArtifactRecord;
  staleReason: string;
  diffsNow: ReadonlyMap<string, string> | undefined;
}): string | undefined {
  const scope = record.scope;
  if (scope.mode !== "review") {
    return undefined;
  }
  const recorded: unknown = scope.diffSha256;
  if (typeof recorded !== "string" || !SHA256_HEX.test(recorded) || diffsNow?.get(scope.baseRef) !== recorded) {
    return undefined;
  }
  return `${staleReason}, but the diff it judged against ${scope.baseRef} is byte-identical`;
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
