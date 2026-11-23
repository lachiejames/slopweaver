/**
 * One conversation's read: page its history + each thread's NEW replies to exhaustion (or until its progress
 * deadline expires), with a mid-crawl flush that banks a full batch of items and releases them so one
 * conversation bigger than the heap can still reach disk. Split out of `fetch.ts`, which keeps only the
 * workspace-level crawl that calls {@link fetchChannel} once per discovered channel.
 */
import { advanceOrWarn, openCursorPage } from "../../lib/paging.js";
import type { Result } from "../../lib/result.js";
import type { ChannelProgressDeadline, ChannelProgressSnapshot } from "./channelDeadline.js";
import {
  absorbHistoryPage,
  type ChannelCrawl,
  type ChannelFlushTotals,
  type ChannelReadArgs,
  crawlRows,
  pollKnownThreads,
} from "./channelPages.js";
import { summariseSlackChannel } from "./channelSummary.js";
import type { SlackApi, SlackChannelPartialCommit, SlackChannelRef, SlackMessagesPage } from "./fetch.js";
import type { SlackChannelItems, SlackMessageItem, SlackReplyItem } from "./project.js";
import type { ChannelReadPlan } from "./reach.js";
import { type ChannelContext, channelPrivacy } from "./shape.js";
import type { ThreadCursors } from "./threadCursors.js";
import type { SlackNameMaps } from "./visibleProse.js";

/**
 * How many shaped items ONE conversation may hold before the crawl banks them and lets them go.
 *
 * Chosen by measurement rather than taste. MEASURED as post-GC live heap (RSS is not
 * deterministic, and this is the number that is), shaping real recorded rows through the production
 * `shapeHistoryPage`: **2.1 KB retained per item** across 111,408 rows of the whole workspace mix, and
 * **6.1 KB per item** for the fattest recorded conversation — a machine-generated feed whose rows carry large
 * `attachments`/`blocks` payloads, which `shapeCommon` retains wholesale in `raw`. So one batch costs ~51 MB
 * typically and ~152 MB at that worst measured density, against the 4.00 GB a single un-flushed conversation
 * was measured holding while it failed to finish.
 *
 * Items rather than pages, though the flush is only ever CHECKED at a page boundary: a page's cost is its
 * messages plus every reply its threads yield, so pages bound the request count while items bound the thing
 * that actually ran out.
 */
export const SLACK_CHANNEL_FLUSH_ITEMS = 25_000;

/**
 * The mid-conversation flush seam, already bound to its conversation — see `SlackChannelPartialCommit`
 * for what it may and may not do.
 */
type ChannelPrefixCommit = (args: { items: SlackChannelItems }) => Result<{ written: number }>;

/** One conversation's items as the commit seams take them: its identity, plus what it holds right now. */
function channelItems({
  ctx,
  messages,
  replies,
}: {
  ctx: ChannelContext;
  messages: readonly SlackMessageItem[];
  replies: readonly SlackReplyItem[];
}): SlackChannelItems {
  return {
    channelId: ctx.channelId,
    messages: [...messages],
    replies: [...replies],
    ...(ctx.channelName !== undefined ? { channelName: ctx.channelName } : {}),
    ...channelPrivacy({ channel: ctx }),
  };
}

/**
 * Bank the pages this conversation has read SO FAR, and RELEASE them — so its memory is O(batch) rather than
 * O(conversation).
 *
 * This is the whole fix. A CONVERSATION is the commit grain, which bounds a run's memory by the
 * largest conversation instead of by the workspace; measured, that grain was still too coarse for
 * one bot feed, whose items alone reached 4.00 GB across ~2.5 h of crawling without ever finishing, so its
 * commit never fired and it could never be backfilled at all.
 *
 * What it deliberately does NOT do is anything a completion claim rests on. It writes rows and nothing else:
 * no completion marker, no cursor advance, no `visited` entry — which is why `SlackChannelPartialCommit`
 * carries neither `oldest` nor `maxTsIso`, the only two inputs those have. A partial commit that read as
 * backfilled would be strictly worse than the out-of-memory kill it replaces, because the kill is loud.
 *
 * A flush that FAILS keeps its items rather than dropping them: the conversation's own end commit, and behind
 * that the end-of-run bulk write, are then still routes to disk. That trades the memory bound back for
 * durability, which is the right way round — an OOM loses a run, a dropped batch loses records.
 *
 * @param crawl the running channel crawl, MUTATED — its banked items are cleared and its totals advanced
 * @param ctx the channel context, which supplies the identity every banked batch is written under
 * @param deadline this conversation's progress watchdog, re-armed by a batch that banks
 * @param onPartialCommit the prefix commit seam
 * @returns whether the batch was banked and released
 */
