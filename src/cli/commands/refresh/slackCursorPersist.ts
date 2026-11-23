/**
 * The Slack crawl's two secondary resume stores — the thread cursors and the per-channel backfill watermarks —
 * written as each conversation commits and once the crawl completes. Split out of `tokenedJobsSlack.ts`, which
 * keeps the crawl itself; this file holds only the decision of which cursors a run has earned.
 */
import { advanceSlackChannelWatermarks, computeChannelWatermarks } from "../../../corpus/slack/channelWatermark.js";
import type { SlackCursorWriteError } from "../../../corpus/slack/cursorWriteErrors.js";
import type { SlackActivity } from "../../../corpus/slack/fetch.js";
import { writeThreadCursors } from "../../../corpus/slack/threadCursors.js";
import { ok, type Result } from "../../../lib/result.js";

/**
 * Persist the per-channel backfill cursors this crawl earned.
 *
 * `bounded` withholds the write entirely, for the same reason a sampled run withholds thread cursors and one
 * stronger: an entry here is the claim "this channel has been backfilled to the end", which a run that was
 * capped mid-channel has not earned, and a false entry is worse than none — it removes the channel from the
 * coverage report's gap list forever.
 *
 * @param activity the completed crawl
 * @param until the window end, stored for a channel that was read and held nothing
 * @param home the Slopweaver home
 * @param bounded whether `--sample`/`--fetch-cap` bounded the run, so no cursor may be persisted
 * @param nowIso the clock this pass is judged by — `until` is today+1, so without it every quiet channel
 *   banks TOMORROW and that value is the next run's ingest floor
 * @returns the write result, or `ok(undefined)` when the write was deliberately withheld
 */
function persistChannelWatermarks({
  activity,
  until,
  home,
  bounded,
  nowIso,
}: {
  activity: SlackActivity;
  until: string;
  home: string;
  bounded: boolean;
  nowIso: () => string;
}): Result<{ path: string } | undefined, SlackCursorWriteError> {
  if (bounded) {
    return ok(undefined);
  }
  return advanceSlackChannelWatermarks({
    advances: computeChannelWatermarks({
      fallbackUntil: until,
      fullHistory: activity.fullHistoryChannels,
      nowIso: nowIso(),
      // One observation per conversation rather than one per message: the store keeps the MAX per channel,
      // and the crawl already folded each banked conversation down to exactly that (its items are gone).
      observed: activity.channelSummaries.map((summary) => ({
        channel: summary.channelId,
        tsIso: summary.maxTsIso,
      })),
      visited: activity.visitedChannels,
      walkedMessages: activity.channelMessageCounts,
    }),
    home,
  });
}

/**
 * Mark ONE conversation backfilled, the instant its bronze commit lands.
 *
 * The observation is the conversation's own max `tsIso` rather than one entry per message: the store keeps
 * the max per channel anyway, and asking the crawl for it is the same answer at a fraction of the garbage.
 * An empty conversation reports `""`, which `computeChannelWatermarks` skips in favour of `until` — that is
 * what gives a read-but-quiet channel an entry at all, and so stops it being re-backfilled every run.
 *
 * The crawl HANDS OVER that timestamp rather than this deriving it from `items`, because on a conversation
 * the crawl flushed mid-way `items` is only the tail — and `conversations.history` being newest-first, the
 * tail's max is the OLDEST row read. See `corpus/slack/fetch.SlackChannelCommit`'s `maxTsIso`.
 *
 * Only a completed conversation ever gets here. A mid-conversation flush goes through
 * `SlackChannelPartialCommit`, which carries neither `oldest` nor `maxTsIso` and so cannot call this.
 *
 * @param home the Slopweaver home
 * @param channelId the conversation just committed
 * @param maxTsIso the newest `tsIso` the whole conversation yielded, flushed prefix included
 * @param oldest the Slack `oldest` it was read from — `"0"` (the epoch sentinel) is the completion marker;
 *   anything else means the read started part-way through, which is not a full backfill however much it wrote
 * @param until the window end, stored for a conversation that yielded no usable timestamp
 * @param nowIso the instant this conversation finished, which is as far as reading it can prove
 * @param walkedMessages top-level rows this conversation's history walk was served, when that walk ran to the
 *   end of the channel — the `knownMessages` the NEXT run's lane decision reads
 * @returns where the store was written, or the typed write failure
 */
export function markConversationBackfilled({
  home,
  channelId,
  maxTsIso,
  oldest,
  until,
  nowIso,
  walkedMessages,
}: {
  home: string;
  channelId: string;
  maxTsIso: string;
  oldest: string;
  until: string;
  nowIso: string;
  walkedMessages?: number;
}): Result<{ path: string }, SlackCursorWriteError> {
  return advanceSlackChannelWatermarks({
    advances: computeChannelWatermarks({
      fallbackUntil: until,
      fullHistory: Number(oldest) <= 0 ? [channelId] : [],
      nowIso,
      observed: [{ channel: channelId, tsIso: maxTsIso }],
      visited: [channelId],
      ...(walkedMessages !== undefined ? { walkedMessages: new Map([[channelId, walkedMessages]]) } : {}),
    }),
    home,
  });
}

/**
 * Persist BOTH of Slack's secondary resume stores and fold any write failure into the run's warnings.
 *
 * A sampled run persists neither. For the thread cursors that is because a later full refresh would resume
 * past the sampled tip and never write the un-sampled replies; for the per-channel store it is stronger still,
 * since an entry there is the claim "this channel has been backfilled to the end", and a bounded run has not
 * earned it. A false entry is worse than no entry: it removes the channel from the coverage report forever.
 *
 * @param activity the completed crawl
 * @param until the window end, stored for a channel that was read and held nothing
 * @param home the Slopweaver home
 * @param sampled whether `--sample` bounded the run
 * @param bounded whether `--sample` OR `--fetch-cap` bounded it, which the per-channel store also refuses
 * @param nowIso the clock the per-channel cursors are clamped to
 * @returns the crawl's warnings plus one line per store that failed to write
 */
export function persistSlackCursors({
  activity,
  until,
  home,
  sampled,
  bounded,
  nowIso,
}: {
  activity: SlackActivity;
  until: string;
  home: string;
  sampled: boolean;
  bounded: boolean;
  nowIso: () => string;
}): readonly string[] {
  const threads = sampled ? ok(undefined) : writeThreadCursors({ cursors: activity.threadCursors, home });
  const channels = persistChannelWatermarks({ activity, bounded, home, nowIso, until });
  return [
    ...activity.warnings,
    ...(threads.isErr() ? [`thread-cursor persist failed: ${threads.error.message}`] : []),
    ...(channels.isErr() ? [`channel-watermark persist failed: ${channels.error.message}`] : []),
  ];
}
