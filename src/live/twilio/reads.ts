/**
 * The three reads an investigation asks Twilio: does the key work, which messages went to or from a number in a
 * window, and what happened to one message.
 *
 * Every read goes through an injected {@link TwilioGet}, so the paging, the bounds and every refusal are testable
 * with canned bodies and no network. Nothing is written anywhere: a read answers a view, and the verb prints it.
 *
 * Paging is bounded twice and neither bound is silent. `limit` is the caller's: reaching it with more remaining
 * says so (`moreRemain`). {@link TWILIO_MAX_PAGES} is this door's: a list that would need more pages than that,
 * or a `next_page_uri` that repeats, is refused rather than truncated, because a truncated delivery list reads
 * exactly like a complete one.
 */
import { boundaryRefusalWords } from "#lib/boundaryWords.js";

import { err, ok, type Result } from "../../lib/result.js";
import { GET_TWILIO_MESSAGE, LIST_TWILIO_MESSAGES } from "./boundaries.js";
import { type TwilioReadError, TwilioReadErrors } from "./errors.js";
import { projectTwilioMessage, type TwilioMessageView } from "./projection.js";
import {
  buildTwilioListUrl,
  buildTwilioMessageUrl,
  resolveTwilioNextPage,
  type TwilioGet,
  type TwilioListQueryKey,
} from "./transport.js";

/** The largest page Twilio serves on this resource. */
const TWILIO_MAX_PAGE_SIZE = 1000;

/** The most pages one list read follows before refusing. */
export const TWILIO_MAX_PAGES = 20;

/** The largest `limit` a list read accepts. */
export const TWILIO_MAX_LIMIT = 5000;

/** What a list read filters on — every field Twilio's own list operation declares a filter for. */
export interface TwilioMessageFilter {
  /** The recipient, E.164. Sent to Twilio; never printed back. */
  readonly to: string | null;
  /** The sender, E.164 or an alphanumeric sender id. */
  readonly from: string | null;
  /** `DateSent>` — sent on or after this date or instant. */
  readonly sentAfter: string | null;
  /** `DateSent<` — sent on or before this date or instant. */
  readonly sentBefore: string | null;
}

/** A list read's answer: the views, and whether the caller's limit cut it short. */
export interface TwilioMessageList {
  readonly messages: readonly TwilioMessageView[];
  /** `true` when the limit was reached and Twilio had another page. */
  readonly moreRemain: boolean;
  /** How many pages were fetched. */
  readonly pages: number;
}

/**
 * Prove the key reads Messages, returning no record: one page of size one, bounded before any message could have
 * been sent, so a working key answers an empty page and nothing personal is fetched at all.
 *
 * @param accountSid the configured account
 * @param get the read seam
 * @returns `true` once Twilio answered a readable page, or why it did not
 */
export async function verifyTwilioAccess({
  accountSid,
  get,
}: {
  accountSid: string;
  get: TwilioGet;
}): Promise<Result<true, TwilioReadError>> {
  const url = buildTwilioListUrl({ accountSid, query: { "DateSent<": "2000-01-01", PageSize: "1" } });
  if (url.isErr()) {
    return err(url.error);
  }
  const text = await get({ url: url.value });
  if (text.isErr()) {
    return err(text.error);
  }
  const page = LIST_TWILIO_MESSAGES.parseJson({ text: text.value });
  if (page.isErr()) {
    return err(
      TwilioReadErrors.responseRefused({
        endpoint: LIST_TWILIO_MESSAGES.endpoint,
        why: boundaryRefusalWords({ refusal: page.error }),
      }),
    );
  }
  return ok(true);
}

/**
 * The query a filter and a page size become.
 *
 * @param filter what the caller narrowed by
 * @param pageSize the page size to ask for
 * @returns the admitted query keys, absent filters omitted
 */
function listQuery({
  filter,
  pageSize,
}: {
  filter: TwilioMessageFilter;
  pageSize: number;
}): Partial<Record<TwilioListQueryKey, string>> {
  const query: Partial<Record<TwilioListQueryKey, string>> = { PageSize: String(pageSize) };
  if (filter.to !== null) {
    query.To = filter.to;
  }
  if (filter.from !== null) {
    query.From = filter.from;
  }
  if (filter.sentAfter !== null) {
    query["DateSent>"] = filter.sentAfter;
  }
  if (filter.sentBefore !== null) {
    query["DateSent<"] = filter.sentBefore;
  }
  return query;
}

/**
 * List messages matching a filter, newest first as Twilio orders them, up to `limit`.
 *
 * @param accountSid the configured account
 * @param get the read seam
 * @param filter what to narrow by
 * @param limit the most messages to return, 1..{@link TWILIO_MAX_LIMIT}
 * @returns the views and whether more remain, or why the read stopped
 */