function flushWithinChannel({
  crawl,
  ctx,
  deadline,
  onPartialCommit,
}: {
  crawl: ChannelCrawl;
  ctx: ChannelContext;
  deadline: ChannelProgressDeadline;
  onPartialCommit: ChannelPrefixCommit;
}): boolean {
  const items = channelItems({ ctx, messages: crawl.messages, replies: crawl.replies });
  const banked = onPartialCommit({ items });
  if (banked.isErr()) {
    crawl.warnings.push(`channel ${ctx.channelId} prefix NOT flushed, kept in memory: ${banked.error.join("; ")}`);
    return false;
  }
  const summary = summariseSlackChannel({ items });
  crawl.flushed.messages += items.messages.length;
  crawl.flushed.items += summary.itemCount;
  crawl.flushed.maxTsIso = summary.maxTsIso > crawl.flushed.maxTsIso ? summary.maxTsIso : crawl.flushed.maxTsIso;
  crawl.messages.length = 0;
  crawl.replies.length = 0;
  // `visited` and `cursorUpdates` are deliberately KEPT: `pollKnownThreads` needs the first to know which
  // threads the history walk already covered, and the second is this conversation's thread-cursor advance,
  // which only lands if it finishes. Both are one short string per thread, not per message.
  deadline.progressed({ of: "flush", rows: crawlRows({ crawl }) });
  return true;
}

/**
 * Absorb one history page into the conversation, then bank the batch if it is now full.
 *
 * Split from the loop below because the two are different concerns at different grains — a page is a read,
 * a flush is a write — and because the loop's own shape (cursor, page ceiling, watchdog) is what a reader
 * comes to that function for.
 *
 * @param api the injected Slack seam
 * @param crawl the running channel crawl, MUTATED in place
 * @param ctx the channel context
 * @param deadline this conversation's progress watchdog
 * @param page everything `absorbHistoryPage` needs for this page, from `pageAbsorbArgs`
 * @param flush the prefix commit seam this conversation is still flushing through, if any
 * @returns the seam to keep flushing through, or `undefined` once this conversation has stopped flushing
 */
async function absorbPageAndFlush({
  flush,
  ...page
}: Parameters<typeof absorbHistoryPage>[0] & {
  flush?: ChannelPrefixCommit;
}): Promise<ChannelPrefixCommit | undefined> {
  await absorbHistoryPage(page);
  return flushIfBatchFull({
    crawl: page.crawl,
    ctx: page.read.ctx,
    deadline: page.read.deadline,
    ...(flush !== undefined ? { onPartialCommit: flush } : {}),
  });
}

/** Page a channel's history into `crawl` (each page capped by the remaining fetch-cap budget), polling
 *  each thread's NEW replies as it goes. Mutates `crawl` in place.
 *
 *  The `deadline.abandoned()` checks are not belt-and-braces. Once the watchdog has expired, this loop's
 *  result is going nowhere — but a call that unblocks minutes later would otherwise keep paging a whole
 *  channel into an accumulator nobody will ever read, on a run that has already moved on. */
async function pageChannelHistory({
  read,
  latest,
  crawl,
  onPartialCommit,
}: {
  read: ChannelReadArgs;
  latest: string;
  crawl: ChannelCrawl;
  onPartialCommit?: ChannelPrefixCommit;
}): Promise<boolean> {
  const { ctx, deadline, plan } = read;
  const laneLabel = `slack history for ${ctx.channelId}`;
  const cap = read.maxItems !== undefined ? { maxItems: read.maxItems } : {};
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  // The seam this conversation is still flushing through. A failed flush clears it — see flushIfBatchFull.
  let flush = onPartialCommit;
  for (;;) {
    deadline.awaiting({ phase: pages === 0 ? "first-page" : "history-page" });
    const args = { api: read.api, crawl, ctx, cursor, lane: laneLabel, latest, oldest: plan.walkOldest, seen };
    const page = await nextHistoryPage({ ...args, pages, ...cap });
    if (page === undefined || deadline.abandoned()) {
      return false;
    }
    pages += 1;
    deadline.progressed({ of: "page", rows: crawlRows({ crawl }) });
    flush = await absorbPageAndFlush({
      crawl,
      messages: page.messages,
      read,
      ...(flush !== undefined ? { flush } : {}),
    });
    const next = advanceOrWarn({ lane: laneLabel, next: page.nextCursor, seen, warnings: crawl.warnings });
    if (next === undefined || deadline.abandoned()) {
      // Only an ABSENT next cursor is exhaustion. `advanceOrWarn` also returns undefined for a stuck cursor,
      // and an abandoned deadline is not an ending at all — a walk that stopped either way has not seen the
      // whole channel, so its served-row count is a prefix and must never be stored as the channel's size.
      return page.nextCursor === undefined && page.hasMore !== true && !deadline.abandoned();
    }
    cursor = next;
  }
}

