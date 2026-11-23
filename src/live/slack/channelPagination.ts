/**
 * The complete-or-fail `conversations.list` walk — every conversation the token can see, or `err`. Held apart from
 * `./pagination.ts`, which walks MESSAGES (a thread, a channel's history); this walks CONVERSATIONS, per lane, and
 * shares only the contract and the page ceiling. That header's reasons for refusing a prefix apply here unchanged.
 *
 * `fetchCompleteSlackChannels` and `CompleteChannelFetch` are exported from here only, and every caller imports them
 * from here. This module imports `MAX_PAGES` from `./pagination.ts`, which imports nothing back.
 */
import { channelsFromPage, type SlackApi, type SlackChannelRef } from "../../corpus/slack/fetch.js";
import { SLACK_CONVERSATION_LANES, type SlackConversationLane, slackLaneLabel } from "../../corpus/slack/lanes.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackPageError, SlackPageErrors } from "./errors.js";
import { MAX_PAGES } from "./pagination.js";

/** Every conversation `conversations.list` returned for the token, with the evidence that it IS every one. */
export interface CompleteChannelFetch {
  readonly channels: readonly SlackChannelRef[];
  readonly pageCount: number;
  /** Always true: there is no success value where the cursor was not exhausted. */
  readonly cursorExhausted: true;
}

/**
 * Fetch every conversation `conversations.list` returns for the token — public/private channels, DMs and
 * group DMs alike — or fail. Same completeness contract as {@link fetchCompleteSlackHistory}: cursor
 * exhaustion only, a repeated cursor is `err`, a page ceiling is `err`. `conversations.list` carries no
 * `has_more` flag of its own, so there is nothing to cross-check the cursor against — absence of a next
 * cursor is the only signal this endpoint gives.
 *
 * "Group DMs alike" is true because this walks each lane SEPARATELY. Slack returns no `mpim` row while
 * `public_channel` sits in the same `types` list, so the single combined walk this used to do returned the
 * channels and DMs and claimed completeness over a class it had never asked a reachable question about —
 * see `SLACK_LANE_TYPES` in `corpus/slack/lanes.ts`. Each lane gets its own cursor set and its own page
 * budget; an incomplete walk in EITHER lane is `err` for the whole fetch, since a partial answer here is
 * exactly what the complete-or-fail contract exists to refuse.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param onPage optional per-page progress callback, called across both lanes with a running total
 * @returns every discovered conversation, or `err` naming why completeness could not be established
 */
export async function fetchCompleteSlackChannels({
  api,
  onPage,
}: {
  api: Pick<SlackApi, "listChannels">;
  onPage?: (progress: { pageCount: number; channelCount: number }) => void;
}): Promise<Result<CompleteChannelFetch, SlackPageError>> {
  const channels: SlackChannelRef[] = [];
  let pageCount = 0;
  for (const lane of SLACK_CONVERSATION_LANES) {
    const walked = await fetchCompleteSlackLane({
      api,
      lane,
      onPage: (progress) => {
        onPage?.({ channelCount: channels.length + progress.channelCount, pageCount: pageCount + progress.pageCount });
      },
    });
    if (walked.isErr()) {
      return err(walked.error);
    }
    channels.push(...walked.value.channels);
    pageCount += walked.value.pageCount;
  }
  return ok({ channels, cursorExhausted: true, pageCount });
}

/**
 * One lane's complete-or-fail `conversations.list` walk — the body {@link fetchCompleteSlackChannels} runs
 * once per conversation lane, so each lane's cursor set and page ceiling are its own.
 *
 * Exported for `talk slack-channel`, which resolves a channel NAME and needs only the channels lane, read under the
 * console's tool deadline. `pageSize` is how it fits: Slack fills a page by scanning, not by count, so the channels
 * lane is more than ten pages at the seam's default of 200 and three at 1000. MEASURED: 716
 * conversations: `slopweaver slack probe --method conversations.list types=public_channel,private_channel,im
 * limit=1000 exclude_archived=false --count-field channels --exhaust 10` (3 pages, 2.4 s), and the same at
 * `limit=200` (still not exhausted after 10 pages, 5.8 s).
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param lane the conversation lane to page
 * @param onPage optional per-page progress callback, counting within THIS lane
 * @param pageSize how many conversations each page asks for; the seam's own default when absent
 * @returns this lane's conversations, or `err` naming why completeness could not be established
 */
export async function fetchCompleteSlackLane({
  api,
  lane,
  onPage,
  pageSize,
}: {
  api: Pick<SlackApi, "listChannels">;
  lane: SlackConversationLane;
  onPage?: (progress: { pageCount: number; channelCount: number }) => void;
  pageSize?: number;
}): Promise<Result<{ channels: readonly SlackChannelRef[]; pageCount: number }, SlackPageError>> {
  const label = slackLaneLabel({ lane });
  const channels: SlackChannelRef[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (pageCount < MAX_PAGES) {
    const page = await readChannelsPage({ api, cursor, lane, pageSize });
    if (page.isErr()) {
      return err(page.error);
    }
    channels.push(...channelsFromPage({ channels: page.value.channels }));
    pageCount += 1;
    onPage?.({ channelCount: channels.length, pageCount });
    const { nextCursor } = page.value;
    if (nextCursor === undefined || nextCursor.length === 0) {
      return ok({ channels, pageCount });
    }
    if (seenCursors.has(nextCursor)) {
      return err(SlackPageErrors.cursorRepeated({ where: `a ${label} pagination cursor` }));
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return err(SlackPageErrors.pageCeilingExceeded({ maxPages: MAX_PAGES, where: label }));
}

/**
 * One channel-discovery page, with a thrown SDK error converted to `err` rather than escaping.
 *
 * @param api the Slack read seam
 * @param lane the conversation lane this page belongs to
 * @param cursor the page cursor, or undefined for the first page
 * @param pageSize how many conversations the page asks for, or undefined for the seam's default
 * @returns the page, or `err` describing the failure
 */
async function readChannelsPage({
  api,
  lane,
  cursor,
  pageSize,
}: {
  api: Pick<SlackApi, "listChannels">;
  lane: SlackConversationLane;
  cursor: string | undefined;
  pageSize: number | undefined;
}): Promise<Result<{ channels: readonly unknown[]; nextCursor?: string }, SlackPageError>> {
  try {
    const page = await api.listChannels({ lane, pageSize, ...(cursor !== undefined ? { cursor } : {}) });
    return ok(page);
  } catch (error: unknown) {
    return err(SlackPageErrors.pageFetchFailed({ cause: error, context: slackLaneLabel({ lane }) }));
  }
}
