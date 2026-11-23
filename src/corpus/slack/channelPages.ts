/**
 * How ONE history page becomes items in a conversation's accumulator — the shaping, the thread polls it
 * fans out to, and the running row count the crawl's watchdog reports.
 *
 * Split out of `fetch.ts` for the same reason `progress.ts` was: that file is the impure Slack edge and sits
 * at its code-line ceiling, so the piece with the clearest boundary moves. This is that piece — everything
 * here is about ONE conversation being read, and nothing here knows about workspace discovery, the commit
 * seams or the run's accumulator.
 *
 * ## Two lanes, and why a page is read differently in each
 *
 * In the `poll-known-threads` lane a page is what it always was: Slack already bounded it by `oldest`, every
 * row is ingested, and every root carrying replies is polled. In the `history-oracle` lane the walk is
 * UNBOUNDED (see `./threadOracle.ts` for the measurement), so a page carries two different kinds of row —
 * those at or after the channel's ingest floor, which are shaped into bronze exactly as before, and older
 * ones, which are read ONLY for the `reply_count`/`latest_reply` their roots carry. That split is what keeps
 * the write path as cheap as it is today while the read walks the whole channel: the oracle needs every
 * parent, bronze needs only the new ones.
 */
import { isRecord } from "../../lib/parsers.js";
import type { ChannelProgressDeadline } from "./channelDeadline.js";
import type { SlackApi } from "./fetch.js";
import type { SlackMessageItem, SlackReplyItem } from "./project.js";
import { type ChannelReadPlan, SLACK_EPOCH_OLDEST } from "./reach.js";
import { type ChannelContext, planThreadPolls, shapeHistoryPage } from "./shape.js";
import { type ThreadCursor, type ThreadCursors, threadKey } from "./threadCursors.js";
import { threadRootsInPage, threadsNeedingPoll } from "./threadOracle.js";
import { pollThread, type ThreadPoll } from "./threadReplies.js";

/** Everything ONE conversation's read holds constant: the seam, its context, its watchdog and its plan. */
export interface ChannelReadArgs {
  readonly api: SlackApi;
  readonly ctx: ChannelContext;
  readonly deadline: ChannelProgressDeadline;
  readonly plan: ChannelReadPlan;
  readonly threadCursors: ThreadCursors;
  readonly maxItems?: number;
}

/** A mutable per-channel accumulator the paging loop folds thread polls + shaped messages into. */
export interface ChannelCrawl {
  readonly messages: SlackMessageItem[];
  readonly replies: SlackReplyItem[];
  readonly warnings: string[];
  readonly cursorUpdates: Record<string, ThreadCursor>;
  readonly visited: Set<string>;
  /**
   * What {@link flushWithinChannel} already banked and RELEASED from `messages`/`replies`.
   *
   * The counts have to outlive the items they describe, because three things downstream still ask about a
   * conversation the crawl no longer holds: the fetch cap counts every message it was served, the curated
   * lane ranks on the whole conversation's item count, and the per-channel cursor is its NEWEST timestamp —
   * which, `conversations.history` being newest-first, sits in the FIRST batch flushed away.
   */
  readonly flushed: ChannelFlushTotals;
  /**
   * Every top-level row `conversations.history` SERVED for this conversation, ingested or not.
   *
   * Distinct from the shaped-message count on purpose, and it is what the fetch cap now counts. In the
   * oracle lane a page's older rows are read for their thread fields and never shaped, so a cap counting
   * shaped messages would let a bounded run walk without limit; and the count of rows a completed walk was
   * served is exactly the `knownMessages` the NEXT run's lane decision needs.
   */
  served: number;
}

/** What a conversation's mid-crawl flushes banked, kept after their items are released. */
export interface ChannelFlushTotals {
  /** Top-level messages banked — the fetch cap's own count, which `messages.length` no longer supplies. */
  messages: number;
  /** Messages + replies banked, for the summary's `itemCount`. */
  items: number;
  /** The newest `tsIso` banked, or `""` when nothing dated was. */
  maxTsIso: string;
}

