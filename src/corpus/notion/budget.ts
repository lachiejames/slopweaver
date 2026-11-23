/**
 * The shared item budget for one Notion crawl — what `--fetch-cap` actually bounds.
 *
 * Notion was the one source `--fetch-cap` did not reach. The flag was accepted, printed in `--help` and
 * silently ignored for this lane, so `refresh --source notion --fetch-cap 400` crawled the entire workspace:
 * there was no way to make a small first Notion run at all. Measured, the pages lane takes ~29
 * seconds per page (a "page" being a whole recursive subtree at ~3 req/s), so an unbounded first run against
 * a 1,845-page workspace is hours, which is why the missing cap mattered rather than being a nicety.
 *
 * Bounding by ITEMS rather than by API calls is deliberate: a cap is only useful if the caller can predict
 * what it yields, and "60 records" is predictable where "60 calls" depends on how deeply pages happen to nest.
 *
 * Its own module because `fetch.ts` is at its line ceiling and this is self-contained and separately testable.
 */

/** A shared, mutable item budget. One instance per crawl, consulted by both lanes. */
export interface FetchBudget {
  /** Record that `items` more items were taken. */
  readonly spend: (args: { items: number }) => void;
  /** Whether the cap has been reached, so the caller must stop paging. */
  readonly exhausted: () => boolean;
}

/**
 * Build a shared item budget for one crawl.
 *
 * `maxItems` is `number | undefined` rather than an optional property so a caller holding an
 * already-possibly-undefined value can pass it straight through. Under `exactOptionalPropertyTypes` an
 * optional property would force every call site into a conditional spread, which is noise that says nothing.
 *
 * @param maxItems the total item cap, or undefined for UNBOUNDED — the historical behaviour, kept as the
 *   default so a caller that passes no cap sees no change
 * @returns the budget, mutable and shared across both lanes of one crawl
 */
export function createFetchBudget({ maxItems }: { maxItems: number | undefined }): FetchBudget {
  let taken = 0;
  return {
    exhausted: () => maxItems !== undefined && taken >= maxItems,
    spend: ({ items }) => {
      taken += items;
    },
  };
}
