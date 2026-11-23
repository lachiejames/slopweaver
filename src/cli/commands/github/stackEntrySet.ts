/**
 * Whether two native-stack entry-number lists name the same pull requests, regardless of order — the one
 * comparison `stack remove` and `stack dissolve` both make when re-checking freshness inside the door.
 * Shared rather than duplicated: the two callers' own reasons for refusing differ (a removal vs a
 * dissolve), but the underlying "same requests, in some order" test does not.
 */

/**
 * Whether two entry-number lists contain exactly the same numbers, in any order.
 *
 * @param a one list of pull-request numbers
 * @param b the other list of pull-request numbers
 * @returns true when both lists name the same set of numbers
 */
export function sameEntryNumbers({ a, b }: { a: readonly number[]; b: readonly number[] }): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((number) => setB.has(number));
}
