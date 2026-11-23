/**
 * Running one census phase's calls a few at a time. Effectful only in what it runs; the scheduling is plain.
 *
 * ## Why concurrency at all, when the sampling catalogue was deliberately sequential
 *
 * That catalogue's own header gives the reason it fired one cell at a time: the public search budget is 3
 * requests per 10 seconds, so a burst spends it and then every retry waits on one reset. The exemplar pass
 * runs against a different budget — the unified event track allows 85 per 10 seconds — and a strictly
 * sequential pass there reaches about 6 requests a second on a round trip of roughly 150 ms, which leaves a
 * third of the allowance unused and turns a 43-minute pass into an hour. {@link CENSUS_CONCURRENCY} is set
 * to stay inside the measured budget while using it, and the raw requester's own 429 retry is what catches
 * an overshoot rather than a second policy here.
 */

/**
 * How many track reads run at once.
 *
 * Six, against a measured 85 per 10 seconds: six in flight at ~150 ms each is about 40 requests per 10
 * seconds, comfortably inside the budget with room for the aggregate calls a phase interleaves. Raising it
 * buys little — the pass is dominated by the number of shapes, not by the wait — and risks spending a
 * shared budget that an interactive verb in another session is also drawing on.
 */
export const CENSUS_CONCURRENCY = 6;

/**
 * Run one asynchronous step over every item, a bounded number at a time, keeping the input order.
 *
 * @param items what to run over
 * @param limit how many run at once
 * @param run the step, handed each item and its index
 * @returns each item's result, in the order the items were given
 */
export async function mapBounded<T, R>({
  items,
  limit,
  run,
}: {
  items: readonly T[];
  limit: number;
  run: (input: { item: T; index: number }) => Promise<R>;
}): Promise<readonly R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      out[index] = await run({ index, item });
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return out;
}
