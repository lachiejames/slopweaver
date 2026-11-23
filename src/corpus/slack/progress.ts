/**
 * The pure Slack-crawl progress helpers (PR4.4c) — titles, per-channel counts, a first-message preview,
 * and the running-totals accumulator the crawl folds each channel into. Kept beside the Slack edge but in
 * their own file so `fetch.ts` stays under the file-size ceiling; every function here is pure (or a thin
 * fire-and-forget emit) and unit-tested.
 */

import { type SourceProgress, type SourceProgressEvent, sourceHeartbeat, sourcePreview } from "../progress.js";
import type { SlackChannelItems } from "./project.js";

/**
 * The heartbeat title for a channel — `#name` when known, else the raw id. Pure.
 *
 * @param channel the channel; `name` is absent for a channel the token cannot resolve a name for
 * @returns `#name`, or the bare id so the heartbeat still identifies something
 */
export function slackChannelTitle({ channel }: { channel: { id: string; name?: string } }): string {
  return channel.name !== undefined ? `#${channel.name}` : channel.id;
}

/**
 * The per-channel counts (messages + distinct threads) from one channel's shaped items. Pure.
 *
 * @param items one channel's already-shaped messages and replies
 * @returns the message count, and the count of DISTINCT threads — replies are deduped by `threadTs`, so a
 *   busy thread counts once
 */
export function slackChannelCounts({ items }: { items: SlackChannelItems }): { messages: number; threads: number } {
  return { messages: items.messages.length, threads: new Set(items.replies.map((reply) => reply.threadTs)).size };
}

/**
 * A content-preview event from a channel's first message with text, or undefined when it has none. Pure.
 *
 * @param channel the channel being previewed, for the event's subject
 * @param items the channel's shaped items; the first message with non-empty text becomes the snippet
 * @returns the preview event, or undefined for a channel of joins/bot posts with no prose to show
 */
export function slackChannelPreview({
  channel,
  items,
}: {
  channel: { id: string; name?: string };
  items: SlackChannelItems;
}): SourceProgressEvent | undefined {
  const first = items.messages.find((message) => message.text !== undefined && message.text.length > 0);
  if (first?.text === undefined) {
    return undefined;
  }
  return sourcePreview({
    phase: "channel",
    snippet: first.text,
    source: "slack",
    sourceContentId: channel.id,
    subject: slackChannelTitle({ channel }),
  });
}

/** A mutable running-totals accumulator for the Slack crawl's heartbeat metrics. */
export interface SlackCrawlTotals {
  messages: number;
  threads: number;
  skipped: number;
}

/**
 * Emit the pre-fetch "starting this channel" heartbeat (names the channel + its position).
 *
 * @param channel the channel about to be crawled
 * @param index how many channels are already done — emitted as `done`, so it is 0-based on purpose
 * @param total how many channels the crawl will visit
 * @param onProgress the sink, or undefined when nothing is watching
 */
export function startChannelHeartbeat({
  channel,
  index,
  total,
  onProgress,
}: {
  channel: { id: string; name?: string };
  index: number;
  total: number;
  onProgress: SourceProgress | undefined;
}): void {
  onProgress?.(
    sourceHeartbeat({
      currentItem: { title: slackChannelTitle({ channel }) },
      done: index,
      phase: "channel",
      source: "slack",
      total,
    }),
  );
}

/**
 * Emit the heartbeat for a conversation the crawl ABANDONED on its progress deadline.
 *
 * The structured skip line rides in `currentItem.title` rather than only landing in the run's warnings,
 * because warnings are reported when the crawl ends and this is meant to be legible DURING a seven-hour
 * pass — the whole point being that nobody is sitting there catching hangs by hand any more. `done` advances
 * exactly as a completed conversation's would: the run has moved past this one, whatever it got from it.
 *
 * @param index the abandoned conversation's 0-based position, reported as `done` after the increment
 * @param line the structured skip line, already composed
 * @param total how many conversations the crawl will visit
 * @param totals the running totals, whose `skipped` the caller has already advanced
 * @param onProgress the sink, or undefined when nothing is watching
 */
export function absorbChannelStall({
  index,
  line,
  total,
  totals,
  onProgress,
}: {
  index: number;
  line: string;
  total: number;
  totals: SlackCrawlTotals;
  onProgress: SourceProgress | undefined;
}): void {
  onProgress?.(
    sourceHeartbeat({
      currentItem: { title: line },
      done: index + 1,
      metrics: { messages: totals.messages, skipped: totals.skipped, threads: totals.threads },
      phase: "channel",
      source: "slack",
      total,
    }),
  );
}

/**
 * Fold one crawled channel's counts into the running totals + emit its preview and a `done` heartbeat.
 *
 * @param channel the channel just crawled
 * @param index its 0-based position, reported as `done` after the increment
 * @param items the channel's shaped items, whose counts are folded in
 * @param total how many channels the crawl will visit
 * @param totals the running totals, MUTATED in place — this is the accumulator, not a copy
 * @param onProgress the sink, or undefined when nothing is watching
 */
export function absorbChannelProgress({
  channel,
  index,
  items,
  total,
  totals,
  onProgress,
}: {
  channel: { id: string; name?: string };
  index: number;
  items: SlackChannelItems;
  total: number;
  totals: SlackCrawlTotals;
  onProgress: SourceProgress | undefined;
}): void {
  const counts = slackChannelCounts({ items });
  totals.messages += counts.messages;
  totals.threads += counts.threads;
  const preview = slackChannelPreview({ channel, items });
  if (preview !== undefined) {
    onProgress?.(preview);
  }
  onProgress?.(
    sourceHeartbeat({
      done: index + 1,
      metrics: { messages: totals.messages, skipped: totals.skipped, threads: totals.threads },
      phase: "channel",
      source: "slack",
      total,
    }),
  );
}
