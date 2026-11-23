/**
 * The channel's own answer to "which threads moved?" — pure, so the decision that used to cost one
 * `conversations.replies` call per known thread is unit-testable with a literal page.
 *
 * ## What the channel already tells us, for free
 *
 * `conversations.history` returns, on every thread root, `reply_count`, `reply_users_count` and
 * `latest_reply` — live, for a parent of ANY age. And `latest_reply` is the SAME quantity the crawl already
 * stores as each thread's cursor in `.slack-threads.json`, so the skip test is `latest_reply > storedCursor`
 * against state that already exists. MEASURED against a live workspace: detecting which threads
 * changed costs **hundreds** of history calls workspace-wide instead of **tens of thousands** of replies
 * calls, an incremental refresh drops from most of a day to minutes, and under one percent of tens of
 * thousands of threads gain a reply on a given day — so nearly all of the crawl's traffic was confirming that nothing had happened.
 *
 * The earlier finding this replaces — "a reply does not move its parent's ts, so `conversations.history`
 * never returns that parent" — is true only of a WATERMARK-BOUNDED history fetch. It is false of a full page
 * walk, which returns every parent in the channel with its CURRENT `reply_count` and `latest_reply`.
 *
 * ## The one detail a re-implementation gets wrong
 *
 * **A row is a thread root iff it carries `latest_reply`** — never `thread_ts`. Measured on one 999-row
 * page: 883 rows carry `latest_reply`, 890 carry `thread_ts`, and the 7-row gap is EXACTLY the 7
 * `thread_broadcast` rows. A broadcast reply surfaces top-level carrying its PARENT's `thread_ts` and no
 * `latest_reply` of its own, so keying on `thread_ts` invents 7 phantom threads per page — each of which
 * would then be polled forever, since a phantom has no cursor and never gains one.
 *
 * ## What the oracle does NOT see
 *
 * A thread whose PARENT was deleted leaves history, so it becomes invisible here while remaining reachable
 * by its stored cursor. That is the one genuine regression against the per-thread poll, and it is why the
 * crawl keeps a fallback sweep over the stored cursors a walk did not touch (`./channelPages.ts`'s
 * `pollKnownThreads`). An EDITED reply is missed by both this and the per-thread poll (`oldest=cursor`
 * returns only newer rows); a DELETED reply is caught here via `reply_count` and missed by the poll.
 */
import { isRecord } from "../../lib/parsers.js";
import { optStr } from "./shape.js";
import { isSlackTs, type ThreadCursor, type ThreadCursors, threadKey } from "./threadCursors.js";

/**
 * The `conversations.history` page size — 999, which is NOT the shared 200 every other Slack read uses.
 *
 * History documents a maximum "under 1000" and was measured live returning exactly 999 rows in one call,
 * paging cleanly to `has_more:false`. It lives here rather than beside the other page sizes because it is the
 * oracle's own number: walking a channel end to end is what makes `reply_count`/`latest_reply` usable, and
 * the page size is the difference between a handful of calls on the thread-densest channel and five times that.
 * `conversations.replies` deliberately stays on 200 — about one in a thousand measured threads holds more
 * than 200 items, so raising it there buys about a thousandth of the calls.
 */
export const HISTORY_PAGE_LIMIT = 999;

/** One thread root exactly as a `conversations.history` row describes it. */
export interface ThreadRootRow {
  /** The root's own `ts`, which is the thread's identity. */
  readonly threadTs: string;
  /** Slack's `latest_reply` — the ts of the thread's newest reply, right now. */
  readonly latestReply: string;
  /** Slack's `reply_count` for the thread, right now. */
  readonly replyCount: number;
}

/**
 * Every thread root in one page of raw `conversations.history` rows. Pure + defensive.
 *
 * Root-ness is decided by `latest_reply` ALONE — see the module comment for the 7-per-page measurement that
 * settles it against `thread_ts`. A row whose `latest_reply` is not a well-formed Slack ts is not a root:
 * the value is about to be compared numerically against a stored cursor, and a malformed one would compare
 * as `NaN` and silently read as "unchanged".
 *
 * @param messages the page's raw rows, of unvalidated shape
 * @returns one entry per thread root, in the page's own order
 */
export function threadRootsInPage({ messages }: { messages: readonly unknown[] }): readonly ThreadRootRow[] {
  const roots: ThreadRootRow[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      continue;
    }
    const threadTs = optStr({ value: raw["ts"] });
    const latestReply = raw["latest_reply"];
    if (threadTs === undefined || !isSlackTs(latestReply)) {
      continue;
    }
    const replyCount = raw["reply_count"];
    roots.push({
      latestReply,
      replyCount: typeof replyCount === "number" && Number.isFinite(replyCount) ? replyCount : 0,
      threadTs,
    });
  }
  return roots;
}

/** One thread root the oracle proved unchanged — its stored cursor stands, with the count it just confirmed. */
interface ConfirmedThread {
  readonly key: string;
  readonly cursor: ThreadCursor;
}

/** What the oracle made of one page's roots. */
export interface ThreadOraclePlan {
  /** The roots that need a real `conversations.replies` call. */
  readonly poll: readonly ThreadRootRow[];
  /** The roots that do not — carrying the count to record, so the deletion detector arms itself. */
  readonly confirmed: readonly ConfirmedThread[];
}

