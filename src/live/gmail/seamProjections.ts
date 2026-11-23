/**
 * What each Gmail READ response becomes at the seam — the pure half of `./api.ts`, split out so every
 * projection is tested directly on a plain response body rather than only through a recorded mailbox.
 *
 * Every field read here is one `gmail_v1` declares optional or nullable, and three kinds stand side by side.
 * A field Gmail leaves out BY DESIGN — an empty list, the last page's cursor — is read by
 * `./omittedFields.ts`, whose readers are reused rather than restated. A field Gmail may legitimately not
 * report — an estimate, a history id — is read by its own function below, which carries the omission through
 * as the seam's own `undefined` for its caller to judge, never as a zero or a blank. And a field EVERY
 * successful answer carries — a thread's `messages`, a mailbox's `labels` — is required: an answer without it
 * is refused as `RESPONSE_FIELD_MISSING` rather than read as an empty thread or vocabulary, and one that
 * arrives as something other than a list is refused as `RESPONSE_FIELD_MALFORMED` rather than thrown on.
 *
 * Pure: no I/O, no SDK client, only the SDK's own resource types.
 */
import type { gmail_v1 } from "@googleapis/gmail";

import { err, ok, type Result } from "../../lib/result.js";
import type { GmailHistoryChange, GmailHistoryPage, GmailIdPage, GmailMailboxProfile } from "./api.js";
import { type GmailError, GmailErrors } from "./errors.js";
import { type GmailLabel, labelType } from "./labels.js";
import { addedMessages, historyRecords, listedMessages, nextPageCursor } from "./omittedFields.js";
import type { GmailMessage } from "./parse.js";

/**
 * The mailbox's history id as one response reports it — `getProfile` and `history.list` both carry it, with
 * the same meaning: where the mailbox's change log stands now. An omitted or `null` id is carried as
 * `undefined`, which the delta crawl (`corpus/gmail/fetch.ts`) reads as "no anchor was established" and
 * never as a cursor to store.
 */
function reportedHistoryId({ data }: { data: { historyId?: string | null } }): string | undefined {
  const { historyId } = data;
  if (historyId == null) {
    return undefined;
  }
  return historyId;
}

/** The thread an added message belongs to. A message reference with no `threadId` is carried as `undefined`. */
function changeThreadId({ message }: { message: gmail_v1.Schema$Message }): string | undefined {
  const { threadId } = message;
  if (threadId == null) {
    return undefined;
  }
  return threadId;
}

/**
 * The messages one history record reports as ADDED.
 *
 * Positional because `Array.prototype.flatMap` dictates the signature, and typed from the SDK's own record
 * shape rather than restated.
 */
function addedInRecord(record: gmail_v1.Schema$History): readonly GmailHistoryChange[] {
  return addedMessages({ record })
    .map((entry) => entry.message)
    .filter((message): message is gmail_v1.Schema$Message => message != null)
    .filter((message): message is gmail_v1.Schema$Message & { id: string } => typeof message.id === "string")
    .map((message) => ({ id: message.id, threadId: changeThreadId({ message }) }));
}

/**
 * Collapse repeated message ids, keeping first-seen order.
 *
 * Gmail reports one history RECORD per change, and a single message routinely appears in several — it is
 * added, then labelled, then re-labelled — so a page covering a busy hour names the same id many times. A
 * caller that fetched each occurrence would pay for the same message repeatedly.
 */
function dedupeChanges({ changes }: { changes: readonly GmailHistoryChange[] }): readonly GmailHistoryChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.id)) {
      return false;
    }
    seen.add(change.id);
    return true;
  });
}

/**
 * Gmail's estimate of how many messages a query matches. It is an ESTIMATE, and one Gmail did not give is
 * carried as `undefined` — never as `0`, which would read as "matched nothing".
 */
function pageSizeEstimate({ data }: { data: gmail_v1.Schema$ListMessagesResponse }): number | undefined {
  const { resultSizeEstimate } = data;
  if (resultSizeEstimate == null) {
    return undefined;
  }
  return resultSizeEstimate;
}

/** The address the mailbox reports for itself. One Gmail did not give is carried as `undefined`. */
function profileAddress({ data }: { data: gmail_v1.Schema$Profile }): string | undefined {
  const { emailAddress } = data;
  if (emailAddress == null) {
    return undefined;
  }
  return emailAddress;
}

/** Gmail's own count of the mailbox's messages. A count it did not give is `undefined`, never `0`. */
function profileMessagesTotal({ data }: { data: gmail_v1.Schema$Profile }): number | undefined {
  const { messagesTotal } = data;
  if (messagesTotal == null) {
    return undefined;
  }
  return messagesTotal;
}

