/**
 * The durability and spend notes a Notion run reports, for both the grant-delta phase and the incremental
 * crawl {@link ./tokenedJobsNotion} sequences. Pure text over counters the crawl already holds.
 */

import { NOTION_RATE_PER_SEC } from "../../../corpus/notion/callDeadline.js";
import { type NotionCrawlMeter, notionThroughputNote } from "../../../corpus/notion/meter.js";
import type { NotionSeenIndex } from "../../../corpus/notion/seenIndex.js";

/**
 * The durability notes for a Notion run's incremental flushes, or empty when nothing was flushed.
 *
 * @param spend the run's accumulated write/failure counters from {@link ./tokenedJobsNotion.flushNotionBatch}
 * @returns zero, one or two note lines, depending on what actually happened
 */
export function notionDurabilityNotes({ spend }: { spend: { written: number; failed: number } }): readonly string[] {
  return [
    ...(spend.written > 0
      ? [`durability: flushed ${String(spend.written)} record(s) to bronze incrementally during the crawl`]
      : []),
    ...(spend.failed > 0
      ? [
          `durability: ${String(spend.failed)} incremental batch write(s) FAILED — that content only lands via the closing write, if the run completes`,
        ]
      : []),
  ];
}

/**
 * What a Notion crawl cost and what the unchanged-index saved it, as the two note lines a run reports.
 *
 * Separate from the skip and durability notes because it answers a different question: those say what the
 * crawl could not READ, this says how hard it worked and how much work it avoided. Both numbers are the
 * before/after evidence `docs/notion-connector-throughput.md` is written from, so they are emitted every
 * run rather than behind a flag.
 *
 * @param elapsedMs the crawl's wall time
 * @param meter the crawl's request/skip counter
 * @param seen the unchanged-index the crawl consulted
 * @returns the throughput line and the index-coverage line
 */
export function notionSpendNotes({
  elapsedMs,
  meter,
  seen,
}: {
  elapsedMs: number;
  meter: NotionCrawlMeter;
  seen: NotionSeenIndex;
}): readonly string[] {
  return [
    notionThroughputNote({ elapsedMs, ratePerSec: NOTION_RATE_PER_SEC, totals: meter.read() }),
    `unchanged-index: ${String(seen.size)} page(s) already in bronze were available to skip`,
  ];
}
