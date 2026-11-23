/**
 * The complete-or-fail Slack walk — one thread, or one channel's history over a window. This exists instead
 * of `lib/paging.collectCursorPages` because that helper is best-effort by contract while this is not. The
 * shared helper does now report how a walk ended, so the difference is no longer that it cannot tell — it is
 * what each does about it:
 *
 *  - **It is best-effort by contract, and this is not.** `collectCursorPages` now stops on the cursor rather
 *    than on an empty page, and it reports how the walk ended — but its answer to a stuck cursor or a page
 *    ceiling is a WARNING beside a prefix, because every ingest lane it serves would rather have a short crawl
 *    than no crawl. Here a prefix is the wrong answer at any volume: "which messages are missing" is the
 *    question being asked, so the same conditions must be `err`.
 *  - **The ingest lane returns what it has on error.** It catches an API failure and returns the messages
 *    accumulated so far plus a warning. Correct for a best-effort crawl; fatal here.
 *
 * So termination is cursor exhaustion ONLY, cross-checked against Slack's own `has_more`. Every other
 * outcome — a thrown page, a repeated cursor, `has_more: true` with no cursor — is `err`, and `err` carries
 * no messages at all. A partial thread or history window is never returned in any form, because a caller
 * cannot tell a truncated success from a complete one — which is exactly what a recovery sweep over
 * `fetchCompleteSlackHistory` needs: a channel it can only partially see must refuse, not silently report
 * "nothing unanswered" over the part it happened to read.
 *
 * The CONVERSATIONS walk, `fetchCompleteSlackChannels` and its `CompleteChannelFetch`, lives in
 * `./channelPagination.ts` and is exported from there only; that module imports `MAX_PAGES` from here, and this one
 * imports nothing back. The single-page reads both walks here are built on live in `./pageReads.ts`.
 */
import { type SlackApi } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackPageError, SlackPageErrors } from "./errors.js";
import { cursorContradiction, readHistoryPage, readPage } from "./pageReads.js";

/** A thread fetched in full, with the evidence that it IS full. */
export interface CompleteThreadFetch {
  /** Every row across every page, in Slack's order (parent first). */
  readonly rawMessages: readonly unknown[];
  readonly pageCount: number;
  /**
   * Where each page begins in `rawMessages`, one index per page: Slack repeats the parent at the head of every page,
   * so a caller checking that each page carried it needs the boundaries the flattening drops.
   */
  readonly pageStarts: readonly number[];
  /** Always true: there is no success value where the cursor was not exhausted. */
  readonly cursorExhausted: true;
}

/** A channel's history fetched in full over a window, with the evidence that it IS full. */
export interface CompleteHistoryFetch {
  /** Every row across every page, in Slack's order (newest first — the same order `conversations.history` returns). */
  readonly rawMessages: readonly unknown[];
  readonly pageCount: number;
  /** Always true: there is no success value where the cursor was not exhausted. */
  readonly cursorExhausted: true;
}

/** A hard ceiling on pages, so a pathological cursor cycle terminates rather than spinning forever. */
export const MAX_PAGES = 200;

/**
 * The shared complete-or-fail page loop behind both {@link fetchCompleteSlackThread} and
 * {@link fetchCompleteSlackThreadSince} — identical pagination/completeness contract, differing only in
 * which Slack decimal `ts` the walk starts strictly after.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channel the conversation id
 * @param threadTs the thread ROOT timestamp
 * @param oldest the `oldest` bound to pass to `conversations.replies` — `"0"` for the whole thread, or a
 *   recovery checkpoint's cursor for an incremental walk
 * @param includeAllMetadata whether to request Slack's `include_all_metadata`
 * @param maxPages a TIGHTER page budget than {@link MAX_PAGES}, refused exactly as the default ceiling is
 * @param onPage optional per-page progress callback
 * @returns every message in the walk, or `err` naming why completeness could not be established
 */