/**
 * One `messages.list` page as the seam returns it: the ids, their threads positionally, the cursor and the
 * estimate. A reference missing its id or thread id is dropped from that list.
 *
 * @param data the `messages.list` response body
 * @returns the page of ids the seam answers with
 */
export function projectIdPage({ data }: { data: gmail_v1.Schema$ListMessagesResponse }): GmailIdPage {
  const listed = listedMessages({ data });
  return {
    ids: listed.map((message) => message.id).filter((id): id is string => typeof id === "string"),
    nextPageToken: nextPageCursor({ page: data }),
    resultSizeEstimate: pageSizeEstimate({ data }),
    threadIds: listed.map((message) => message.threadId).filter((id): id is string => typeof id === "string"),
  };
}

/**
 * The messages a `threads.get` response carries. A thread exists only by holding a message, so every successful
 * read carries `messages`; one that omits it is a malformed response, refused with a typed error naming the
 * thread, never read as a thread with no messages. The SDK types the list as an array or absent, so there is
 * no third, non-array shape to tell apart.
 *
 * @param data the Thread resource `threads.get` returned
 * @param threadId the thread id the read asked for, named in the refusal
 * @returns the thread's messages, `RESPONSE_FIELD_MISSING` when the response carried none, or
 *   `RESPONSE_FIELD_MALFORMED` when it carried something other than a list
 */
export function fetchedThreadMessages({
  data,
  threadId,
}: {
  data: Pick<gmail_v1.Schema$Thread, "messages">;
  threadId: string;
}): Result<readonly GmailMessage[], GmailError> {
  const { messages } = data;
  if (messages == null) {
    return err(
      GmailErrors.responseFieldMissing({
        field: "messages",
        operation: "gmail.users.threads.get",
        subject: `thread ${threadId}`,
      }),
    );
  }
  if (!Array.isArray(messages)) {
    return err(
      GmailErrors.responseFieldMalformed({
        expected: "a list",
        field: "messages",
        operation: "gmail.users.threads.get",
        subject: `thread ${threadId}`,
      }),
    );
  }
  return ok(messages);
}

/**
 * The mailbox's label vocabulary from one `labels.list` response, keeping only labels with both an id and a
 * name. Every mailbox holds Gmail's system labels (`INBOX`, `SENT`, …), so every successful response carries
 * `labels`; one that omits it is malformed and refused with a typed error, never read as an empty vocabulary.
 *
 * @param data the `labels.list` response body
 * @returns the labels a name can resolve against, `RESPONSE_FIELD_MISSING` when the response carried none, or
 *   `RESPONSE_FIELD_MALFORMED` when it carried something other than a list
 */
export function projectLabels({
  data,
}: {
  data: Pick<gmail_v1.Schema$ListLabelsResponse, "labels">;
}): Result<readonly GmailLabel[], GmailError> {
  const { labels } = data;
  if (labels == null) {
    return err(
      GmailErrors.responseFieldMissing({
        field: "labels",
        operation: "gmail.users.labels.list",
        subject: "this mailbox",
      }),
    );
  }
  if (!Array.isArray(labels)) {
    return err(
      GmailErrors.responseFieldMalformed({
        expected: "a list",
        field: "labels",
        operation: "gmail.users.labels.list",
        subject: "this mailbox",
      }),
    );
  }
  return ok(
    labels
      .filter(
        (label): label is { id: string; name: string; type?: string | null } =>
          typeof label.id === "string" && typeof label.name === "string",
      )
      .map((label) => ({ id: label.id, name: label.name, type: labelType({ type: label.type }) })),
  );
}

/**
 * The mailbox's own state from one `getProfile` response.
 *
 * @param data the `getProfile` response body
 * @returns the address, current history id and message count, each `undefined` where Gmail gave none
 */
export function projectProfile({ data }: { data: gmail_v1.Schema$Profile }): GmailMailboxProfile {
  return {
    emailAddress: profileAddress({ data }),
    historyId: reportedHistoryId({ data }),
    messagesTotal: profileMessagesTotal({ data }),
  };
}

/**
 * One `history.list` page as the seam returns it: the added messages, deduplicated in reported order, the
 * history id as of this response, and the cursor.
 *
 * @param data the `history.list` response body
 * @returns the page of mailbox changes
 */
export function projectHistoryPage({ data }: { data: gmail_v1.Schema$ListHistoryResponse }): GmailHistoryPage {
  return {
    added: dedupeChanges({ changes: historyRecords({ data }).flatMap(addedInRecord) }),
    historyId: reportedHistoryId({ data }),
    nextPageToken: nextPageCursor({ page: data }),
  };
}