/**
 * Which of a page's thread roots actually need fetching, and what to record for the ones that do not. Pure.
 *
 * Three conditions force a fetch, and nothing else does:
 *
 * 1. **No stored cursor** — the thread has never been read, so everything in it is new.
 * 2. **`latest_reply` is newer than the stored cursor** — compared NUMERICALLY, because a Slack ts sorts
 *    wrongly as a string once the seconds roll a digit (the same trap `latestReplyTs` documents).
 * 3. **The stored `reply_count` differs from the row's** — which is how a DELETED reply is detected, since
 *    a deletion moves the count without moving `latest_reply`. An ABSENT stored count is unknown rather than
 *    mismatched: see {@link ThreadCursor}, and note that the alternative polls every legacy thread once.
 *
 * A root that fails all three is CONFIRMED rather than merely skipped — the caller records the observed
 * count against the unchanged cursor, so a thread migrated from the legacy file gains its count without
 * anyone paying a replies call for it.
 *
 * @param channel the channel these roots came from, for the store key
 * @param cursors the stored per-thread cursors
 * @param roots the page's thread roots, from {@link threadRootsInPage}
 * @returns the roots to poll, and the confirmed cursors to record
 */
export function threadsNeedingPoll({
  channel,
  cursors,
  roots,
}: {
  channel: string;
  cursors: ThreadCursors;
  roots: readonly ThreadRootRow[];
}): ThreadOraclePlan {
  const poll: ThreadRootRow[] = [];
  const confirmed: ConfirmedThread[] = [];
  for (const root of roots) {
    const key = threadKey({ channel, threadTs: root.threadTs });
    const stored = cursors[key];
    if (stored === undefined) {
      poll.push(root);
      continue;
    }
    const gainedReply = Number(root.latestReply) > Number(stored.ts);
    const countChanged = stored.replyCount !== undefined && stored.replyCount !== root.replyCount;
    if (gainedReply || countChanged) {
      poll.push(root);
      continue;
    }
    confirmed.push({ cursor: { replyCount: root.replyCount, ts: stored.ts }, key });
  }
  return { confirmed, poll };
}

/**
 * How a channel's changed threads are detected this pass.
 *
 * - `history-oracle` — walk the channel's whole history and let `latest_reply`/`reply_count` say which
 *   threads moved. Cheap when the channel has more threads than history pages, which is the common case.
 * - `poll-known-threads` — the pre-oracle behaviour: a watermark-bounded history walk, then one
 *   `conversations.replies` per stored thread. Cheaper on a firehose, where the pages outnumber the threads.
 */
export type ThreadDetectionLane = "history-oracle" | "poll-known-threads";

/**
 * Which detection lane a channel takes this pass. Pure.
 *
 * The choice is per channel and not global, and that is not an optimisation for its own sake. A bot
 * firehose channel can hold a million top-level messages and a few dozen threads: an always-page-history
 * policy costs about a thousand calls there to check those few dozen threads, and `min(pages, threads)` is
 * what nearly tripled the calls workspace-wide when it was missing.
 *
 * A channel with NO known threads takes the poll lane — not because polling is cheaper (it polls nothing)
 * but because the oracle would buy nothing, and the bounded walk is the cheaper ingest. A channel whose
 * message count has never been recorded takes the ORACLE lane: the walk is what learns the count, and a
 * channel that has never been counted is one the crawl has never read end to end.
 *
 * @param knownMessages top-level messages this channel is known to hold, or undefined when never counted
 * @param knownThreads how many threads of this channel the cursor store already knows
 * @param pageLimit the history page size the walk would use
 * @returns the lane this channel takes
 */
export function chooseThreadDetectionLane({
  knownMessages,
  knownThreads,
  pageLimit,
}: {
  knownMessages: number | undefined;
  knownThreads: number;
  pageLimit: number;
}): ThreadDetectionLane {
  if (knownThreads === 0) {
    return "poll-known-threads";
  }
  if (knownMessages === undefined) {
    return "history-oracle";
  }
  return Math.ceil(knownMessages / pageLimit) < knownThreads ? "history-oracle" : "poll-known-threads";
}

/**
 * How many stored threads each channel has — the `knownThreads` half of the lane decision. Pure.
 *
 * Computed once per run rather than per channel: the store holds one key per thread workspace-wide (tens
 * of thousands of them at measurement), so re-scanning it for each of hundreds of channels is a scan that grows as the product
 * of two numbers that both only grow.
 *
 * @param cursors the stored per-thread cursors, whose keys are `channelId:threadTs`
 * @returns channel id → how many of its threads are stored
 */
export function countThreadsPerChannel({ cursors }: { cursors: ThreadCursors }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const key of Object.keys(cursors)) {
    const separator = key.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const channel = key.slice(0, separator);
    counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }
  return counts;
}

/**
 * How many stored threads one channel has, read off {@link countThreadsPerChannel}'s map. Pure.
 *
 * That map gains a key only when a stored thread names the channel, so a channel absent from it has no
 * stored thread at all: zero is its count, not a stand-in for one.
 *
 * @param counts the per-channel counts {@link countThreadsPerChannel} returned
 * @param channel the channel id to read
 * @returns how many of that channel's threads are stored
 */
export function storedThreadsOf({ counts, channel }: { counts: ReadonlyMap<string, number>; channel: string }): number {
  const count = counts.get(channel);
  if (count === undefined) {
    return 0;
  }
  return count;
}
