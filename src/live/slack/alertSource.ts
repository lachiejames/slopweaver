/**
 * Read one channel's window COMPLETELY, or refuse — then hand the raw messages to the pure tally.
 *
 * ## Completeness is the whole contract, for the same reason `./pagination.ts` gives
 *
 * A truncated read does not fail; it UNDERCOUNTS, and an undercount is indistinguishable from a quiet week. That
 * is the silent-failure shape this repo keeps finding, so this loop terminates on cursor exhaustion only. Every
 * other outcome — a thrown page, a repeated cursor, more pages than the ceiling — is `err`, and `err` returns no
 * messages at all, because a caller handed a prefix cannot tell it from the whole thing.
 *
 * It does not reuse `./pagination.ts`, which walks a THREAD (`conversations.replies`, keyed by a root `ts`), nor
 * `lib/paging.collectCursorPages`, which stops on a zero-item page before consulting the cursor — Slack documents
 * that a Conversations page may come back empty while still carrying a `next_cursor`, so that loop can return a
 * prefix and call it the window.
 *
 * ## Why the page ceiling REFUSES instead of returning what it has
 *
 * Hitting it means the window is wider than one read can prove. Returning the first twelve thousand messages
 * would produce a card whose numbers look authoritative and are wrong by an unknown amount, so the refusal names
 * the fix — a narrower `--window` — rather than guessing on the caller's behalf.
 */
import type { SlackApi } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AlertSourceError, AlertSourceErrors } from "./alertSourceErrors.js";
import type { RawAlertMessage } from "./alertTally.js";

/**
 * The page ceiling, and the per-page size. 60 x 200 is twelve thousand messages, which is generous for a noisy
 * alerts channel over a week and still bounded — a cursor cycle terminates rather than spinning.
 */
const MAX_PAGES = 60;

/** Slack's own maximum for `conversations.history`; asking for fewer would only cost more round trips. */
const PAGE_SIZE = 200;

/** A window read in full, with the evidence that it IS full. */
export interface CompleteWindowRead {
  readonly messages: readonly RawAlertMessage[];
  readonly pageCount: number;
  /** Always true: there is no success value where the cursor was not exhausted. */
  readonly cursorExhausted: true;
}

/** One page, with a thrown SDK error converted to `err` rather than escaping into the CLI shell. */
async function readPage({
  api,
  channel,
  oldest,
  cursor,
}: {
  api: Pick<SlackApi, "history">;
  channel: string;
  oldest: string;
  cursor: string | undefined;
}): Promise<Result<{ messages: readonly unknown[]; nextCursor?: string }, AlertSourceError>> {
  try {
    return ok(
      await api.history({
        channel,
        // The widest sentinel, matching the ingest lane's own `slackWindowBounds`. The window's start is the only
        // bound that matters here: an alert summary is always "the last N", ending now.
        latest: "9999999999",
        oldest,
        pageSize: PAGE_SIZE,
        ...(cursor !== undefined ? { cursor } : {}),
      }),
    );
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    // The two failures a real caller hits, told apart, because they need different responses and Slack's raw code
    // says neither. A wrong id and an unjoined channel look identical from the outside.
    if (reason.includes("channel_not_found")) {
      return err(AlertSourceErrors.channelNotFound({ channel }));
    }
    if (reason.includes("not_in_channel")) {
      return err(AlertSourceErrors.notInChannel({ channel }));
    }
    return err(AlertSourceErrors.readFailed({ cause: error, channel }));
  }
}

/**
 * Page a channel's history from `oldest` to now, completely or not at all.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channel the conversation id
 * @param oldest the window's start, as Slack's epoch-seconds string
 * @param onPage optional per-page progress callback, so a long read is not silent
 * @returns every message in the window, or `err` naming why completeness could not be established
 */
export async function readAlertWindow({
  api,
  channel,
  oldest,
  onPage,
}: {
  api: Pick<SlackApi, "history">;
  channel: string;
  oldest: string;
  onPage?: (progress: { pageCount: number; messageCount: number }) => void;
}): Promise<Result<CompleteWindowRead, AlertSourceError>> {
  const messages: RawAlertMessage[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (pageCount < MAX_PAGES) {
    const page = await readPage({ api, channel, cursor, oldest });
    if (page.isErr()) {
      return err(page.error);
    }
    // The seam types a message as `unknown`; the tally reads only optional fields off it, so the cast is a
    // structural narrowing rather than a claim about what Slack sent. Nothing here dereferences it.
    // oxlint-disable-next-line no-unsafe-type-assertion
    messages.push(...(page.value.messages as readonly RawAlertMessage[]));
    pageCount += 1;
    onPage?.({ messageCount: messages.length, pageCount });
    const { nextCursor } = page.value;
    if (nextCursor === undefined || nextCursor.length === 0) {
      return ok({ cursorExhausted: true, messages, pageCount });
    }
    if (seenCursors.has(nextCursor)) {
      return err(AlertSourceErrors.cursorRepeated({ channel }));
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return err(AlertSourceErrors.windowTooLarge({ channel, maxMessages: MAX_PAGES * PAGE_SIZE }));
}
