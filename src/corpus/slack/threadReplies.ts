/**
 * The Slack thread-replies lane: read ONE thread's new replies since its stored cursor, and say how far that
 * cursor may now advance.
 *
 * Apart from `./fetch.ts` because it is a different question. The history lane asks "what has this
 * conversation said"; this one asks "what has this thread said since last time" — a thread can gain a reply
 * long after its parent's timestamp, which is the whole reason a per-thread cursor exists at all. It is also
 * the lane whose paging loop must never stop on an empty page: `shapeRepliesPage` always drops the thread
 * parent and `conversations.replies` always returns it, so a page whose only row is the parent shapes to
 * nothing while more replies wait behind it.
 */
import { advanceOrWarn, openCursorPage } from "../../lib/paging.js";
import type { SlackApi } from "./fetch.js";
import type { SlackReplyItem } from "./project.js";
import { type ChannelContext, shapeRepliesPage } from "./shape.js";
import { latestReplyTs, newerReplies, type ThreadCursor, threadKey } from "./threadCursors.js";

/** One thread's contribution: its NEW replies, any warning, and the cursor advance (absent ⇒ no advance). */
export interface ThreadPoll {
  readonly replies: readonly SlackReplyItem[];
  readonly warnings: readonly string[];
  readonly cursorUpdate?: { readonly key: string; readonly cursor: ThreadCursor };
}

/**
 * Read one thread's NEW replies (from its stored cursor, else the window) + compute its cursor advance.
 *
 * @param api the injected Slack seam
 * @param ctx the channel context
 * @param threadTs the thread root timestamp
 * @param stored this thread's cursor from the last crawl, absent when it has never been read
 * @param windowOldest the run's window lower bound, used when the thread has no cursor of its own
 * @param observedReplyCount the `reply_count` the channel's own history row reported for this thread just
 *   now, when the caller had one — stored beside the cursor so the NEXT pass can detect a deleted reply,
 *   which a cursor-bounded poll (`oldest=cursor` returns only newer rows) structurally cannot
 * @param maxItems per-lane fetch cap
 * @returns the thread's new replies, its warnings, and the cursor advance it earned
 */
export async function pollThread({
  api,
  ctx,
  threadTs,
  stored,
  windowOldest,
  observedReplyCount,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  threadTs: string;
  stored: string | undefined;
  windowOldest: string;
  observedReplyCount?: number;
  maxItems?: number;
}): Promise<ThreadPoll> {
  const threadResult = await fetchThread({
    api,
    ctx,
    oldest: stored ?? windowOldest,
    threadTs,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  const fresh = newerReplies({ afterTs: stored, replies: threadResult.replies });
  const nextTs = latestReplyTs({ current: stored, replies: fresh });
  return {
    replies: fresh,
    warnings: threadResult.warnings,
    ...(nextTs !== undefined
      ? {
          cursorUpdate: {
            cursor: {
              ts: nextTs,
              ...(observedReplyCount !== undefined ? { replyCount: observedReplyCount } : {}),
            },
            key: threadKey({ channel: ctx.channelId, threadTs }),
          },
        }
      : {}),
  };
}

/**
 * Page one thread's replies into `replies`, stopping only on the cursor.
 *
 * The zero-shaped-replies page is ROUTINE here rather than exotic, which is why nothing in this loop looks at
 * how many rows a page contributed: `shapeRepliesPage` always drops the thread parent and
 * `conversations.replies` always returns it, so a page whose only row is the parent shaped to nothing and used
 * to end the walk — after which the stored thread cursor advanced past every reply on the following page,
 * losing them permanently.
 *
 * @param api the injected Slack seam
 * @param ctx the channel context
 * @param threadTs the thread root timestamp
 * @param oldest the reply-window lower bound
 * @param lane the human label used in any incompleteness warning
 * @param replies the accumulating reply list, MUTATED in place
 * @param warnings the running warning list, MUTATED in place
 * @param maxItems per-lane fetch cap
 */
async function walkThreadReplies({
  api,
  ctx,
  threadTs,
  oldest,
  lane,
  replies,
  warnings,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  threadTs: string;
  oldest: string;
  lane: string;
  replies: SlackReplyItem[];
  warnings: string[];
  maxItems?: number;
}): Promise<void> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const open = openCursorPage({ collected: replies.length, cursor, lane, maxItems, pages, seen, warnings });
    if (open === undefined) {
      break;
    }
    const page = await api.replies({
      channel: ctx.channelId,
      oldest,
      pageSize: open.pageSize,
      ts: threadTs,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    pages += 1;
    replies.push(...shapeRepliesPage({ ctx, messages: page.messages, threadTs }));
    const next = advanceOrWarn({ lane, next: page.nextCursor, seen, warnings });
    if (next === undefined) {
      break;
    }
    cursor = next;
  }
}

/** Page one thread's replies since `oldest` (the parent is skipped — it's already the top-level message). */
async function fetchThread({
  api,
  ctx,
  threadTs,
  oldest,
  maxItems,
}: {
  api: SlackApi;
  ctx: ChannelContext;
  threadTs: string;
  oldest: string;
  maxItems?: number;
}): Promise<{ replies: readonly SlackReplyItem[]; warnings: readonly string[] }> {
  const replies: SlackReplyItem[] = [];
  const warnings: string[] = [];
  const lane = `slack replies for ${ctx.channelId}/${threadTs}`;
  try {
    await walkThreadReplies({
      api,
      ctx,
      lane,
      oldest,
      replies,
      threadTs,
      warnings,
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
  } catch (error: unknown) {
    return {
      replies,
      warnings: [
        ...warnings,
        `thread ${ctx.channelId}/${threadTs} replies failed: ${error instanceof Error ? error.message : "unknown"}`,
      ],
    };
  }
  return { replies, warnings };
}
