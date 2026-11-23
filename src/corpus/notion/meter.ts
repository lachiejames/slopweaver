/**
 * What one Notion crawl actually SPENT, observed by the transport rather than inferred.
 *
 * Notion's cap is ~3 requests/second and every lane's scheduler is set to it, so it was easy to assume the
 * crawl ran at 3 req/s and conclude the only remaining lever was fetching less. That assumption was never
 * measured, and it is wrong whenever the calls are issued serially: `p-throttle` paces the START of each
 * call, so a lane that awaits one call before issuing the next achieves `1 / (interval + latency)`, not
 * `1 / interval`. The gap between the two IS the concurrency headroom, and it can only be seen by counting
 * real calls against real wall time — which is what this module exists to do.
 *
 * Deliberately clock-free: the caller supplies `elapsedMs`, so the note is a pure function of two numbers
 * and a test asserts it exactly rather than around a real timer.
 */

/** What a crawl spent, as counted at the transport boundary. */
export interface NotionCrawlTotals {
  /** Every gated request issued — search, block children, comments, data-source query, users. */
  readonly calls: number;
  /** Pages and rows the pre-fetch check found unchanged in bronze and never fetched (see `seenIndex.ts`). */
  readonly skippedUnchanged: number;
}

/**
 * The mutable per-crawl record both lanes share — what was spent, and WHICH ids were skipped.
 *
 * The id set is not bookkeeping for the report; it is load-bearing. A Notion database row is also a page,
 * so both lanes meet it, and the pages lane always finishes first. If the pages lane skipped a row as
 * unchanged and the row is then edited before the databases lane reaches it, that lane sees a newer
 * timestamp, fetches properties and comments only, and emits a row with NO block body — which reconciles
 * against no shadow and lands looking like a complete capture at the new timestamp. An adversarial review
 * pass produced exactly that counterexample. Asking this set instead makes the two lanes agree: a row the
 * pages lane passed over is passed over here too, so bronze keeps its older but WHOLE capture and the next
 * crawl re-fetches it properly.
 */
export interface NotionCrawlMeter {
  /** Record one gated request. */
  readonly countCall: () => void;
  /** Record that this page/row id was skipped as already-held-unchanged. */
  readonly countSkippedUnchanged: (args: { id: string }) => void;
  /** Whether an earlier lane already skipped this id as unchanged. */
  readonly wasSkippedUnchanged: (args: { id: string }) => boolean;
  /** The running totals. */
  readonly read: () => NotionCrawlTotals;
}

/**
 * Build a fresh meter for one crawl.
 *
 * @returns the meter, mutable and shared by every lane of that crawl
 */
export function createNotionCrawlMeter(): NotionCrawlMeter {
  let calls = 0;
  const skipped = new Set<string>();
  return {
    countCall: () => {
      calls += 1;
    },
    countSkippedUnchanged: ({ id }) => {
      skipped.add(id);
    },
    read: () => ({ calls, skippedUnchanged: skipped.size }),
    wasSkippedUnchanged: ({ id }) => skipped.has(id),
  };
}

/**
 * The one-line spend report for a finished crawl — the before/after number this connector's throughput
 * work is judged on. Numbers only, so the line is safe to paste as proof. Pure.
 *
 * @param totals what the crawl spent
 * @param elapsedMs the crawl's wall time
 * @param ratePerSec the cap the scheduler was set to, so achieved and available sit side by side
 * @returns the note line
 */
export function notionThroughputNote({
  totals,
  elapsedMs,
  ratePerSec,
}: {
  totals: NotionCrawlTotals;
  elapsedMs: number;
  ratePerSec: number;
}): string {
  const seconds = Math.max(elapsedMs, 1) / 1000;
  const achieved = (totals.calls / seconds).toFixed(2);
  const utilisation = ((totals.calls / seconds / ratePerSec) * 100).toFixed(0);
  return `throughput: ${String(totals.calls)} request(s) in ${seconds.toFixed(0)}s — ${achieved} req/s achieved of ${String(ratePerSec)} req/s cap (${utilisation}%), ${String(totals.skippedUnchanged)} item(s) skipped as unchanged in bronze`;
}
