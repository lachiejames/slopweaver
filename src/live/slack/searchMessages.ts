/**
 * The live Slack leg of the review-state read — `search.messages` as a CANDIDATE GENERATOR, never as the
 * answer.
 *
 * ## Why a live leg exists beside a local corpus at all
 *
 * MEASURED: the owner's Slack bronze ended a day before the clock read — a twenty-five-hour blind window. A review ask made yesterday afternoon is therefore
 * invisible to a corpus-only read, and "nobody has been asked" is exactly the confident-but-wrong answer the
 * seven questions exist to stop producing. So the corpus answers the deep history and this answers the tail,
 * and the union is reported with the window each half covered.
 *
 * ## Why its result is judged locally rather than trusted
 *
 * Slack's search is not an exact-substring index. Querying the full pull-request URL matches on the tokens
 * inside it, so a hit is a CANDIDATE: the caller re-tests each match's own text with the same exact,
 * boundary-aware matcher the corpus leg uses (`../../review/prLink.ts`). Two further documented behaviours
 * are carried as residue rather than worked around, because neither has a workaround on this method:
 *
 *  - **`next_cursor` is filed under `messages.pagination`**, not the `response_metadata` every
 *    `conversations.*` method uses. A pager that knows only Slack's own convention reads one page as the
 *    whole result. {@link parseSearchMessages} reads BOTH, and reports `total` so a truncated read is visible.
 *  - **Proximate matches are collapsed by documentation** — "when a search query matches multiple messages in
 *    close proximity to one another, only one match will be returned". A burst of replies in one thread is
 *    exactly what an ask-and-bump sequence looks like, so this leg under-counts and never over-counts.
 *
 * Both were measured on this workspace, and both return HTTP 200 with a plausible payload.
 */

import { makeSlackSearchCall } from "../../corpus/slack/api.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import { type SlackLiveSearchError, SlackLiveSearchErrors } from "./searchErrors.js";

/** One message Slack's search offered as a candidate, reduced to what an exact judge and a row both need. */
export interface SlackSearchMatch {
  readonly permalink: string;
  readonly channelName: string;
  readonly channelId: string;
  /** The author's Slack user id, or the empty string when the match carries only a display name. */
  readonly userId: string;
  readonly tsIso: string;
  /**
   * Slack's own `ts`, kept raw beside {@link tsIso}.
   *
   * With the channel id it is the message's IDENTITY, which is what the two Slack legs are merged on. The
   * permalink cannot serve: this leg's carries a `?thread_ts=…` query string and the corpus leg's does not,
   * so a merge keyed on it never collides — see `../../review/slackEvidence.mergeMentions`.
   */
  readonly ts: string;
  /** The message text, exactly as Slack returned it — the input the exact matcher judges. */
  readonly text: string;
}

/** One page of search candidates, with what Slack said about the rest of them. */
export interface SlackSearchPage {
  readonly matches: readonly SlackSearchMatch[];
  /** Slack's own count of every match, which is how a capped page is told from a complete one. */
  readonly total: number;
  /** How many pages Slack says the result spans, read from `messages.paging.pages`; 1 when it names none. */
  readonly pageCount: number;
}

/** The injected live-search seam. Production builds a read-only `WebClient`; a test passes a plain fake. */
export type SlackSearchMessages = (args: {
  query: string;
  count: number;
  /** 1-based, as `search.messages` numbers its pages. */
  page: number;
}) => Promise<Result<SlackSearchPage, SlackLiveSearchError>>;

/**
 * What one paged search actually read, so a row can say how far its live evidence reached.
 *
 * A search is complete only when every page Slack named was read. A failed page is kept as the failure's own
 * message rather than dropped: the matches before it are still real, and the absence after it is not.
 */
export interface SlackSearchReceipt {
  readonly query: string;
  readonly pagesRead: number;
  readonly pageCount: number;
  readonly total: number;
  readonly complete: boolean;
  /** Why the read stopped early, or the empty string when it did not. */
  readonly stoppedBecause: string;
}

/** A Slack `ts` (`"1787942086.747699"`) as an ISO instant, or the empty string when it is not one. */
function tsToIso({ ts }: { ts: unknown }): string {
  const iso = typeof ts === "string" ? slackTsToIso({ ts }) : undefined;
  if (iso === undefined) {
    return "";
  }
  return iso;
}