async function fetchThreadPages({
  api,
  channel,
  threadTs,
  oldest,
  includeAllMetadata,
  maxPages,
  onPage,
}: {
  api: Pick<SlackApi, "replies">;
  channel: string;
  threadTs: string;
  oldest: string;
  includeAllMetadata?: boolean | undefined;
  maxPages?: number | undefined;
  onPage?: ((progress: { pageCount: number; messageCount: number }) => void) | undefined;
}): Promise<Result<CompleteThreadFetch, SlackPageError>> {
  const ceiling = maxPages === undefined ? MAX_PAGES : Math.min(maxPages, MAX_PAGES);
  const rawMessages: unknown[] = [];
  const pageStarts: number[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (pageCount < ceiling) {
    const page = await readPage({ api, channel, cursor, includeAllMetadata, oldest, threadTs });
    if (page.isErr()) {
      return err(page.error);
    }
    const { messages, nextCursor, hasMore } = page.value;
    pageStarts.push(rawMessages.length);
    rawMessages.push(...messages);
    pageCount += 1;
    onPage?.({ messageCount: rawMessages.length, pageCount });
    const contradiction = cursorContradiction({ hasMore, nextCursor });
    if (contradiction !== undefined) {
      return err(contradiction);
    }
    if (nextCursor === undefined || nextCursor.length === 0) {
      return ok({ cursorExhausted: true, pageCount, pageStarts, rawMessages });
    }
    if (seenCursors.has(nextCursor)) {
      return err(SlackPageErrors.cursorRepeated({ where: `a pagination cursor on thread ${threadTs}` }));
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return err(SlackPageErrors.pageCeilingExceeded({ maxPages: ceiling, where: `thread ${threadTs}` }));
}

/**
 * Fetch one Slack thread completely, or fail.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channel the conversation id
 * @param threadTs the thread ROOT timestamp
 * @param includeAllMetadata whether to request Slack's `include_all_metadata` — a caller that needs to read
 *   `message.metadata` back (an exact-answer match, say) must opt in; off by default for every existing lane
 * @param maxPages a TIGHTER page budget than {@link MAX_PAGES}, for a caller on a deadline — a walk that would
 *   exceed it is `err`, so the complete-or-fail contract is unchanged and only the moment of refusal moves
 * @param onPage optional per-page progress callback
 * @returns every message in the thread, or `err` naming why completeness could not be established
 */
export async function fetchCompleteSlackThread({
  api,
  channel,
  threadTs,
  includeAllMetadata,
  maxPages,
  onPage,
}: {
  api: Pick<SlackApi, "replies">;
  channel: string;
  threadTs: string;
  includeAllMetadata?: boolean;
  maxPages?: number | undefined;
  onPage?: (progress: { pageCount: number; messageCount: number }) => void;
}): Promise<Result<CompleteThreadFetch, SlackPageError>> {
  // `oldest: "0"` is what makes this the WHOLE thread rather than a window — see `readPage`'s own comment.
  return fetchThreadPages({ api, channel, includeAllMetadata, maxPages, oldest: "0", onPage, threadTs });
}

/**
 * Fetch a thread INCREMENTALLY — every message strictly after a recovery checkpoint's cursor, to cursor
 * exhaustion, or fail. Additive sibling of {@link fetchCompleteSlackThread}: that helper stays fixed at
 * `oldest: "0"` for every caller needing the whole thread; this one forwards a caller-supplied cursor so
 * `listen recover`'s scheduled sweep can re-poll an old, out-of-window thread for a NEW reply without
 * re-reading everything it already classified.
 *
 * Deliberately carries no `latest` bound: a reply posted just after the sweep began is still worth reading
 * for its answer metadata (it closes an answer/recovery race), so the walk reads everything after `oldest`
 * and lets the caller decide, per row, which side of its own window boundary a reply falls on.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channel the conversation id
 * @param threadTs the thread ROOT timestamp
 * @param oldest the recovery checkpoint's cursor — strictly-after bound, Slack's decimal `ts`
 * @param includeAllMetadata whether to request Slack's `include_all_metadata`
 * @param onPage optional per-page progress callback
 * @returns every message strictly after `oldest`, or `err` naming why completeness could not be established
 */
export async function fetchCompleteSlackThreadSince({
  api,
  channel,
  threadTs,
  oldest,
  includeAllMetadata,
  onPage,
}: {
  api: Pick<SlackApi, "replies">;
  channel: string;
  threadTs: string;
  oldest: string;
  includeAllMetadata?: boolean;
  onPage?: (progress: { pageCount: number; messageCount: number }) => void;
}): Promise<Result<CompleteThreadFetch, SlackPageError>> {
  return fetchThreadPages({ api, channel, includeAllMetadata, oldest, onPage, threadTs });
}

/**
 * Fetch one channel's history completely over an explicit window, or fail. Same completeness contract as
 * {@link fetchCompleteSlackThread} — cursor exhaustion only, cross-checked against `has_more`, a repeated or
 * missing-but-promised cursor is `err` — because a recovery sweep asking "what did we never answer" needs
 * the WHOLE window, not a best-effort prefix of it.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channel the conversation id
 * @param oldest the window's start, Slack's decimal `ts` (or `"0"` for the dawn of the channel)
 * @param inclusive whether the message AT `oldest` is in the window — Slack's `inclusive`; off, it is not
 * @param latest the window's end, Slack's decimal `ts`
 * @param paced whether this interactive walk opts into Slack's shared Tier 3 throttle
 * @param maxPages a TIGHTER page budget than {@link MAX_PAGES}, for a caller whose window is opened by data
 *   it does not control — a walk that would exceed it is `err`, exactly as the default ceiling is, so the
 *   complete-or-fail contract is unchanged and only the moment of refusal moves
 * @param includeAllMetadata whether to request Slack's `include_all_metadata` — an integration's own message
 *   metadata (incident.io's `incident_message`) is only returned when asked for
 * @param onPage optional per-page progress callback
 * @returns every message in the window, or `err` naming why completeness could not be established
 */
export async function fetchCompleteSlackHistory({
  api,
  channel,
  oldest,
  latest,
  paced,
  inclusive,
  maxPages,
  includeAllMetadata,
  onPage,
}: {
  api: Pick<SlackApi, "history">;
  channel: string;
  oldest: string;
  latest: string;
  paced?: boolean | undefined;
  maxPages?: number | undefined;
  inclusive?: boolean | undefined;
  includeAllMetadata?: boolean | undefined;
  onPage?: (progress: { pageCount: number; messageCount: number }) => void;
}): Promise<Result<CompleteHistoryFetch, SlackPageError>> {
  const ceiling = maxPages === undefined ? MAX_PAGES : Math.min(maxPages, MAX_PAGES);
  const rawMessages: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (pageCount < ceiling) {
    const page = await readHistoryPage({
      api,
      channel,
      cursor,
      includeAllMetadata,
      inclusive,
      latest,
      oldest,
      paced,
    });
    if (page.isErr()) {
      return err(page.error);
    }
    const { messages, nextCursor, hasMore } = page.value;
    rawMessages.push(...messages);
    pageCount += 1;
    onPage?.({ messageCount: rawMessages.length, pageCount });
    const contradiction = cursorContradiction({ hasMore, nextCursor });
    if (contradiction !== undefined) {
      return err(contradiction);
    }
    if (nextCursor === undefined || nextCursor.length === 0) {
      return ok({ cursorExhausted: true, pageCount, rawMessages });
    }
    if (seenCursors.has(nextCursor)) {
      return err(SlackPageErrors.cursorRepeated({ where: `a pagination cursor on channel ${channel}` }));
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return err(SlackPageErrors.pageCeilingExceeded({ maxPages: ceiling, where: `channel ${channel}` }));
}
