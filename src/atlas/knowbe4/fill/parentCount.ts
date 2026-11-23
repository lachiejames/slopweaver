/**
 * A per-parent list held to the parent's own published count: which count, which rows it counts, and the words
 * for a mismatch. The fan-out in `run.ts` reads; this decides whether what it read is whole.
 */
import type { Knowbe4FillCall } from "./plan.js";
import type { Knowbe4ProjectedItem } from "./projectShapes.js";

/**
 * The row count KnowBe4 publishes for one parent's list, or `null` when the path holds it to none.
 *
 * @param call the planned path
 * @param parent the parent row its list is read under
 * @returns the count the list is held to, or `null`
 */
export function expectedOf({ call, parent }: { call: Knowbe4FillCall; parent: Knowbe4ProjectedItem }): number | null {
  if (call.expectedRows === undefined) {
    return null;
  }
  return call.expectedRows({ parent: parent.detail });
}

/**
 * How many of one parent's rows its published count counts.
 *
 * @param call the planned path, whose `countedRow` says which rows the count covers
 * @param items the rows the parent's list read
 * @returns the counted rows, or every row when the path names no subset
 */
export function countedOf({ call, items }: { call: Knowbe4FillCall; items: readonly Knowbe4ProjectedItem[] }): number {
  const counts = call.countedRow;
  if (counts === undefined) {
    return items.length;
  }
  return items.filter((item) => counts({ detail: item.detail })).length;
}

/**
 * One parent's list held to its count — EQUAL, not at least: more rows than the count is a list that moved between
 * the two reads.
 *
 * @param expected the parent's own count, or `null` when it publishes none
 * @param got the rows its list read
 * @param providerId the parent, for the bound's words
 * @returns the shortfall's words, or `null` when the count holds or there is none to hold
 */
export function shortfallOf({
  expected,
  got,
  providerId,
}: {
  expected: number | null;
  got: number;
  providerId: string;
}): string | null {
  if (expected === null || got === expected) {
    return null;
  }
  return `${providerId} (${String(got)} of ${String(expected)})`;
}