/** Fold one thread poll into the channel accumulator (replies + warnings + cursor advance). */
function absorbPoll({ crawl, poll }: { crawl: ChannelCrawl; poll: ThreadPoll }): void {
  crawl.replies.push(...poll.replies);
  crawl.warnings.push(...poll.warnings);
  if (poll.cursorUpdate !== undefined) {
    crawl.cursorUpdates[poll.cursorUpdate.key] = poll.cursorUpdate.cursor;
  }
}

/**
 * Every message and reply this conversation has read, banked prefixes included. Pure.
 *
 * The watchdog reports this on a skip, and it has to count the banked prefix: on a conversation that has
 * flushed, the arrays hold only the tail, so `messages.length + replies.length` would say a channel that
 * read 200,000 rows before freezing had read a few thousand.
 *
 * @param crawl the running channel crawl
 * @returns the row count so far
 */
export function crawlRows({ crawl }: { crawl: ChannelCrawl }): number {
  return crawl.flushed.items + crawl.messages.length + crawl.replies.length;
}

/** The rows of a page that belong in bronze — everything at or after the ingest floor. Pure. */
function rowsToIngest({
  messages,
  ingestOldest,
}: {
  messages: readonly unknown[];
  ingestOldest: string;
}): readonly unknown[] {
  if (Number(ingestOldest) <= 0) {
    return messages;
  }
  const floor = Number(ingestOldest);
  return messages.filter((raw) => isRecord(raw) && Number(raw["ts"]) >= floor);
}

