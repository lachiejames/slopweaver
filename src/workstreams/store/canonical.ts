/**
 * The one order a workstream aggregate is held in, so what a writer puts is exactly what a reader gets back.
 *
 * Links carry no position in the store, and `after` is a set of edges, so a read cannot recover the order a caller
 * wrote them in; the port applies this order on the way in (`./port.ts`) and assembly on the way out
 * (`./assembly.ts`), so the two can never disagree. Milestones and entries go by their
 * authored position, `after` by id, and links by kind then target, all compared by code unit so the order never
 * depends on a locale.
 *
 * Pure.
 */
import type { WorkstreamAggregate } from "./types.js";

/**
 * Compare two strings by code unit, the same order `Array.prototype.sort` gives with no comparator.
 *
 * @returns negative, zero or positive
 */
export function byCodeUnit({ a, b }: { a: string; b: string }): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * The aggregate with every child collection in its canonical order, and every position as an `integer` column reads
 * it back — `-0`, which validation accepts as a whole number from zero, as `0`; nothing else changes.
 *
 * @returns the same aggregate, reordered
 */
export function canonicalAggregate({ aggregate }: { aggregate: WorkstreamAggregate }): WorkstreamAggregate {
  return {
    ...aggregate,
    entries: aggregate.entries
      .toSorted((a, b) => a.position - b.position)
      .map((one) => ({ ...one, position: one.position + 0 })),
    links: aggregate.links.toSorted(
      (a, b) => byCodeUnit({ a: a.kind, b: b.kind }) || byCodeUnit({ a: a.target, b: b.target }),
    ),
    milestones: aggregate.milestones
      .toSorted((a, b) => a.position - b.position)
      .map((one) => ({ ...one, after: one.after.toSorted(), position: one.position + 0 })),
  };
}