/**
 * Bank this conversation's held items once they reach {@link SLACK_CHANNEL_FLUSH_ITEMS}, and let them go.
 *
 * Called at a page boundary and never inside one: a page's messages and the replies its threads yield belong
 * to the same read, and banking half of it would put a torn page on disk. A run with no flush seam — a
 * bounded one — simply keeps everything, exactly as before.
 *
 * Returning the seam to use NEXT time is what stops a failed flush becoming a stall: a batch that would not
 * write is almost never transient, and retrying it at every subsequent page boundary would re-project an
 * ever-larger batch over and over. Dropping the seam falls back to exactly the pre-flush behaviour — one
 * commit at the end, with the warning {@link flushWithinChannel} already raised saying so.
 *
 * @param crawl the running channel crawl, MUTATED when a batch is banked
 * @param ctx the channel context the batch is written under
 * @param deadline this conversation's progress watchdog, re-armed by a batch that banks
 * @param onPartialCommit the prefix commit seam, absent when the caller writes once at the end
 * @returns the seam to keep flushing through, or `undefined` once this conversation has stopped flushing
 */
function flushIfBatchFull({
  crawl,
  ctx,
  deadline,
  onPartialCommit,
}: {
  crawl: ChannelCrawl;
  ctx: ChannelContext;
  deadline: ChannelProgressDeadline;
  onPartialCommit?: ChannelPrefixCommit;
}): ChannelPrefixCommit | undefined {
  if (onPartialCommit === undefined || crawl.messages.length + crawl.replies.length < SLACK_CHANNEL_FLUSH_ITEMS) {
    return onPartialCommit;
  }
  return flushWithinChannel({ crawl, ctx, deadline, onPartialCommit }) ? onPartialCommit : undefined;
}

/** Request this conversation's next history page, or `undefined` when the cap or the page ceiling ends it. */
async function nextHistoryPage({
  api,
  ctx,
  crawl,
  cursor,
  lane,
  latest,
  oldest,
  pages,
  seen,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  crawl: ChannelCrawl;
  cursor: string | undefined;
  lane: string;
  latest: string;
  oldest: string;
  pages: number;
  seen: Set<string>;
  maxItems?: number;
}): Promise<SlackMessagesPage | undefined> {
  const open = openCursorPage({
    // Every top-level row this lane has been SERVED, banked batches and oracle-only rows included.
    // `messages.length` alone would reset the cap's budget on every flush, and the shaped count alone would
    // ignore the rows an oracle-lane walk reads without ingesting — either way a bounded run fetches without
    // limit.
    collected: crawl.served,
    cursor,
    lane,
    maxItems,
    pages,
    seen,
    warnings: crawl.warnings,
  });
  if (open === undefined) {
    return undefined;
  }
  return api.history({
    channel: ctx.channelId,
    latest,
    oldest,
    pageSize: open.pageSize,
    ...(cursor !== undefined ? { cursor } : {}),
  });
}

/** A fresh, empty accumulator for one conversation's read. */
function emptyChannelCrawl(): ChannelCrawl {
  return {
    cursorUpdates: {},
    flushed: { items: 0, maxTsIso: "", messages: 0 },
    messages: [],
    replies: [],
    served: 0,
    visited: new Set(),
    warnings: [],
  };
}

/** What one conversation's read produced: everything it holds, or the snapshot of where it froze. */
export type ChannelRead =
  | {
      readonly kind: "read";
      readonly items: SlackChannelItems;
      readonly warnings: readonly string[];
      readonly cursorUpdates: ThreadCursors;
      readonly flushed: ChannelFlushTotals;
      /**
       * Top-level rows this conversation's history walk was served, present ONLY when the walk reached the
       * end of the channel. A prefix is not a size, so a short read carries nothing rather than a number the
       * next lane decision would read as the whole channel.
       */
      readonly walkedMessages?: number;
    }
  | { readonly kind: "stalled"; readonly at: ChannelProgressSnapshot };