/** Poll ONE thread parent for its NEW replies, folding them into `crawl` and marking it visited. */
async function pollOneThread({
  api,
  ctx,
  crawl,
  deadline,
  threadCursors,
  threadTs,
  windowOldest,
  observedReplyCount,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  crawl: ChannelCrawl;
  deadline: ChannelProgressDeadline;
  threadCursors: ThreadCursors;
  threadTs: string;
  windowOldest: string;
  observedReplyCount?: number;
  maxItems?: number;
}): Promise<void> {
  const key = threadKey({ channel: ctx.channelId, threadTs });
  crawl.visited.add(key);
  deadline.awaiting({ phase: "page-threads" });
  const poll = await pollThread({
    api,
    ctx,
    stored: threadCursors[key]?.ts,
    threadTs,
    windowOldest,
    ...(observedReplyCount !== undefined ? { observedReplyCount } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  absorbPoll({ crawl, poll });
  deadline.progressed({ of: "thread", rows: crawlRows({ crawl }) });
}

/** Poll every thread parent surfaced in one history page — the pre-oracle lane, unchanged. */
async function pollEveryPageThread({
  api,
  ctx,
  crawl,
  deadline,
  threadCursors,
  messages,
  oldest,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  crawl: ChannelCrawl;
  deadline: ChannelProgressDeadline;
  threadCursors: ThreadCursors;
  messages: readonly unknown[];
  oldest: string;
  maxItems?: number;
}): Promise<void> {
  for (const { threadTs } of planThreadPolls({ messages })) {
    if (deadline.abandoned()) {
      return;
    }
    await pollOneThread({
      api,
      crawl,
      ctx,
      deadline,
      threadCursors,
      threadTs,
      windowOldest: oldest,
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
  }
}

/**
 * Ask the page which of its thread roots actually moved, and poll only those.
 *
 * Every root is marked VISITED whether or not it is polled, and that is what makes the fallback sweep in
 * {@link pollKnownThreads} mean something precise afterwards: what it walks is exactly the stored threads
 * whose parent this channel's whole history did NOT contain — a deleted parent, and nothing else.
 *
 * A root the oracle proved unchanged still records a cursor update, carrying the `reply_count` just
 * observed. That costs no call and is what arms the deletion detector for a thread migrated from the legacy
 * cursor file, which has a cursor but no count anyone ever agreed with.
 *
 * ## What a caller-pinned FLOOR changes here
 *
 * The walk runs to the epoch in this lane whatever the request's floor, because a walked row is filtered by
 * `ingestOldest` before it is shaped ({@link rowsToIngest}) — so the walk cannot widen what bronze receives.
 * A thread the walk merely NAMES is the exception, and it splits three ways on one fact: **a reply is always
 * newer than its parent.**
 *
 * - **A root with a stored cursor** is polled from that cursor, which is a fetched-through claim and honest
 *   whatever the request asked for.
 * - **A cursorless root at or above `ingestOldest`** — a thread CREATED inside the requested window, which
 *   is the main thing a catch-up run is for — can have no reply below the floor at all, so it is polled from
 *   `ingestOldest`. That fetches the whole thread and stores a cursor that honestly covers it.
 * - **A cursorless root BELOW `ingestOldest`** is the only real conflict: read whole it drags a years-old
 *   thread's replies in under a `--since`, read bounded it stores a cursor claiming coverage nobody fetched.
 *   With a floor in play it is therefore DEFERRED — no call, nothing ingested, no cursor recorded.
 *
 * A deferral loses nothing. The fallback sweep walks `Object.keys(threadCursors)`, which a cursorless root is
 * by definition not in, so leaving it out of `visited` is unobservable; and the next refresh with no pinned
 * floor takes this same lane, sees the same root, and reads it whole.
 */
async function pollOracleSelectedThreads({
  api,
  ctx,
  crawl,
  deadline,
  threadCursors,
  messages,
  read,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  crawl: ChannelCrawl;
  deadline: ChannelProgressDeadline;
  threadCursors: ThreadCursors;
  messages: readonly unknown[];
  read: ChannelReadPlan;
  maxItems?: number;
}): Promise<void> {
  const roots = threadRootsInPage({ messages });
  const plan = threadsNeedingPoll({ channel: ctx.channelId, cursors: threadCursors, roots });
  for (const { key, cursor } of plan.confirmed) {
    crawl.visited.add(key);
    crawl.cursorUpdates[key] = cursor;
  }
  for (const root of plan.poll) {
    if (deadline.abandoned()) {
      return;
    }
    const stored = threadCursors[threadKey({ channel: ctx.channelId, threadTs: root.threadTs })];
    const floor =
      stored !== undefined ? SLACK_EPOCH_OLDEST : cursorlessRootFloor({ plan: read, threadTs: root.threadTs });
    if (floor === undefined) {
      continue;
    }
    await pollOneThread({
      api,
      crawl,
      ctx,
      deadline,
      observedReplyCount: root.replyCount,
      threadCursors,
      threadTs: root.threadTs,
      // Only ever consulted for a root with NO stored cursor — `pollThread` prefers the cursor. See the
      // three-way split in this function's own doc comment for why this is the epoch or the ingest floor.
      windowOldest: floor,
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
  }
}

/**
 * The `oldest` a CURSORLESS oracle-surfaced root is read from, or `undefined` when it must be deferred. Pure.
 *
 * @param plan this conversation's read plan, whose floor and window mode decide it
 * @param threadTs the root's own timestamp, which bounds how old its replies can possibly be
 * @returns the epoch when nothing is pinned, `ingestOldest` for a root at or above that floor, and
 *   `undefined` for a root below a pinned floor — the one case where reading it either widens bronze or
 *   stores a cursor claiming coverage nobody fetched
 */
export function cursorlessRootFloor({
  plan,
  threadTs,
}: {
  plan: ChannelReadPlan;
  threadTs: string;
}): string | undefined {
  if (!plan.pinnedWindow) {
    return SLACK_EPOCH_OLDEST;
  }
  // A reply is always newer than its parent, so a root at or above the floor has none below it: reading it
  // from the floor is both complete and an honest cursor.
  return Number(threadTs) >= Number(plan.ingestOldest) ? plan.ingestOldest : undefined;
}

/**
 * Fold ONE history page into the crawl: shape the rows that belong in bronze, then deal with its threads.
 *
 * A page that SHAPES to zero messages no longer stops the crawl, which is why this does not report emptiness.
 * `shapeHistoryPage` drops rows without a `ts`, and Slack documents returning zero rows while still carrying a
 * cursor, so the old no-growth guard could end a channel's crawl mid-history and report the prefix as the whole
 * channel.
 *
 * @param crawl the running channel crawl, MUTATED in place
 * @param messages the page's raw rows
 * @param read everything this conversation's read holds constant, including its lane and its two bounds
 */
export async function absorbHistoryPage({
  crawl,
  messages,
  read,
}: {
  crawl: ChannelCrawl;
  messages: readonly unknown[];
  read: ChannelReadArgs;
}): Promise<void> {
  const { ctx, plan } = read;
  crawl.served += messages.length;
  crawl.messages.push(
    ...shapeHistoryPage({ ctx, messages: rowsToIngest({ ingestOldest: plan.ingestOldest, messages }) }),
  );
  const args = {
    api: read.api,
    crawl,
    ctx,
    deadline: read.deadline,
    messages,
    threadCursors: read.threadCursors,
    ...(read.maxItems !== undefined ? { maxItems: read.maxItems } : {}),
  };
  if (plan.lane === "history-oracle") {
    await pollOracleSelectedThreads({ ...args, read: plan });
    return;
  }
  await pollEveryPageThread({ ...args, oldest: plan.walkOldest });
}

/**
 * How many threads one channel's fallback sweep may re-poll before the run says so out loud.
 *
 * The sweep costs one `conversations.replies` call per thread and nothing re-arms a wall clock against it,
 * so a large one is a long silence that looks exactly like the hang `./channelDeadline.ts` exists to catch —
 * and is not one. MEASURED on the live workspace: a 194-thread channel took 3m54s against the
 * 2m18s a 1-thread one takes, so the sweep itself is **0.49s per thread** under Slack tier-3 rate limiting,
 * and it wrote nothing. 200 is therefore roughly "this channel is about to go quiet for a minute and a half
 * with nothing to show", which is the point at which a reader deserves to be told rather than left inferring
 * it from wall clock. Reproduce both halves:
 * `slopweaver refresh --source slack --lookback-days 2 --no-derive --slack-channel C0SYN000037` against
 * `--slack-channel C0SYN000044`.
 */
export const SLACK_WIDE_SWEEP_THREADS = 200;

/**
 * The warning a channel raises when its fallback sweep is large enough to be mistaken for a hang. Pure.
 *
 * @param channelId the channel about to be swept
 * @param threads how many stored cursors the walk did not cover, which is exactly the call count
 * @returns the line, or undefined when the sweep is small enough to pass unremarked
 */
export function wideSweepWarning({ channelId, threads }: { channelId: string; threads: number }): string | undefined {
  if (threads <= SLACK_WIDE_SWEEP_THREADS) {
    return undefined;
  }
  return [
    `slack channel ${channelId}: fallback sweep will poll ${String(threads)} known thread(s)`,
    `the history walk did not cover — one conversations.replies call each, so this channel is expected to`,
    `report no progress for a while. It is working, not hung.`,
  ].join(" ");
}

/**
 * Re-poll KNOWN threads in this channel that the history walk did not touch — the fallback sweep.
 *
 * What it covers depends on which lane the channel took, and in both cases it is the same idea: a thread
 * whose parent the walk never returned is still reachable by its stored cursor. In the poll lane that is a
 * parent outside the bounded window; in the oracle lane, where the walk read the channel end to end, it is
 * the one case the oracle genuinely cannot see — a thread whose PARENT was deleted, so it has left history
 * while its replies have not. `src/live/listen/recoverThreads.ts` argues the same case against an age
 * horizon: dropping a thread after N days recreates exactly the old-thread blind spot both features exist
 * to close, so this sweep is bounded by what the walk did NOT cover rather than by age.
 *
 * @param crawl the running channel crawl, MUTATED in place
 * @param read everything this conversation's read holds constant
 */
export async function pollKnownThreads({ crawl, read }: { crawl: ChannelCrawl; read: ChannelReadArgs }): Promise<void> {
  const { api, ctx, deadline, threadCursors } = read;
  const oldest = read.plan.ingestOldest;
  const maxItems = read.maxItems;
  const prefix = `${ctx.channelId}:`;
  const sweep = Object.keys(threadCursors).filter((key) => key.startsWith(prefix) && !crawl.visited.has(key));
  const notice = wideSweepWarning({ channelId: ctx.channelId, threads: sweep.length });
  if (notice !== undefined) {
    crawl.warnings.push(notice);
  }
  for (const key of sweep) {
    if (deadline.abandoned()) {
      return;
    }
    deadline.awaiting({ phase: "known-threads" });
    const poll = await pollThread({
      api,
      ctx,
      stored: threadCursors[key]?.ts,
      threadTs: key.slice(prefix.length),
      windowOldest: oldest,
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    absorbPoll({ crawl, poll });
    deadline.progressed({ of: "thread", rows: crawlRows({ crawl }) });
  }
}
