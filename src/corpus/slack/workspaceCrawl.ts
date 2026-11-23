/**
 * The workspace-level crawl: page every selected channel's history + threads (via `channelRead.js`'s
 * `fetchChannel`), commit or retain each conversation, and fold the results into one accumulator. Split out
 * of `fetch.ts`, which builds the {@link ChannelCrawlRun} bundle once per refresh and calls
 * {@link crawlChannels} exactly once.
 */
import { logger } from "../../lib/logger.js";
import type { SourceProgress } from "../progress.js";
import type { ChannelDeadlineFactory, ChannelProgressSnapshot } from "./channelDeadline.js";
import { channelStallLine } from "./channelDeadline.js";
import { bindPartialCommit, type ChannelRead, fetchChannel } from "./channelRead.js";
import type { SlackChannelSummary } from "./channelSummary.js";
import { wholeChannelSummary } from "./channelSummary.js";
import type { ChannelWatermarkEntry } from "./channelWatermark.js";
import type { SlackApi, SlackChannelCommit, SlackChannelPartialCommit, SlackChannelRef } from "./fetch.js";
import { absorbChannelProgress, absorbChannelStall, type SlackCrawlTotals, startChannelHeartbeat } from "./progress.js";
import type { SlackChannelItems } from "./project.js";
import { type ChannelReadPlan, planChannelRead } from "./reach.js";
import { channelPrivacy } from "./shape.js";
import { mergeCursorUpdates, type ThreadCursors } from "./threadCursors.js";
import { countThreadsPerChannel, storedThreadsOf } from "./threadOracle.js";
import type { SlackNameMaps } from "./visibleProse.js";

/**
 * Everything one channel crawl holds CONSTANT across every conversation it reads: the injected seams, the
 * window, the name maps, the sinks and the run's own size.
 *
 * Bundled rather than threaded because it travels unchanged from `fetch.ts`'s `fetchSlackActivity` down to
 * each conversation's paging loop, and ten unchanging arguments passed by hand through three functions is
 * exactly how one of them quietly stops being passed — which for `onChannelPartialCommit` would silently
 * restore the unbounded-conversation crash this module's flush exists to prevent.
 */
export interface ChannelCrawlRun {
  readonly api: SlackApi;
  readonly bounds: { oldest: string; latest: string };
  readonly maps: SlackNameMaps;
  readonly threadCursors: ThreadCursors;
  readonly workspaceUrl: string;
  /** Arms one conversation's progress watchdog — see {@link ChannelDeadlineFactory}. */
  readonly channelDeadline: ChannelDeadlineFactory;
  /**
   * The clock each conversation's read plan is judged against — no ingest floor may sit ahead of it
   * (`./reach.ts#planChannelOldest`). Read PER CONVERSATION rather than once for the run, because a full
   * backfill crawls for hours and a conversation reached at hour 30 may honestly be read to hour 30.
   */
  readonly nowIso: () => string;
  /** How many conversations this run is crawling, for the heartbeat's denominator. */
  readonly total: number;
  readonly onProgress?: SourceProgress;
  readonly onChannelCommit?: SlackChannelCommit;
  readonly onChannelPartialCommit?: SlackChannelPartialCommit;
  readonly maxItems?: number;
}

/** A fresh accumulator, seeded with the thread cursors a previous crawl earned. */
function emptyWorkspaceCrawl({ threadCursors }: { threadCursors: ThreadCursors }): WorkspaceCrawl {
  return {
    abandoned: [],
    cursors: { ...threadCursors },
    fullHistory: [],
    walkedMessages: new Map(),
    maxTsIso: "",
    retained: [],
    summaries: [],
    totals: { messages: 0, skipped: 0, threads: 0 },
    visited: [],
    warnings: [],
  };
}

/**
 * The running workspace-level accumulator {@link crawlOneChannel} folds each channel into.
 *
 * `retained` is the memory this run carries and `summaries` is what it carries INSTEAD once a conversation
 * is banked — see `channelSummary.SlackChannelSummary` for the measured crash that split them apart.
 */
