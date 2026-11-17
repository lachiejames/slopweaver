/**
 * The Outlook door's Graph seam — its interface, the shapes it trades in, and the small pure helpers every
 * method file (`apiRead.ts`, `apiPaged.ts`, `apiWrite.ts`) shares. `api.ts` assembles the production seam.
 *
 * ## Three properties every request has
 *
 * - **`Prefer: IdType="ImmutableId"` on every call, paging links included.** A default Graph message id
 *   CHANGES when the message moves folder, so an id read before an archive would name nothing after it.
 *   Microsoft documents immutable ids as stable across moves when the header is sent on each request.
 * - **Reads ask for text bodies** (`outlook.body-content-type="text"`), so no verb renders stored HTML.
 * - **A paging link is followed only when it points at Graph.** The link is opaque and server-supplied, and
 *   following it sends the owner's bearer; one that names another host is refused, never fetched.
 *
 * Retry modes follow what a replay would do: a GET or an absolute-state PATCH (`isRead`, `categories`, a
 * draft's fields) is `transient`, because repeating it lands the same state; a move, a create, a
 * `createReply` and a send are `never`, because each can act twice after an ambiguous answer.
 */
import type { Boundary } from "#lib/boundary.js";
import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { GRAPH_ORIGIN } from "./authority.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import {
  type GraphAttachment,
  type GraphCategory,
  type GraphDeltaMessage,
  type GraphMailFolder,
  type GraphMessage,
  MESSAGE_PAGE,
} from "./graphWire.js";

/** The rate-limit registry entry every call is paced against. */
export const PROVIDER = "outlook";

/** Sent on every request — see this file's header. */
export const PREFER_IMMUTABLE = 'IdType="ImmutableId"';

/** Sent on every read that can carry a body. */
export const PREFER_READ = `${PREFER_IMMUTABLE}, outlook.body-content-type="text"`;

/** What a listing selects: enough to show a row, never a body. */
export const SUMMARY_SELECT: readonly string[] = [
  "id",
  "conversationId",
  "parentFolderId",
  "subject",
  "bodyPreview",
  "from",
  "sender",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "hasAttachments",
  "categories",
  "internetMessageId",
];

/** What a full read selects: the summary, the body and every recipient list. */
export const FULL_SELECT: readonly string[] = [
  ...SUMMARY_SELECT,
  "body",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "isDraft",
  "webLink",
];

/**
 * What a draft read for a send selects: the full read plus `changeKey`, Graph's version stamp for the item. The
 * body comes back as a text projection, so the digest carries `changeKey` too, and an edit the text cannot show
 * (an HTML link target, say) still voids an approval.
 */
export const DRAFT_SELECT: readonly string[] = [...FULL_SELECT, "changeKey"];

/** What a folder read selects. */
export const FOLDER_SELECT: readonly string[] = [
  "id",
  "displayName",
  "parentFolderId",
  "childFolderCount",
  "totalItemCount",
  "unreadItemCount",
  "isHidden",
];

/** One page of a listing, and where the next one starts. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextLink: string | undefined;
}

/** A message field patch: absolute values, so a replay lands the same state. */
export interface MessagePatch {
  readonly isRead?: boolean;
  readonly categories?: readonly string[];
}

/** One recipient, as Graph takes it on a write. */
export interface WireRecipient {
  readonly emailAddress: { readonly address: string; readonly name?: string };
}

/** The draft fields a create or a patch sends, built by `drafts.ts` from the shared compose form. */
export interface DraftPayload {
  readonly subject: string;
  readonly body: { readonly contentType: "text"; readonly content: string };
  readonly toRecipients: readonly WireRecipient[];
  readonly ccRecipients: readonly WireRecipient[];
  readonly bccRecipients: readonly WireRecipient[];
}

/** `GET /me` as the door reads it. A personal account's `mail` is often null; its UPN is then the address. */
export interface OutlookIdentity {
  readonly id: string;
  readonly mail: string | null | undefined;
  readonly userPrincipalName: string | null | undefined;
}

/** Where a listing starts: a folder's first page, or a link Graph handed back. */
export type PageStart<T> = { readonly first: T } | { readonly link: string };

/**
 * One page of a folder's message delta. Exactly one of the two links is set: `nextLink` while the round is
 * still paging, `deltaLink` on its last page, which is what the next round resumes from.
 */
export interface MessageDeltaPage {
  readonly items: readonly GraphDeltaMessage[];
  readonly nextLink: string | undefined;
  readonly deltaLink: string | undefined;
}

