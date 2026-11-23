/**
 * One crawled conversation folded down to the durable shape the rest of a run needs once its records are on
 * disk — split out of `fetch.ts` so the memory-bound rationale (measured: an epoch-wide backfill
 * hit 5.15 GB and died at conversation 95 of 603 because every committed conversation's items were still
 * held) sits with the one type and two pure functions that implement it.
 */
import type { ChannelFlushTotals } from "./channelPages.js";
import type { SlackChannelItems } from "./project.js";

/**
 * One crawled conversation reduced to what the rest of the run still needs once its records are on disk:
 * its identity, its privacy signals, how much it held, and the newest timestamp in it.
 *
 * This type is the bound on the crawl's memory. Committing bronze per
 * conversation, but every conversation's shaped items stayed in the run's accumulator afterwards, because
 * three later steps read them: the curated lane ranks channels by activity, the end-of-run bulk write
 * projects them, and the per-channel watermark wants their timestamps. Growth was therefore proportional to
 * the WORKSPACE — measured, an epoch-wide backfill climbed to 5.15 GB and died of
 * `Ineffective mark-compacts near heap limit` at conversation 95 of 603. Raising the heap cap moves that
 * ceiling without removing it, since a big enough workspace always reaches it again.
 *
 * None of those three steps actually needs the messages. The ranking needs a COUNT, the bulk write's unique
 * contribution is the curated records it fetches workspace-wide after the crawl, and a watermark needs one
 * string. So a banked conversation folds down to this, and the items become garbage the moment the next one
 * starts.
 */
export interface SlackChannelSummary extends Omit<SlackChannelItems, "messages" | "replies"> {
  /** Messages + replies this crawl read — the curated lane's activity ranking, and nothing else. */
  readonly itemCount: number;
  /** The newest `tsIso` in the conversation, or `""` when it held nothing dated — never absent. */
  readonly maxTsIso: string;
}

/**
 * Fold one conversation's items down to the summary that outlives them. Pure.
 *
 * `""` rather than `undefined` for an empty conversation is deliberate: a channel that was read and held
 * nothing must still produce a watermark entry (see `channelWatermark.computeChannelWatermarks`), and an
 * absent field would make "read, and quiet" indistinguishable from "never read".
 *
 * @param items the conversation's fetched messages + replies
 * @returns the summary — identity and privacy signals verbatim, the items as a count and one timestamp
 */
export function summariseSlackChannel({ items }: { items: SlackChannelItems }): SlackChannelSummary {
  const { messages, replies, ...identity } = items;
  let maxTsIso = "";
  for (const { tsIso } of messages) {
    maxTsIso = tsIso > maxTsIso ? tsIso : maxTsIso;
  }
  for (const { tsIso } of replies) {
    maxTsIso = tsIso > maxTsIso ? tsIso : maxTsIso;
  }
  return { ...identity, itemCount: messages.length + replies.length, maxTsIso };
}

/**
 * One conversation's summary INCLUDING whatever a mid-crawl flush already banked and released. Pure.
 *
 * `summariseSlackChannel` alone would describe the TAIL on a flushed conversation, and both fields it gets
 * wrong are load-bearing: the curated lane ranks conversations by `itemCount`, and `maxTsIso` becomes the
 * per-channel cursor. Since `conversations.history` is newest-first, the tail's max is the OLDEST row read,
 * so a cursor from it would sit below every row the flushes already put on disk.
 *
 * @param items the conversation's remaining (tail) items
 * @param flushed what its mid-crawl flushes banked
 * @returns the summary of the whole conversation as this run read it
 */
export function wholeChannelSummary({
  items,
  flushed,
}: {
  items: SlackChannelItems;
  flushed: ChannelFlushTotals;
}): SlackChannelSummary {
  const tail = summariseSlackChannel({ items });
  return {
    ...tail,
    itemCount: tail.itemCount + flushed.items,
    maxTsIso: flushed.maxTsIso > tail.maxTsIso ? flushed.maxTsIso : tail.maxTsIso,
  };
}