interface WorkspaceCrawl {
  readonly retained: SlackChannelItems[];
  readonly summaries: SlackChannelSummary[];
  /** The newest `tsIso` seen across every recorded conversation. */
  maxTsIso: string;
  readonly warnings: string[];
  readonly visited: string[];
  /** The visited channels read from the Slack epoch. */
  readonly fullHistory: string[];
  /**
   * The conversations whose progress deadline expired, so this run did NOT read them. Typed rather than read
   * back out of `warnings`, because it is what makes the refresh report a coverage gap instead of exiting 0.
   */
  readonly abandoned: SlackChannelRef[];
  /** Channel id → top-level rows a COMPLETED history walk was served, for the channels whose walk finished. */
  readonly walkedMessages: Map<string, number>;
  readonly totals: SlackCrawlTotals;
  cursors: ThreadCursors;
}

/** Crawl ONE channel into `acc`. An unreadable channel warns and is skipped — never fatal, and never
 *  recorded as visited, so the next run still offers it a full backfill. A channel that STALLS is skipped the
 *  same way, on the same terms: see {@link abandonStalledChannel}. */
async function crawlOneChannel({
  acc,
  channel,
  index,
  plan,
  run,
}: {
  acc: WorkspaceCrawl;
  channel: SlackChannelRef;
  index: number;
  plan: ChannelReadPlan;
  run: ChannelCrawlRun;
}): Promise<void> {
  const { api, bounds, maps, maxItems, onChannelCommit, onProgress, workspaceUrl } = run;
  const deadline = run.channelDeadline();
  const oldest = plan.ingestOldest;
  try {
    // Which lane a conversation took is the one thing about this crawl that cannot be inferred from its
    // output: an oracle-lane channel and a poll-lane one produce the same bronze rows by different traffic.
    logger.info({
      msg: `slack ${channel.id}: ${plan.lane} (walk from ${plan.walkOldest}, ingest from ${plan.ingestOldest})`,
    });
    const onPartialCommit = bindPartialCommit({ channel, maps, seam: run.onChannelPartialCommit });
    const result = await fetchChannel({
      api,
      ctx: { channelId: channel.id, channelName: channel.name, workspaceUrl, ...channelPrivacy({ channel }) },
      deadline,
      latest: bounds.latest,
      plan,
      threadCursors: run.threadCursors,
      ...(maxItems !== undefined ? { maxItems } : {}),
      ...(onPartialCommit !== undefined ? { onPartialCommit } : {}),
    });
    if (result.kind === "stalled") {
      const stall = { acc, at: result.at, channel, index, total: run.total };
      abandonStalledChannel({ ...stall, ...(onProgress !== undefined ? { onProgress } : {}) });
      return;
    }
    bankCrawledChannel({
      acc,
      channel,
      index,
      maps,
      oldest,
      result,
      total: run.total,
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(onChannelCommit !== undefined ? { onChannelCommit } : {}),
    });
  } catch (error: unknown) {
    // A channel we can't read (e.g. not_in_channel) is skipped with a warning, never fatal — so one
    // unreadable channel never sinks the whole "all my channels" ingest.
    acc.totals.skipped += 1;
    acc.warnings.push(`channel ${channel.id} skipped: ${error instanceof Error ? error.message : "unknown"}`);
  } finally {
    // Mandatory, and not just tidiness: the watchdog's timer is deliberately not `unref`'d, so a run that
    // left one armed would sit out the whole stall window after its last channel finished.
    deadline.release();
  }
}

/**
 * Abandon a conversation whose progress deadline expired, and move on.
 *
 * What it records is the point. `skipped`, one warning and an `abandoned` entry — and NOTHING else: no summary, no `visited`
 * entry, no `fullHistory` entry, no thread-cursor advance. Those are the four inputs to a completion claim,
 * so withholding all four leaves the conversation exactly as unread as it was, which is what makes the next
 * pass offer it a full backfill with no human maintaining an exclusion list. Rows a mid-conversation flush
 * already banked stay on disk and cannot read as complete — see `SlackChannelPartialCommit`.
 *
 * @param acc the running workspace accumulator, MUTATED
 * @param at where the conversation's crawl had got to when it froze
 * @param channel the abandoned conversation
 * @param index its 0-based position in the run, for the heartbeat
 * @param total how many conversations this run is crawling, for the heartbeat
 * @param onProgress the heartbeat sink, when something is watching
 */
