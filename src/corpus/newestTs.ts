/**
 * The newest `tsIso` across a batch of records — the ONE function a connector asks for the instant its
 * per-container commits actually covered.
 *
 * Extracted rather than written a fourth time. Two private copies already stood in `gmail/ingest.ts` and
 * `calendar/ingest.ts`, byte for byte, and every connector that gains a durable commit needs the same
 * answer for `SourceIngestJob.run`'s `committedCursor`. Scattered, there is no single function a rule can
 * name — the same shape that let four independent `tsToIso` copies disagree about a bad input
 * (`.claude/rules/typescript-patterns.md`, "Never scale an epoch into a `Date`").
 *
 * `undefined` rather than `""` for an empty batch, because the callers spread it conditionally and a
 * sentinel would have to be re-checked at every one of them.
 */
import { clampIsoToClock } from "#lib/date.js";
import type { CorpusRecord } from "./types.js";

/**
 * The newest `tsIso` in a batch, or undefined when the batch is empty. Pure.
 *
 * @param records the batch to scan — lexical comparison is correct here because every `tsIso` in bronze is
 *   a zero-padded ISO-8601 instant, so byte order IS chronological order
 * @returns the maximum `tsIso`, or undefined for an empty batch
 */
export function newestTs({ records }: { records: readonly CorpusRecord[] }): string | undefined {
  return records.reduce<string | undefined>((newest, record) => {
    if (newest === undefined || record.tsIso > newest) {
      return record.tsIso;
    }
    return newest;
  }, undefined);
}

/**
 * The newest `tsIso` in a batch, never later than the clock — the pooled cursor a DIARY may bank, because a
 * calendar record's `tsIso` is the event's START and a diary holds meetings months ahead
 * (`./calendar/ingest.ts`'s `pooledCursor` carries the measurement). Every calendar lane, Google's and
 * Outlook's, asks this one function. Pure.
 *
 * @param records what the pass committed
 * @param nowIso the instant the pass ran, which is as far through time as reading a diary can prove
 * @returns the cursor to bank, or undefined when the batch is empty
 */
export function newestTsAtClock({
  records,
  nowIso,
}: {
  records: readonly CorpusRecord[];
  nowIso: string;
}): string | undefined {
  const newest = newestTs({ records });
  if (newest === undefined) {
    return undefined;
  }
  return clampIsoToClock({ nowIso, tsIso: newest });
}
