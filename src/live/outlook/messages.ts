/**
 * Reading Outlook messages: a folder listing, a search, one message, and one conversation — each mapped from
 * Graph's wire shape into the door's own, refusing an answer that left out a field the `$select` asked for.
 *
 * Two Graph refusals shape the queries, and both are answered here rather than worked around:
 *
 * - `$search` takes neither `$filter` nor `$orderby`, so `--unread` beside `--query` filters the fetched
 *   results in memory, up to {@link MAX_SEARCH_PAGES} pages, and the result SAYS it may have underfilled.
 * - A `conversationId` filter refuses `$orderby`, so a thread is ordered in memory by received time, then id.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi, Page, PageStart } from "./apiCore.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import type { GraphMessage } from "./graphWire.js";

/** One address on a message. */
export interface OutlookAddress {
  readonly name: string | null;
  readonly address: string | null;
}

/** A listing row: enough to choose a message, never its body. */
export interface OutlookMessageSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly folderId: string;
  readonly subject: string | null;
  readonly preview: string;
  readonly from: OutlookAddress | null;
  readonly receivedIso: string | null;
  readonly isRead: boolean;
  readonly hasAttachments: boolean;
  readonly categories: readonly string[];
}

/** One message in full. */
export interface OutlookMessage extends OutlookMessageSummary {
  readonly body: string;
  readonly to: readonly OutlookAddress[];
  readonly cc: readonly OutlookAddress[];
  readonly bcc: readonly OutlookAddress[];
  readonly isDraft: boolean;
  readonly webLink: string | null;
}

/**
 * One address as a preview line, a listing row and an approval digest all write it.
 *
 * @returns `Name <addr>`, the bare address, or a marker naming what is missing
 */
export function formatOutlookAddress({ address }: { address: OutlookAddress }): string {
  if (address.address === null) {
    return address.name === null ? "(no address)" : `${address.name} (no address)`;
  }
  return address.name === null ? address.address : `${address.name} <${address.address}>`;
}

/** What `outlook list` answers. */
export interface OutlookListing {
  readonly messages: readonly OutlookMessageSummary[];
  /** True when unread filtering ran over fetched search results, which can underfill `limit`. */
  readonly unreadFilteredLocally: boolean;
  /** True when more matching messages exist past what was returned. */
  readonly more: boolean;
}

/** How many search pages an unread-filtered search reads before it stops. */
const MAX_SEARCH_PAGES = 10;

/** How many pages one conversation read follows before it refuses to call the thread whole. */
const MAX_THREAD_PAGES = 20;

/**
 * A recipient as the door reads it; `null` for a wire address Graph left empty. A blank address string is no
 * address at all, so it reads as `null` and every refusal keyed on a missing address sees it (a draft
 * `from` of `""` once previewed as `Nameless <>` and reached `sendDraft`).
 */
function toAddress({
  wire,
}: {
  wire: { emailAddress: { address?: string | null | undefined; name?: string | null | undefined } } | null | undefined;
}): OutlookAddress | null {
  if (wire == null) {
    return null;
  }
  const { address } = wire.emailAddress;
  const noAddress = address == null || address.trim() === "";
  return { address: noAddress ? null : address, name: unsetFieldAsNull({ key: "name", record: wire.emailAddress }) };
}

/** A recipient list, dropping an entry Graph answered with no address at all. */
function toAddresses({
  wire,
}: {
  wire: readonly { emailAddress: { address?: string | null | undefined; name?: string | null | undefined } }[];
}): readonly OutlookAddress[] {
  return wire.flatMap((entry) => {
    const mapped = toAddress({ wire: entry });
    return mapped === null ? [] : [mapped];
  });
}

/**
 * One wire message as a listing row, refusing one that lacks a selected field.
 *
 * @param operation the call that produced it, named in a refusal
 * @returns the row, or the missing field
 */
export function toSummary({
  message,
  operation,
}: {
  message: GraphMessage;
  operation: string;
}): Result<OutlookMessageSummary, OutlookError> {
  const { conversationId, parentFolderId, isRead, hasAttachments, categories, bodyPreview } = message;
  const missing = ({ field }: { field: string }): Result<OutlookMessageSummary, OutlookError> =>
    err(OutlookErrors.responseFieldMissing({ field, operation }));
  if (conversationId == null) {
    return missing({ field: "conversationId" });
  }
  if (parentFolderId == null) {
    return missing({ field: "parentFolderId" });
  }
  if (isRead === undefined || hasAttachments === undefined || categories === undefined || bodyPreview === undefined) {
    return missing({ field: "isRead/hasAttachments/categories/bodyPreview" });
  }
  return ok({
    categories,
    conversationId,
    folderId: parentFolderId,
    from: toAddress({ wire: message.from }),
    hasAttachments,
    id: message.id,
    isRead,
    preview: bodyPreview,
    receivedIso: unsetFieldAsNull({ key: "receivedDateTime", record: message }),
    subject: unsetFieldAsNull({ key: "subject", record: message }),
  });
}

/**
 * One wire message in full, refusing one that lacks a selected field.
 *
 * @param operation the call that produced it, named in a refusal
 * @returns the message, or the missing field
 */