function abandonStalledChannel({
  acc,
  at,
  channel,
  index,
  total,
  onProgress,
}: {
  acc: WorkspaceCrawl;
  at: ChannelProgressSnapshot;
  channel: SlackChannelRef;
  index: number;
  total: number;
  onProgress?: SourceProgress;
}): void {
  acc.totals.skipped += 1;
  acc.abandoned.push(channel);
  const line = channelStallLine({ at, channelId: channel.id });
  acc.warnings.push(line);
  absorbChannelStall({ index, line, onProgress, total, totals: acc.totals });
}

/**
 * Commit one conversation that has been read to the END, then record it — or record the failure.
 *
 * Committed BEFORE anything is recorded, so the two can never disagree: an entry in `visited` is the claim
 * "this conversation is in bronze", and a commit that failed has not earned it. A failed commit is warned and
 * counted as a skip, exactly like an unreadable channel — the next run offers it a full backfill.
 *
 * @param acc the running workspace accumulator, MUTATED
 * @param channel the conversation just read
 * @param index this conversation's position in the run, for the heartbeat
 * @param maps the id→name maps built once for this refresh
 * @param oldest the Slack `oldest` it was read from
 * @param result what the channel fetch produced — `items` is the TAIL when the crawl flushed mid-conversation
 * @param total how many conversations this run is crawling, for the heartbeat
 * @param onProgress the heartbeat sink, when something is watching
 * @param onChannelCommit the per-conversation commit seam, absent when the caller writes once at the end
 */
function bankCrawledChannel({
  acc,
  channel,
  index,
  maps,
  oldest,
  result,
  total,
  onProgress,
  onChannelCommit,
}: {
  acc: WorkspaceCrawl;
  channel: SlackChannelRef;
  index: number;
  maps: SlackNameMaps;
  oldest: string;
  result: Extract<ChannelRead, { kind: "read" }>;
  total: number;
  onProgress?: SourceProgress;
  onChannelCommit?: SlackChannelCommit;
}): void {
  const summary = wholeChannelSummary({ flushed: result.flushed, items: result.items });
  const committed = onChannelCommit?.({
    channel,
    items: result.items,
    maps,
    maxTsIso: summary.maxTsIso,
    oldest,
    ...(result.walkedMessages !== undefined ? { walkedMessages: result.walkedMessages } : {}),
  });
  if (committed?.isErr() === true) {
    acc.totals.skipped += 1;
    acc.warnings.push(`channel ${channel.id} read but NOT committed: ${committed.error.join("; ")}`);
    // Its items are RETAINED rather than dropped: the end-of-run bulk write is the safety net for exactly this
    // case, and it is the only remaining route to disk for a conversation whose own commit failed. A prefix an
    // earlier flush already banked is on disk regardless — the two together still cover the whole read.
    // Nothing else is recorded, so the channel stays out of `visited` and the next run re-reads it whole.
    acc.retained.push(result.items);
    return;
  }
  recordCrawledChannel({ acc, banked: committed !== undefined, channel, oldest, result, summary });
  absorbChannelProgress({ channel, index, items: result.items, onProgress, total, totals: acc.totals });
}