/** A string field, or the empty string. */
function str({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** Shape one raw `messages.matches[]` entry into a candidate. */
function toMatch({ node }: { node: Record<string, unknown> }): SlackSearchMatch {
  const channel = node["channel"];
  return {
    channelId: isRecord(channel) ? str({ value: channel["id"] }) : "",
    channelName: isRecord(channel) ? str({ value: channel["name"] }) : "",
    permalink: str({ value: node["permalink"] }),
    text: str({ value: node["text"] }),
    ts: str({ value: node["ts"] }),
    tsIso: tsToIso({ ts: node["ts"] }),
    userId: str({ value: node["user"] }),
  };
}

/**
 * Parse one raw `search.messages` body into a page of candidates.
 *
 * @param body the response body
 * @returns the candidates and Slack's own total, or a named failure when the body carries no `messages`
 */
export function parseSearchMessages({ body }: { body: unknown }): Result<SlackSearchPage, SlackLiveSearchError> {
  const messages = isRecord(body) ? body["messages"] : undefined;
  if (!isRecord(messages)) {
    return err(SlackLiveSearchErrors.unreadable({ detail: "the response carried no `messages` object" }));
  }
  const raw = messages["matches"];
  const total = messages["total"];
  return ok({
    matches: (Array.isArray(raw) ? raw : []).filter(isRecord).map((node) => toMatch({ node })),
    pageCount: pageCountOf({ matched: Array.isArray(raw) ? raw.length : 0, messages, total }),
    total: typeof total === "number" ? total : 0,
  });
}

/**
 * How many pages `search.messages` says its result spans.
 *
 * Slack documents `messages.paging.pages` and also files a `messages.pagination.page_count`; either is read.
 * A body naming neither is sized from its own `total` against the matches it carried, so a result larger than
 * one page can never read as one complete page. Found by a fallback review.
 *
 * @param messages the response's `messages` object
 * @param matched how many matches this page carried
 * @param total Slack's own count of every match
 * @returns the page count, at least 1
 */
function pageCountOf({
  messages,
  matched,
  total,
}: {
  messages: Record<string, unknown>;
  matched: number;
  total: unknown;
}): number {
  const paging = messages["paging"];
  const pagination = messages["pagination"];
  const fromPaging = isRecord(paging) ? paging["pages"] : undefined;
  const fromPagination = isRecord(pagination) ? pagination["page_count"] : undefined;
  if (typeof fromPaging === "number" && fromPaging >= 1) {
    return fromPaging;
  }
  if (typeof fromPagination === "number" && fromPagination >= 1) {
    return fromPagination;
  }
  if (typeof total === "number" && matched > 0 && total > matched) {
    return Math.ceil(total / matched);
  }
  return 1;
}

/**
 * Read every page of one search, up to a bound, and say exactly how far the read got.
 *
 * The live leg once read page 1 only, so a pull request linked in more than `count` messages
 * lost every ask past the first page with nothing on the row saying so.
 *
 * @param search the one-page search seam
 * @param query what to search for
 * @param count matches per page
 * @param maxPages the most pages to read; a result spanning more is reported incomplete, never truncated silently
 * @returns every match read, and the receipt describing the read
 */
export async function searchAllPages({
  search,
  query,
  count,
  maxPages,
}: {
  search: SlackSearchMessages;
  query: string;
  count: number;
  maxPages: number;
}): Promise<{ readonly matches: readonly SlackSearchMatch[]; readonly receipt: SlackSearchReceipt }> {
  const matches: SlackSearchMatch[] = [];
  let pageCount = 1;
  let total = 0;
  let pagesRead = 0;
  while (pagesRead < pageCount && pagesRead < maxPages) {
    const page = await search({ count, page: pagesRead + 1, query });
    if (page.isErr()) {
      const receipt = { complete: false, pageCount, pagesRead, query, stoppedBecause: page.error.message, total };
      return { matches, receipt };
    }
    pagesRead += 1;
    pageCount = page.value.pageCount;
    total = page.value.total;
    matches.push(...page.value.matches);
  }
  const complete = pagesRead >= pageCount;
  const stoppedBecause = complete ? "" : `read ${String(pagesRead)} of ${String(pageCount)} pages, the bound`;
  return { matches, receipt: { complete, pageCount, pagesRead, query, stoppedBecause, total } };
}

/**
 * Build the live `search.messages` seam over the ONE sanctioned Slack read client, paced by the shared block.
 *
 * The USER token is what this needs: measured against the real workspace, a user token answered
 * 476 of 477 non-archived conversations while a bot token answered only the channels it had been invited to,
 * so a bot-token search would report an absence that is really a membership boundary.
 *
 * @param token the Slack USER token
 * @returns a search seam, injectable so a test never touches the network
 */
export function makeSlackSearchMessages({ token }: { token: string }): SlackSearchMessages {
  const call = makeSlackSearchCall({ token });
  return async ({ query, count, page }) => {
    const called = await call({ count, page, query });
    if (called.isErr()) {
      return err(SlackLiveSearchErrors.callFailed({ cause: called.error, message: called.error.message }));
    }
    return parseSearchMessages({ body: called.value });
  };
}