/**
 * A delta request: a folder's initial round, or a link Graph handed back, at most `maxPageSize` items a page.
 * @internal — the argument type of `OutlookApi.messageDelta`; callers build it inline.
 */
export interface MessageDeltaRequest {
  readonly start: PageStart<{ readonly folderId: string }>;
  readonly maxPageSize: number;
}

/** The Outlook door's Graph seam. Every method answers a boundary-checked wire value or the typed failure. */
export interface OutlookApi {
  /** `GET /me` — the bound account's identity. */
  readonly me: () => Promise<Result<OutlookIdentity, OutlookError>>;
  /** A folder's messages, newest first; `unreadOnly` narrows them without losing the order. */
  readonly listMessages: (
    args: PageStart<{ folderId: string; unreadOnly: boolean; top: number }>,
  ) => Promise<Result<Page<GraphMessage>, OutlookError>>;
  /** A `$search` within a folder, in Graph's own order: newest sent first. */
  readonly searchMessages: (
    args: PageStart<{ folderId: string; search: string; top: number }>,
  ) => Promise<Result<Page<GraphMessage>, OutlookError>>;
  /** Every message in one conversation, unordered — Graph refuses `$orderby` beside this `$filter`. */
  readonly conversation: (
    args: PageStart<{ conversationId: string }>,
  ) => Promise<Result<Page<GraphMessage>, OutlookError>>;
  /** One page of a folder's message delta; an expired delta link answers `DELTA_STATE_EXPIRED`. */
  readonly messageDelta: (args: MessageDeltaRequest) => Promise<Result<MessageDeltaPage, OutlookError>>;
  /** One message in full. */
  readonly getMessage: (args: { id: string }) => Promise<Result<GraphMessage, OutlookError>>;
  /** A folder by id or well-known name (`inbox`, `archive`, `drafts`, …). */
  readonly getFolder: (args: { reference: string }) => Promise<Result<GraphMailFolder, OutlookError>>;
  /** The top-level folders, or one folder's children. */
  readonly listFolders: (
    args: PageStart<{ parentId: string | undefined }>,
  ) => Promise<Result<Page<GraphMailFolder>, OutlookError>>;
  /** The mailbox's master category list. */
  readonly listCategories: () => Promise<Result<readonly GraphCategory[], OutlookError>>;
  /** A message's attachments, metadata only. */
  readonly listAttachments: (args: { messageId: string }) => Promise<Result<readonly GraphAttachment[], OutlookError>>;
  /** One file attachment's bytes. */
  readonly attachmentBytes: (args: {
    messageId: string;
    attachmentId: string;
  }) => Promise<Result<Uint8Array, OutlookError>>;
  /** Set a message's read state or categories. */
  readonly patchMessage: (args: { id: string; patch: MessagePatch }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Move a message to a folder; answers the moved message under its (immutable, unchanged) id. */
  readonly moveMessage: (args: { id: string; destinationId: string }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Create a new draft in Drafts. */
  readonly createDraft: (args: { payload: DraftPayload }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Create a reply draft to a message, with Graph's own quoting and recipients. */
  readonly createReply: (args: { replyTo: string }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Overwrite a draft's fields. */
  readonly patchDraft: (args: {
    id: string;
    payload: Partial<DraftPayload>;
  }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Read a draft as Graph currently holds it — what a send's digest is computed over. */
  readonly getDraft: (args: { id: string }) => Promise<Result<GraphMessage, OutlookError>>;
  /** Send a draft. Graph answers 202 with no body. */
  readonly sendDraft: (args: { id: string }) => Promise<Result<void, OutlookError>>;
}

/**
 * A failed call, as this door names it.
 *
 * @returns the door's typed failure carrying the boundary error as its cause
 */
export function failed({ error }: { error: IngestError }): OutlookError {
  return OutlookErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * A failed write that is never retried (a create, a `createReply`, a move, a send), named by whether Graph can
 * have performed it. A 4xx answer or the shared rate-limit block means it did not, and reads as the plain
 * failure; anything else leaves the mailbox unknown, so the refusal names where to look before running it
 * again. That includes a 2xx: the Graph SDK keeps the success status on the error it throws when it cannot
 * parse the body, so a status below 400 means Graph accepted the write.
 *
 * @param operation the call's label, named in the refusal
 * @param check where the owner looks to see whether it happened (Drafts, Sent Items, the destination folder)
 * @returns the plain failure, or the unknown-outcome refusal
 */
export function writeFailure({
  error,
  operation,
  check,
}: {
  error: IngestError;
  operation: string;
  check: string;
}): OutlookError {
  const answeredClientError = error.status !== undefined && error.status >= 400 && error.status < 500;
  const refusedOutright = error.kind === "rate-limit" || answeredClientError;
  if (refusedOutright) {
    return failed({ error });
  }
  const detail = error.status === undefined ? error.message : `Graph answered ${String(error.status)}`;
  return OutlookErrors.writeOutcomeUnknown({ cause: error, check, detail, operation });
}

/**
 * Validate a never-retried write's answer: a 2xx that fails the boundary means the write HAPPENED, and the
 * refusal says so rather than reading like a write that never ran.
 *
 * @param operation the call's label, named in the refusal
 * @param check where the owner looks to see what it did
 * @returns the validated wire value, or the unknown-outcome refusal
 */
export function checkedWrite<T>({
  boundary,
  value,
  operation,
  check,
}: {
  boundary: Boundary<T>;
  value: unknown;
  operation: string;
  check: string;
}): Result<T, OutlookError> {
  return boundary.parse({ value }).mapErr((error) =>
    OutlookErrors.writeOutcomeUnknown({
      check,
      detail: `Graph accepted it, then answered in a shape this door does not declare — ${error.message}`,
      operation,
    }),
  );
}

/**
 * Validate an answer against its boundary, naming the operation on drift.
 *
 * @param operation the call's label, named in a drift refusal
 * @returns the validated wire value, or the drift
 */
export function checked<T>({
  boundary,
  value,
  operation,
}: {
  boundary: Boundary<T>;
  value: unknown;
  operation: string;
}): Result<T, OutlookError> {
  return boundary.parse({ value }).mapErr((error) => OutlookErrors.boundary({ error, operation }));
}

/**
 * Whether a paging link is safe to follow with the owner's bearer: HTTPS, exactly Graph's host, no userinfo.
 *
 * @param link the `@odata.nextLink` Graph answered
 * @returns true only for a link on {@link GRAPH_ORIGIN}
 */
export function isGraphLink({ link }: { link: string }): boolean {
  if (!URL.canParse(link)) {
    return false;
  }
  const url = new URL(link);
  return url.origin === GRAPH_ORIGIN && url.username === "" && url.password === "";
}

/**
 * Refuse a page start whose link does not point at Graph; a first page always passes. The link is read ONCE
 * and the answer is a fresh copy, so the caller requests exactly the value that was checked: a start object
 * that changed between the check and the request (a getter, a mutation while the call waits) cannot slip a
 * second link past it.
 *
 * @returns the checked start to request, or the refusal naming the link
 */
export function followable<T>({ start }: { start: PageStart<T> }): Result<PageStart<T>, OutlookError> {
  if (!("link" in start)) {
    return ok({ first: start.first });
  }
  const { link } = start;
  if (!isGraphLink({ link })) {
    return err(OutlookErrors.nextLinkRefused({ link }));
  }
  return ok({ link });
}

/**
 * A message page's items and next link.
 *
 * @param value the raw page Graph answered
 * @param operation the call's label, named in a drift refusal
 * @returns the page, or the drift
 */
export function messagePage({
  value,
  operation,
}: {
  value: unknown;
  operation: string;
}): Result<Page<GraphMessage>, OutlookError> {
  return checked({ boundary: MESSAGE_PAGE, operation, value }).map((page) => ({
    items: page.value,
    nextLink: page["@odata.nextLink"],
  }));
}

/**
 * Path-safe form of an id Graph issued, for a URL segment.
 *
 * @returns the id, percent-encoded
 */
export function segment({ id }: { id: string }): string {
  return encodeURIComponent(id);
}

/**
 * Escape a value for a single-quoted OData string literal: a quote is doubled.
 *
 * @param value the raw value
 * @returns the value safe between single quotes
 */
export function odataQuoted({ value }: { value: string }): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Quote a `$search` the way Graph requires: the whole query in double quotes, an embedded double quote or
 * backslash escaped with a backslash. KQL inside the quotes still reads as KQL — Graph's own examples are
 * `$search="from:randiw"` and `$search="from:adelev OR from:alexw"`
 * (learn.microsoft.com/graph/search-query-parameter § messages), so `from:` and `subject:` work as typed.
 *
 * @param query what the owner typed
 * @returns the quoted search term
 */
export function searchQuoted({ query }: { query: string }): string {
  return `"${query.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