export function toMessage({
  message,
  operation,
}: {
  message: GraphMessage;
  operation: string;
}): Result<OutlookMessage, OutlookError> {
  const summary = toSummary({ message, operation });
  if (summary.isErr()) {
    return err(summary.error);
  }
  const { body, toRecipients, ccRecipients, bccRecipients, isDraft } = message;
  if (body === undefined || toRecipients === undefined || ccRecipients === undefined || bccRecipients === undefined) {
    return err(OutlookErrors.responseFieldMissing({ field: "body/recipients", operation }));
  }
  if (isDraft === undefined) {
    return err(OutlookErrors.responseFieldMissing({ field: "isDraft", operation }));
  }
  return ok({
    ...summary.value,
    bcc: toAddresses({ wire: bccRecipients }),
    body: body.content,
    cc: toAddresses({ wire: ccRecipients }),
    isDraft,
    to: toAddresses({ wire: toRecipients }),
    webLink: unsetFieldAsNull({ key: "webLink", record: message }),
  });
}

/** Map a page's messages, stopping at the first that lacks a field. */
function summaries({
  page,
  operation,
}: {
  page: Page<GraphMessage>;
  operation: string;
}): Result<readonly OutlookMessageSummary[], OutlookError> {
  const mapped: OutlookMessageSummary[] = [];
  for (const message of page.items) {
    const summary = toSummary({ message, operation });
    if (summary.isErr()) {
      return err(summary.error);
    }
    mapped.push(summary.value);
  }
  return ok(mapped);
}

/** A received instant as a sort key; a message with none (an unsent draft) sorts as the oldest. */
function receivedKey({ message }: { message: OutlookMessageSummary }): string {
  if (message.receivedIso === null) {
    return "";
  }
  return message.receivedIso;
}

/**
 * List a folder's messages, or search it.
 *
 * @param folderId the resolved folder id
 * @param query free text for Graph's `$search`, or undefined for a plain listing
 * @param unreadOnly keep only unread messages
 * @param limit how many to return, 1..100
 * @returns the listing, or the first failure
 */
export async function listOutlookMessages({
  api,
  folderId,
  query,
  unreadOnly,
  limit,
}: {
  api: OutlookApi;
  folderId: string;
  query: string | undefined;
  unreadOnly: boolean;
  limit: number;
}): Promise<Result<OutlookListing, OutlookError>> {
  if (query === undefined) {
    const page = await api.listMessages({ first: { folderId, top: limit, unreadOnly } });
    if (page.isErr()) {
      return err(page.error);
    }
    // Graph orders this page itself, unread or not (`apiPaged.ts`'s `UNREAD_NEWEST_FIRST`).
    return summaries({ operation: "outlook.messages.list", page: page.value }).map((messages) => ({
      messages,
      more: page.value.nextLink !== undefined,
      unreadFilteredLocally: false,
    }));
  }
  const kept: OutlookMessageSummary[] = [];
  let start: PageStart<{ folderId: string; search: string; top: number }> = {
    first: { folderId, search: query, top: limit },
  };
  for (let pages = 1; ; pages += 1) {
    const page = await api.searchMessages(start);
    if (page.isErr()) {
      return err(page.error);
    }
    const mapped = summaries({ operation: "outlook.messages.search", page: page.value });
    if (mapped.isErr()) {
      return err(mapped.error);
    }
    kept.push(...mapped.value.filter((message) => !unreadOnly || !message.isRead));
    const { nextLink } = page.value;
    const done = kept.length >= limit || nextLink === undefined || !unreadOnly || pages >= MAX_SEARCH_PAGES;
    if (done) {
      return ok({
        messages: kept.slice(0, limit),
        more: kept.length > limit || nextLink !== undefined,
        unreadFilteredLocally: unreadOnly,
      });
    }
    start = { link: nextLink };
  }
}

/**
 * Read one message in full.
 *
 * @param id the message's (immutable) id
 * @returns the message, or why it could not be read
 */
export async function readOutlookMessage({
  api,
  id,
}: {
  api: OutlookApi;
  id: string;
}): Promise<Result<OutlookMessage, OutlookError>> {
  const message = await api.getMessage({ id });
  if (message.isErr()) {
    return err(message.error);
  }
  return toMessage({ message: message.value, operation: "outlook.messages.get" });
}

/**
 * Order a conversation oldest first, then by id, so the same thread always prints the same way.
 *
 * @returns the messages in reading order
 */
export function threadOrder({ messages }: { messages: readonly OutlookMessage[] }): readonly OutlookMessage[] {
  return messages.toSorted(
    (a, b) => receivedKey({ message: a }).localeCompare(receivedKey({ message: b })) || a.id.localeCompare(b.id),
  );
}

/**
 * Read every message in one conversation, oldest first. A thread longer than {@link MAX_THREAD_PAGES} pages is
 * refused rather than printed partial, since a partial thread reads as a whole one.
 *
 * @param conversationId the conversation to read
 * @returns the thread in reading order, or why it could not be read whole
 */
export async function readOutlookThread({
  api,
  conversationId,
}: {
  api: OutlookApi;
  conversationId: string;
}): Promise<Result<readonly OutlookMessage[], OutlookError>> {
  const messages: OutlookMessage[] = [];
  let start: PageStart<{ conversationId: string }> = { first: { conversationId } };
  for (let pages = 1; pages <= MAX_THREAD_PAGES; pages += 1) {
    const page = await api.conversation(start);
    if (page.isErr()) {
      return err(page.error);
    }
    for (const wire of page.value.items) {
      const message = toMessage({ message: wire, operation: "outlook.messages.thread" });
      if (message.isErr()) {
        return err(message.error);
      }
      messages.push(message.value);
    }
    if (page.value.nextLink === undefined) {
      return ok(threadOrder({ messages }));
    }
    start = { link: page.value.nextLink };
  }
  return err(
    OutlookErrors.apiFailed({
      message: `the conversation runs past ${String(MAX_THREAD_PAGES)} pages; it was not printed partial`,
    }),
  );
}
