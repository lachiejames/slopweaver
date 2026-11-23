/**
 * Edit distance between two strings, and the similarity fraction derived from it — the one home for both.
 *
 * It lives in `lib` rather than beside its first caller because the alternative is what this repository has
 * already measured once: four independent `tsToIso` copies standing in one tree, none of them wrong,
 * and no single function a rule could name (AGENTS.md § TypeScript patterns, "Never scale an epoch into a
 * `Date`"). Two Levenshtein implementations stood here before this file did — `store/identity/matching.ts`'s
 * resolution matcher and `outbound/strictForm.ts`'s unknown-field suggester — and adding a third for
 * `silver/nearMention.ts` is how a fifth `tsToIso` gets written.
 *
 * `outbound/strictForm.ts` deliberately keeps its own: it lower-cases both sides before comparing and its
 * comment records that as a property of the field-name suggester rather than of edit distance. Folding it in
 * would change what that gate suggests, which is a separate change from this one.
 *
 * Pure: no clock, no I/O, total on every input including the empty string.
 */

/**
 * The minimum number of single-character edits — insert, delete, substitute — that turns one string into the
 * other.
 *
 * Two rolling rows rather than the full matrix, because the whole matrix is never read: only the previous
 * row is, and a pass compares one needle against every candidate already known.
 *
 * @param left one string
 * @param right the other
 * @returns the edit distance, zero when they are identical
 */
export function levenshteinDistance({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= right.length; j += 1) {
      // Every index here is provably in range — `j` runs 1..right.length over rows of right.length + 1, and
      // `current[j - 1]` was written by the previous step or by the row's own seed — so the assertion is the
      // honest spelling under `noUncheckedIndexedAccess`. A `?? 0` would silently return a WRONG distance if
      // that reasoning ever broke, which is the substitution `no-silent-fallback` exists to refuse.
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      const substitution = previous[j - 1]! + cost;
      current[j] = Math.min(deletion, insertion, substitution);
    }
    previous = current;
  }
  return previous[right.length]!;
}

/**
 * How alike two strings are, on a scale where 1 is identical and 0 shares nothing.
 *
 * @param left one string
 * @param right the other
 * @returns the edit distance expressed as a fraction of the longer string
 */
export function stringSimilarity({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  return 1 - levenshteinDistance({ left, right }) / Math.max(left.length, right.length);
}