export async function listTwilioMessages({
  accountSid,
  get,
  filter,
  limit,
}: {
  accountSid: string;
  get: TwilioGet;
  filter: TwilioMessageFilter;
  limit: number;
}): Promise<Result<TwilioMessageList, TwilioReadError>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > TWILIO_MAX_LIMIT) {
    throw new Error(
      `listTwilioMessages: limit ${String(limit)} is outside 1..${String(TWILIO_MAX_LIMIT)}; the parser bounds it`,
    );
  }
  const first = buildTwilioListUrl({
    accountSid,
    query: listQuery({ filter, pageSize: Math.min(limit, TWILIO_MAX_PAGE_SIZE) }),
  });
  if (first.isErr()) {
    return err(first.error);
  }
  const views: TwilioMessageView[] = [];
  const seen = new Set<string>();
  let url = first.value;
  for (let pages = 1; pages <= TWILIO_MAX_PAGES; pages += 1) {
    if (seen.has(url.href)) {
      return err(TwilioReadErrors.paginationRefused({ why: "Twilio answered a next page this read already fetched" }));
    }
    seen.add(url.href);
    const page = await readListPage({ get, url });
    if (page.isErr()) {
      return err(page.error);
    }
    const step = absorbPage({ limit, page: page.value, views });
    if (step.done) {
      return ok({ messages: views, moreRemain: step.moreRemain, pages });
    }
    const resolved = resolveTwilioNextPage({ accountSid, nextPageUri: step.next });
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    url = resolved.value;
  }
  return err(
    TwilioReadErrors.paginationRefused({
      why: `the list needs more than ${String(TWILIO_MAX_PAGES)} pages — narrow the window or the number`,
    }),
  );
}

/**
 * Take one page's views up to `limit` and say what the page decides: the list is done, and whether more remain,
 * or the read follows `next`. One view past the limit proves more remain; reaching it with a next page left proves
 * the same.
 *
 * @param views the views so far, appended to in place
 * @param page the projected page
 * @param limit the most views the read returns
 * @returns `done` with `moreRemain`, or the next page to follow
 */
function absorbPage({
  views,
  page,
  limit,
}: {
  views: TwilioMessageView[];
  page: { views: readonly TwilioMessageView[]; nextPageUri: string | null };
  limit: number;
}): { done: true; moreRemain: boolean } | { done: false; next: string } {
  const room = limit - views.length;
  for (const view of page.views.slice(0, room)) {
    views.push(view);
  }
  const next = page.nextPageUri;
  if (page.views.length > room || (next !== null && views.length === limit)) {
    return { done: true, moreRemain: true };
  }
  if (next === null) {
    return { done: true, moreRemain: false };
  }
  return { done: false, next };
}

/**
 * Fetch and project one page.
 *
 * @param get the read seam
 * @param url the page's URL
 * @returns the page's views and its next page, or why it could not be read
 */
async function readListPage({
  get,
  url,
}: {
  get: TwilioGet;
  url: URL;
}): Promise<Result<{ views: readonly TwilioMessageView[]; nextPageUri: string | null }, TwilioReadError>> {
  const text = await get({ url });
  if (text.isErr()) {
    return err(text.error);
  }
  const page = LIST_TWILIO_MESSAGES.parseJson({ text: text.value });
  if (page.isErr()) {
    return err(
      TwilioReadErrors.responseRefused({
        endpoint: LIST_TWILIO_MESSAGES.endpoint,
        why: boundaryRefusalWords({ refusal: page.error }),
      }),
    );
  }
  const views: TwilioMessageView[] = [];
  for (const message of page.value.messages) {
    const view = projectTwilioMessage({ message });
    if (view.isErr()) {
      return err(view.error);
    }
    views.push(view.value);
  }
  const next = page.value.next_page_uri;
  return ok({ nextPageUri: next === undefined || next === null || next.length === 0 ? null : next, views });
}

/**
 * Read one message by SID.
 *
 * @param accountSid the configured account
 * @param get the read seam
 * @param sid an `SM…` or `MM…` message SID
 * @returns the view, or why it could not be read
 */
export async function readTwilioMessage({
  accountSid,
  get,
  sid,
}: {
  accountSid: string;
  get: TwilioGet;
  sid: string;
}): Promise<Result<TwilioMessageView, TwilioReadError>> {
  const url = buildTwilioMessageUrl({ accountSid, sid });
  if (url.isErr()) {
    return err(url.error);
  }
  const text = await get({ url: url.value });
  if (text.isErr()) {
    return err(text.error);
  }
  const message = GET_TWILIO_MESSAGE.parseJson({ text: text.value });
  if (message.isErr()) {
    return err(
      TwilioReadErrors.responseRefused({
        endpoint: GET_TWILIO_MESSAGE.endpoint,
        why: boundaryRefusalWords({ refusal: message.error }),
      }),
    );
  }
  return projectTwilioMessage({ message: message.value });
}