/**
 * Page a channel's history + each thread's NEW replies (since its stored cursor) into shaped items, RACED
 * against this conversation's progress deadline.
 *
 * A stalled read is abandoned rather than cancelled, because there is nothing to cancel: the whole signature
 * of this hang is an `await` on a call that has no open socket and never settles, and JavaScript offers no
 * way to revoke one. What the race buys is that the CRAWL walks away — and the accumulator is emptied on the
 * way out, so a hung read holding a full flush batch cannot pin ~50 MB per abandoned channel for the rest of
 * a 603-channel pass, which at the measured one-in-fifteen rate is the difference between an unattended run
 * and one that dies of memory instead of hanging.
 *
 * @param api the injected Slack seam
 * @param ctx the channel context
 * @param deadline this conversation's progress watchdog, already armed
 * @param plan which detection lane this conversation takes, and the two bounds that follow from it
 * @param latest the window upper bound
 * @param threadCursors the stored per-thread cursors
 * @param maxItems per-lane fetch cap
 * @param onPartialCommit the MID-conversation flush seam, absent when the caller writes once at the end
 * @returns what the conversation yielded, or where it froze
 */
export async function fetchChannel({
  api,
  ctx,
  deadline,
  plan,
  latest,
  threadCursors,
  maxItems,
  onPartialCommit,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  deadline: ChannelProgressDeadline;
  plan: ChannelReadPlan;
  latest: string;
  threadCursors: ThreadCursors;
  maxItems?: number;
  onPartialCommit?: ChannelPrefixCommit;
}): Promise<ChannelRead> {
  const crawl = emptyChannelCrawl();
  const read: ChannelReadArgs = {
    api,
    ctx,
    deadline,
    plan,
    threadCursors,
    ...(maxItems !== undefined ? { maxItems } : {}),
  };
  const outcome = await Promise.race([
    walkThenSweep({ crawl, latest, read, ...(onPartialCommit !== undefined ? { onPartialCommit } : {}) }),
    deadline.expiry,
  ]);
  if (!("exhausted" in outcome)) {
    // Release what the abandoned read still holds — see the note above about a hung conversation pinning a
    // whole flush batch for the rest of the pass.
    crawl.messages.length = 0;
    crawl.replies.length = 0;
    crawl.visited.clear();
    return { at: outcome, kind: "stalled" };
  }
  // Whatever a flush left behind is the TAIL — the conversation's oldest end, since history is newest-first.
  return {
    cursorUpdates: crawl.cursorUpdates,
    flushed: crawl.flushed,
    items: channelItems({ ctx, messages: crawl.messages, replies: crawl.replies }),
    kind: "read",
    warnings: crawl.warnings,
    ...(outcome.exhausted ? { walkedMessages: crawl.served } : {}),
  };
}

/**
 * Page this conversation's history, then sweep the stored threads that walk did not touch.
 *
 * The sweep is the reason the oracle may land at all: a thread whose PARENT was deleted has left history
 * entirely, so no walk of any length surfaces it, while its replies are still there and still reachable by
 * the cursor this store already holds. In the poll lane it is what it always was — the threads whose parent
 * fell outside the bounded window.
 *
 * @param crawl the running channel crawl, MUTATED in place
 * @param latest the window upper bound
 * @param read everything this conversation's read holds constant
 * @param onPartialCommit the MID-conversation flush seam, absent when the caller writes once at the end
 * @returns whether the history walk reached the END of the channel, which is the only case in which its
 *   served-row count is the channel's size rather than a prefix's
 */
async function walkThenSweep({
  crawl,
  latest,
  read,
  onPartialCommit,
}: {
  crawl: ChannelCrawl;
  latest: string;
  read: ChannelReadArgs;
  onPartialCommit?: ChannelPrefixCommit;
}): Promise<{ exhausted: boolean }> {
  const exhausted = await pageChannelHistory({
    crawl,
    latest,
    read,
    ...(onPartialCommit !== undefined ? { onPartialCommit } : {}),
  });
  await pollKnownThreads({ crawl, read });
  return { exhausted };
}

/**
 * Bind the mid-conversation flush seam to ONE conversation.
 *
 * Bound here, where `channel` and `maps` are in scope, so the paging loop stays ignorant of both and takes
 * one argument: the batch it is handing over.
 *
 * @param channel the conversation being crawled
 * @param maps the id→name maps built once for this refresh
 * @param seam the run's partial-commit seam, absent when the caller writes once at the end
 * @returns the bound seam, or `undefined` when the run has none
 */
export function bindPartialCommit({
  channel,
  maps,
  seam,
}: {
  channel: SlackChannelRef;
  maps: SlackNameMaps;
  seam: SlackChannelPartialCommit | undefined;
}): ChannelPrefixCommit | undefined {
  return seam === undefined ? undefined : ({ items }: { items: SlackChannelItems }) => seam({ channel, items, maps });
}
