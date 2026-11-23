/**
 * One page of a complete-or-fail Slack walk (`./pagination.ts`): a history or thread page read with every thrown
 * SDK error converted to a typed `err`, and the one cursor inconsistency a page can carry on its own.
 *
 * Split from the walk itself along that seam — a walk decides when it is DONE, a page read decides only what one
 * call answered — so neither file has to be held whole to change the other.
 */
import type { SlackApi, SlackMessagesPage as SlackPage } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackPageError, SlackPageErrors } from "./errors.js";

/**
 * One history page, with a thrown SDK error converted to `err` rather than escaping.
 *
 * @param api the Slack read seam
 * @param channel the conversation id
 * @param oldest the window's start
 * @param latest the window's end
 * @param cursor the page cursor, or undefined for the first page
 * @param paced whether to opt into Slack's shared Tier 3 throttle
 * @param inclusive whether the message AT `oldest` is in the window — Slack's `inclusive`, sent only when `true`
 * @param includeAllMetadata whether to request Slack's `include_all_metadata` — sent only when `true`
 * @returns the page, or `err` describing the failure
 */
export async function readHistoryPage({
  api,
  channel,
  oldest,
  latest,
  cursor,
  paced,
  inclusive,
  includeAllMetadata,
}: {
  api: Pick<SlackApi, "history">;
  channel: string;
  oldest: string;
  latest: string;
  cursor: string | undefined;
  paced?: boolean | undefined;
  inclusive?: boolean | undefined;
  includeAllMetadata?: boolean | undefined;
}): Promise<Result<SlackPage, SlackPageError>> {
  try {
    const page = await api.history({
      channel,
      latest,
      oldest,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(paced === undefined ? {} : { paced }),
      ...(inclusive === true ? { inclusive } : {}),
      ...(includeAllMetadata === true ? { includeAllMetadata } : {}),
    });
    return ok(page);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    if (reason.includes("channel_not_found")) {
      return err(SlackPageErrors.channelNotFound({ channel, reason }));
    }
    if (reason.includes("not_in_channel")) {
      return err(SlackPageErrors.notInChannel({ channel }));
    }
    return err(SlackPageErrors.pageFetchFailed({ cause: error, context: `reading history for ${channel}` }));
  }
}

/**
 * Slack telling us there is more while giving us no way to ask for it. Reporting the thread complete here
 * is exactly the silent truncation the walk exists to prevent.
 *
 * @param hasMore Slack's own more-results flag, when present
 * @param nextCursor the cursor for the following page, when present
 * @returns the failure message, or undefined when the pair is consistent
 */
export function cursorContradiction({
  hasMore,
  nextCursor,
}: {
  hasMore: boolean | undefined;
  nextCursor: string | undefined;
}): SlackPageError | undefined {
  const exhausted = nextCursor === undefined || nextCursor.length === 0;
  return hasMore === true && exhausted ? SlackPageErrors.cursorContradiction() : undefined;
}

/**
 * One thread page, with a thrown SDK error converted to `err` rather than escaping.
 *
 * @param api the Slack read seam
 * @param channel the conversation id
 * @param threadTs the thread root timestamp
 * @param oldest the `oldest` bound — `"0"` for the whole thread, or a recovery checkpoint's cursor
 * @param includeAllMetadata whether to request Slack's `include_all_metadata`
 * @param cursor the page cursor, or undefined for the first page
 * @returns the page, or `err` describing the failure
 */
export async function readPage({
  api,
  channel,
  threadTs,
  oldest,
  includeAllMetadata,
  cursor,
}: {
  api: Pick<SlackApi, "replies">;
  channel: string;
  threadTs: string;
  oldest: string;
  includeAllMetadata?: boolean | undefined;
  cursor: string | undefined;
}): Promise<Result<SlackPage, SlackPageError>> {
  try {
    const page = await api.replies({
      channel,
      oldest,
      ts: threadTs,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(includeAllMetadata === true ? { includeAllMetadata } : {}),
    });
    return ok(page);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    // `thread_not_found` is the failure a real user hits most: a link that has gone stale. Slack's raw
    // error code does not say what to do about it, and the two causes need different responses.
    // (A message with NO replies is NOT this case — verified: `conversations.replies` happily returns the
    // single message, so an ordinary non-threaded link reads fine.)
    if (reason.includes("thread_not_found")) {
      return err(SlackPageErrors.threadNotFound({ channel, threadTs }));
    }
    // The two PERMANENT channel-level answers `conversations.replies` gives are the same two
    // `conversations.history` gives, and they must decode to the same typed codes here — a thread read in a
    // channel the bot has been removed from used to fall through to the generic `PAGE_FETCH_FAILED`, which
    // left the scheduled recovery sweep unable to tell "unreadable forever" from "failed this time" at its
    // thread stage, and pinned its watermark for seven hours.
    if (reason.includes("channel_not_found")) {
      return err(SlackPageErrors.channelNotFound({ channel, reason }));
    }
    if (reason.includes("not_in_channel")) {
      return err(SlackPageErrors.notInChannel({ channel }));
    }
    return err(SlackPageErrors.pageFetchFailed({ cause: error, context: `reading thread ${threadTs}` }));
  }
}
