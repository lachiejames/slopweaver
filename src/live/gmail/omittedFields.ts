/**
 * The Gmail fields a SUCCESSFUL response leaves out by design, each read by its own function that says why
 * Gmail omits that one field and what its absence means here.
 *
 * Google's JSON drops an empty list rather than sending `[]`, and drops a cursor that has nothing after it.
 * So for the fields below an omitted key is an ordinary answer — no match, no change, a leaf part, the last
 * page — not a malformed response. A field Gmail always sends on success is deliberately NOT read here: its
 * absence is a different question, and a reader here would hide it.
 *
 * Pure: no I/O, no SDK client, only the SDK's own resource types.
 */
import type { gmail_v1 } from "@googleapis/gmail";

import type { GmailMessage, GmailPart } from "./parse.js";

/**
 * The messages one `history.list` record reports as ADDED. A History record carries `messagesAdded` only when
 * the change it records is an addition; a record of a label change or a deletion omits the field, and adds no
 * message.
 *
 * @param record one record from a `history.list` page
 * @returns the added-message entries, or none when the record reports a different kind of change
 */
export function addedMessages({
  record,
}: {
  record: gmail_v1.Schema$History;
}): readonly gmail_v1.Schema$HistoryMessageAdded[] {
  const { messagesAdded } = record;
  if (messagesAdded == null) {
    return [];
  }
  return messagesAdded;
}

/**
 * The message references one `messages.list` page carries. A query that matches nothing comes back with no
 * `messages` key at all — only its `resultSizeEstimate` — so an omitted list is a page with no matches.
 *
 * @param data the `messages.list` response body
 * @returns the page's message references, or none when the query matched nothing
 */
export function listedMessages({
  data,
}: {
  data: gmail_v1.Schema$ListMessagesResponse;
}): readonly gmail_v1.Schema$Message[] {
  const { messages } = data;
  if (messages == null) {
    return [];
  }
  return messages;
}

/**
 * The records one `history.list` page carries. A mailbox with no change since the requested history id comes
 * back with only its current `historyId` and no `history` key, so an omitted list means nothing changed.
 *
 * @param data the `history.list` response body
 * @returns the page's history records, or none when nothing changed
 */
export function historyRecords({
  data,
}: {
  data: gmail_v1.Schema$ListHistoryResponse;
}): readonly gmail_v1.Schema$History[] {
  const { history } = data;
  if (history == null) {
    return [];
  }
  return history;
}

/**
 * The cursor to the next page of a Gmail listing — `messages.list` and `history.list` both page with
 * `nextPageToken`. Gmail omits it on the LAST page, so its absence is how a walk knows to stop; the SDK's
 * `null` is that same absence and reads as `undefined`, never as an empty cursor.
 *
 * @param page the listing response body
 * @returns the cursor, or undefined on the last page
 */
export function nextPageCursor({ page }: { page: { nextPageToken?: string | null } }): string | undefined {
  const { nextPageToken } = page;
  if (nextPageToken == null) {
    return undefined;
  }
  return nextPageToken;
}

/**
 * The messages a `threads.modify` response carries. The call returns the Thread resource, and whether Gmail
 * includes the thread's `messages` in it is not something to rely on: an omitted list here means "read back
 * nothing", which the caller reports as unverified residue rather than as a thread with no messages.
 *
 * @param data the Thread resource `threads.modify` returned
 * @returns the messages read back, or none when the response did not carry them
 */
export function threadReadBack({ data }: { data: gmail_v1.Schema$Thread }): readonly gmail_v1.Schema$Message[] {
  const { messages } = data;
  if (messages == null) {
    return [];
  }
  return messages;
}

/**
 * The label ids on one message. A message with no label at all — archived, read, never filed — comes back
 * with no `labelIds` key, so an omitted list is a message carrying no labels.
 *
 * @param message the message as Gmail returned it
 * @returns its label ids, or none when it carries no label
 */
export function messageLabelIds({ message }: { message: GmailMessage }): readonly string[] {
  const { labelIds } = message;
  if (labelIds == null) {
    return [];
  }
  return labelIds;
}

/**
 * The child parts of one MIME part. Only a `multipart/*` part has children; a leaf part — one body, one media
 * type — comes back with no `parts` key, so an omitted list is a leaf.
 *
 * @param part one part of a message's MIME tree
 * @returns its children, or none when it is a leaf
 */
export function childParts({ part }: { part: GmailPart }): readonly GmailPart[] {
  const { parts } = part;
  if (parts == null) {
    return [];
  }
  return parts;
}