/**
 * Fold one successfully read + committed conversation into the workspace accumulator.
 *
 * Everything here is recorded on SUCCESS only, and before any emptiness check: a channel that was read and
 * held nothing IS backfilled, while a channel whose read threw is not — collapsing those two would either
 * re-crawl every quiet channel from the epoch forever, or mark an unread one as done.
 *
 * `banked` is what bounds the run's memory. A conversation a commit seam already put on disk is folded to a
 * {@link SlackChannelSummary} and its items are released; one nothing banked is kept, because the end-of-run
 * bulk write is then the only thing that will ever write it. Both cases are summarised — the summary is what
 * every later step reads, banked or not.
 *
 * @param acc the running workspace accumulator, mutated
 * @param banked whether a per-conversation commit already wrote this conversation to bronze
 * @param channel the conversation just read
 * @param oldest the Slack `oldest` it was read from — `"0"` (the epoch) is what makes it a full backfill
 * @param result what the channel fetch produced
 * @param summary the WHOLE conversation's summary, mid-crawl flushes included — see `wholeChannelSummary`
 */
function recordCrawledChannel({
  acc,
  banked,
  channel,
  oldest,
  result,
  summary,
}: {
  acc: WorkspaceCrawl;
  banked: boolean;
  channel: SlackChannelRef;
  oldest: string;
  result: {
    items: SlackChannelItems;
    warnings: readonly string[];
    cursorUpdates: ThreadCursors;
    walkedMessages?: number;
  };
  summary: SlackChannelSummary;
}): void {
  acc.summaries.push(summary);
  acc.maxTsIso = summary.maxTsIso > acc.maxTsIso ? summary.maxTsIso : acc.maxTsIso;
  if (!banked) {
    acc.retained.push(result.items);
  }
  acc.warnings.push(...result.warnings);
  acc.visited.push(channel.id);
  if (Number(oldest) <= 0) {
    acc.fullHistory.push(channel.id);
  }
  if (result.walkedMessages !== undefined) {
    acc.walkedMessages.set(channel.id, result.walkedMessages);
  }
  acc.cursors = mergeCursorUpdates({ base: acc.cursors, updates: result.cursorUpdates });
}

/**
 * Crawl every selected channel: page its history + threads, commit or retain it, and merge its warnings +
 * cursors into one workspace-level result. An unreadable or stalled channel warns and is skipped — never
 * fatal, so one bad conversation never sinks the whole pass.
 *
 * @param selected the channels this run is crawling
 * @param channelCursors the per-channel backfill cursors — a channel ABSENT from this map has never been
 *   crawled at all
 * @param backfillNewChannels whether a never-crawled channel is read from the Slack EPOCH rather than from
 *   the window's own `since`
 * @param run everything the crawl holds constant across every conversation — see {@link ChannelCrawlRun}
 * @returns the retained (uncommitted) items, every conversation's summary, the newest `tsIso` seen, every
 *   warning raised, the updated thread cursors, the visited channel ids, the ids read from the epoch, and
 *   the per-channel count of rows a completed history walk served, and the conversations abandoned as stalled
 */
export async function crawlChannels({
  selected,
  channelCursors,
  backfillNewChannels,
  run,
}: {
  selected: readonly SlackChannelRef[];
  channelCursors: ReadonlyMap<string, ChannelWatermarkEntry>;
  backfillNewChannels: boolean;
  run: ChannelCrawlRun;
}): Promise<{
  retained: readonly SlackChannelItems[];
  summaries: readonly SlackChannelSummary[];
  maxTsIso: string;
  warnings: readonly string[];
  cursors: ThreadCursors;
  visited: readonly string[];
  fullHistory: readonly string[];
  walkedMessages: ReadonlyMap<string, number>;
  abandoned: readonly SlackChannelRef[];
}> {
  const acc = emptyWorkspaceCrawl({ threadCursors: run.threadCursors });
  const threadsPerChannel = countThreadsPerChannel({ cursors: run.threadCursors });
  for (const [index, channel] of selected.entries()) {
    startChannelHeartbeat({ channel, index, onProgress: run.onProgress, total: run.total });
    await crawlOneChannel({
      acc,
      channel,
      index,
      plan: planChannelRead({
        backfillNew: backfillNewChannels,
        knownThreads: storedThreadsOf({ channel: channel.id, counts: threadsPerChannel }),
        nowIso: run.nowIso(),
        stored: channelCursors.get(channel.id),
        windowOldest: run.bounds.oldest,
      }),
      run,
    });
  }
  return acc;
}
