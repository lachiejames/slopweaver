/**
 * The Gmail API SEAM — the narrow set of calls the door's read verbs make, and the production
 * implementation that routes each one through the paced provider door.
 *
 * The seam is deliberately smaller than `gmail_v1`. A verb asks for "the ids matching this query" or "this
 * message in full"; it does not get a whole SDK surface to reach into, which is what keeps the document
 * builders in `read.ts` pure enough to test with plain object fakes instead of a mailbox.
 */
import type { gmail_v1 } from "@googleapis/gmail";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { draftSeams } from "./draftSeams.js";
import { type GmailError, GmailErrors } from "./errors.js";
import { LISTING_HEADERS } from "./headers.js";
import type { GmailLabel } from "./labels.js";
import { threadReadBack } from "./omittedFields.js";
import type { GmailMessage } from "./parse.js";
import {
  fetchedThreadMessages,
  projectHistoryPage,
  projectIdPage,
  projectLabels,
  projectProfile,
} from "./seamProjections.js";

/** What the mailbox itself says about its current state — the anchor a delta crawl starts from. */
export interface GmailMailboxProfile {
  /** The mailbox address the grant bound to, as Google reports it. */
  readonly emailAddress: string | undefined;
  /**
   * The mailbox's CURRENT history sequence id.
   *
   * Read BEFORE a full crawl rather than after it. Anything delivered while the crawl runs then lands after
   * this id and is picked up by the next delta pass; anchoring afterwards would silently skip exactly that
   * window, and a crawl of a real mailbox is long enough for it to be a real window rather than a race.
   */
  readonly historyId: string | undefined;
  /** Gmail's own count of the messages in the mailbox. */
  readonly messagesTotal: number | undefined;
}

/** One mailbox change Gmail reports: a message id, and the thread it belongs to. */
export interface GmailHistoryChange {
  readonly id: string;
  readonly threadId: string | undefined;
}

/** One page of the mailbox change log since a `historyId`. */
export interface GmailHistoryPage {
  /**
   * Every message ADDED to the mailbox in this page, deduplicated, in the order Gmail reported them.
   *
   * Only additions. Label changes are deliberately not carried: a Gmail label is the owner's filing rather
   * than the message, and a corpus record that changed whenever a message was read or archived would append
   * a fresh bronze line per label flip for no content change at all. Deletions are not carried for the
   * opposite reason — bronze is append-only and lossless, so a message deleted at Google keeps the record
   * that was already true when it was ingested.
   */
  readonly added: readonly GmailHistoryChange[];
  /** The mailbox's history id as of this response — the cursor to store once the page is committed. */
  readonly historyId: string | undefined;
  readonly nextPageToken: string | undefined;
}

/** One page of message ids matching a query, plus the cursor Gmail gave for the next page (if any). */
export interface GmailIdPage {
  readonly ids: readonly string[];
  /** The thread id of each message in {@link ids}, positionally. `messages.list` returns both. */
  readonly threadIds: readonly string[];
  readonly nextPageToken: string | undefined;
  /** Gmail's own rough estimate of the total matching the query. It is an ESTIMATE and says so here. */
  readonly resultSizeEstimate: number | undefined;
}

/** The calls the Gmail verbs make. Injected, so a document builder never needs a live mailbox. */
export interface GmailApi {
  /** List message ids matching a Gmail search query. */
  readonly listMessageIds: (args: {
    query: string | undefined;
    labelIds: readonly string[];
    limit: number;
    /** Gmail's own cursor, from a previous page's `nextPageToken`. Absent ⇒ the first page. */
    pageToken?: string | undefined;
  }) => Promise<Result<GmailIdPage, GmailError>>;
  /** Read the mailbox's own state — the address it is, and the history id a delta crawl anchors on. */
  readonly getProfile: () => Promise<Result<GmailMailboxProfile, GmailError>>;
  /**
   * List the mailbox changes since a history id.
   *
   * Fails with {@link ../live/gmail/errors.HistoryExpiredError} — not a generic API failure — when Google no
   * longer holds history that far back, so a caller can recover by re-crawling rather than merely report.
   */
  readonly listHistory: (args: {
    startHistoryId: string;
    pageToken?: string | undefined;
  }) => Promise<Result<GmailHistoryPage, GmailError>>;
  /** Fetch one message. `metadata` returns headers and snippet only; `full` also carries the body tree. */
  readonly getMessage: (args: { id: string; format: "metadata" | "full" }) => Promise<Result<GmailMessage, GmailError>>;
  /**
   * Fetch every message in one thread. `metadata` is enough to read label state and deliberately does NOT
   * pull bodies — a label change has no business downloading mail it will not show anyone.
   */
  readonly getThread: (args: {
    id: string;
    format: "metadata" | "full";
  }) => Promise<Result<readonly GmailMessage[], GmailError>>;
  /** The mailbox's whole label vocabulary — the only way a display name becomes the id the API takes. */
  readonly listLabels: () => Promise<Result<readonly GmailLabel[], GmailError>>;
  /** Add and remove label ids on ONE message, returning it as Gmail reports it afterwards. */
  readonly modifyMessage: (args: {
    id: string;
    addLabelIds: readonly string[];
    removeLabelIds: readonly string[];
  }) => Promise<Result<GmailMessage, GmailError>>;
  /** Add and remove label ids on EVERY message in one thread. */
  readonly modifyThread: (args: {
    id: string;
    addLabelIds: readonly string[];
    removeLabelIds: readonly string[];
  }) => Promise<Result<readonly GmailMessage[], GmailError>>;
  /**
   * Store a composed message as a draft. Nothing is delivered — the message lands in the owner's own
   * Drafts, exactly where the same bytes typed into Gmail's compose window would land.
   */
  readonly createDraft: (args: {
    raw: string;
    threadId?: string | undefined;
    /** Make exactly one attempt: a board draft promises one draft per press, so a lost response is not retried. */
    once?: boolean | undefined;
  }) => Promise<Result<GmailDraft, GmailError>>;
  /** Fetch one draft with its full message, so a send can re-read what it is about to deliver. */
  readonly getDraft: (args: { id: string }) => Promise<Result<GmailDraft, GmailError>>;
  /**
   * SEND an existing draft. The one call in this seam that puts something in front of another person, and
   * the only one that is never retried — see {@link ./draftSeams.draftSeams}.
   */
  readonly sendDraft: (args: { id: string }) => Promise<Result<GmailMessage, GmailError>>;
  /**
   * Fetch ONE attachment's bytes, as Gmail returns them: base64url text plus Gmail's own byte count. The
   * `attachmentId` comes from a `full` read of the same message and is not stable across reads, so a caller
   * resolves it immediately before calling this and never stores it.
   */
  readonly getAttachment: (args: {
    messageId: string;
    attachmentId: string;
  }) => Promise<Result<GmailAttachmentBody, GmailError>>;
}

/**
 * One attachment body as `users.messages.attachments.get` returns it.
 *
 * @internal — the declared shape of {@link GmailApi.getAttachment}'s success value; no caller names it.
 */
export interface GmailAttachmentBody {
  /** The attachment's bytes, base64url-encoded. */
  readonly data: string;
  /** Gmail's own count of the DECODED bytes, when it reported one. */
  readonly size: number | undefined;
}

/** One draft: its own id, and the message it holds. */
export interface GmailDraft {
  readonly id: string;
  readonly message: GmailMessage;
}

/**
 * Map a boundary failure into this domain's own union at the point it is consumed, carrying the cause.
 *
 * Every seam below calls `safeProviderCall` DIRECTLY rather than through a shared helper. That is the
 * `boundary-residue` gate's requirement, not a style choice: it recognises a sanctioned boundary only when
 * the SDK call sits inside a `safeProviderCall(` — a wrapper one level up reads to it exactly like an
 * unwrapped call, which is the blindness it exists to prevent.
 */
function toGmailError({ error }: { error: IngestError }): GmailError {
  return GmailErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * Map a `history.list` failure, distinguishing an EXPIRED cursor from every other API failure.
 *
 * Google answers a `startHistoryId` older than the history it retains with a 404, and that single status is
 * the difference between "this run should stop" and "this run should re-crawl and re-anchor". Flattening it
 * into {@link GmailErrors.apiFailed} would leave the recovery undecidable at the one place that can act on
 * it, so the seam that knows the provider detail is where the distinction is made.
 *
 * @param error the typed boundary failure
 * @param startHistoryId the cursor the call was made from
 * @returns the expiry variant for a 404, else the generic API failure
 */
function historyError({ error, startHistoryId }: { error: IngestError; startHistoryId: string }): GmailError {
  return error.status === 404
    ? GmailErrors.historyExpired({ startHistoryId })
    : GmailErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * The seam is built as one builder PER GMAIL RESOURCE — `messages`, `threads`, `labels`, and the mailbox
 * itself — rather than as one function or as one builder per read/write direction.
 *
 * Two forces produced that shape, and both are worth stating because they will govern the next call added
 * here too. Every member must call `safeProviderCall` DIRECTLY, since the `boundary-residue` gate recognises
 * a sanctioned boundary only at that exact call site and reads a shared helper one level up as an unwrapped
 * call — so the members cannot be folded together and the single builder outgrew `max-function-lines` as the
 * seam widened. Resource is then the right axis to split on because it is how the API itself is shaped:
 * `messages.get` and `messages.modify` share a path, a rate class and every id convention, while
 * `messages.modify` and `threads.modify` share only a name.
 *
 * `listMessageIds` stands alone despite living under `messages`, because it shapes a PAGE rather than a
 * message — the id/threadId/cursor triple it lifts out is a different job from fetching or changing one.
 */
function listSeam({ client, scopeId }: { client: gmail_v1.Gmail; scopeId: string }): Pick<GmailApi, "listMessageIds"> {
  return {
    listMessageIds: async ({ query, labelIds, limit, pageToken }) =>
      safeProviderCall({
        execute: () =>
          client.users.messages.list({
            maxResults: limit,
            userId: "me",
            ...(labelIds.length > 0 ? { labelIds: [...labelIds] } : {}),
            ...(query !== undefined ? { q: query } : {}),
            ...(pageToken !== undefined ? { pageToken } : {}),
          }),
        operation: "gmail.users.messages.list",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .map((response): GmailIdPage => projectIdPage({ data: response.data }))
        .mapErr((error) => toGmailError({ error })),
  };
}

/**
 * The two seams over `users.messages` that address ONE message by id — read it, or change its labels.
 * See {@link listSeam} for why the seam is built in pieces at all.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the single-message part of the seam
 */
function messageSeams({
  client,
  scopeId,
}: {
  client: gmail_v1.Gmail;
  scopeId: string;
}): Pick<GmailApi, "getMessage" | "modifyMessage"> {
  return {
    getMessage: async ({ id, format }) =>
      safeProviderCall({
        execute: () =>
          client.users.messages.get({
            format,
            id,
            userId: "me",
            ...(format === "metadata" ? { metadataHeaders: [...LISTING_HEADERS] } : {}),
          }),
        operation: "gmail.users.messages.get",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .map((response): GmailMessage => response.data)
        .mapErr((error) => toGmailError({ error })),
    modifyMessage: async ({ id, addLabelIds, removeLabelIds }) =>
      safeProviderCall({
        execute: () =>
          client.users.messages.modify({
            id,
            requestBody: { addLabelIds: [...addLabelIds], removeLabelIds: [...removeLabelIds] },
            userId: "me",
          }),
        operation: "gmail.users.messages.modify",
        provider: "gmail",
        // `transient` on a WRITE, stated rather than inherited from the reads around it: `modify` is
        // idempotent in Gmail's own model — the same add/remove sets applied twice land in the same state —
        // so a retry cannot double-apply anything. That is a property of this call a reader should see
        // asserted next to it, not assume from its neighbours.
        retryMode: "transient",
        scopeId,
      })
        .map((response): GmailMessage => response.data)
        .mapErr((error) => toGmailError({ error })),
  };
}

/**
 * The seams over `users.threads` — the same two operations, addressed by conversation rather than message.
 * See {@link listSeam} for why the seam is built in pieces at all.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the thread part of the seam
 */
function threadSeams({
  client,
  scopeId,
}: {
  client: gmail_v1.Gmail;
  scopeId: string;
}): Pick<GmailApi, "getThread" | "modifyThread"> {
  return {
    getThread: async ({ id, format }) =>
      safeProviderCall({
        execute: () =>
          client.users.threads.get({
            format,
            id,
            userId: "me",
            ...(format === "metadata" ? { metadataHeaders: [...LISTING_HEADERS] } : {}),
          }),
        operation: "gmail.users.threads.get",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .mapErr((error) => toGmailError({ error }))
        .andThen((response) => fetchedThreadMessages({ data: response.data, threadId: id })),
    modifyThread: async ({ id, addLabelIds, removeLabelIds }) =>
      safeProviderCall({
        execute: () =>
          client.users.threads.modify({
            id,
            requestBody: { addLabelIds: [...addLabelIds], removeLabelIds: [...removeLabelIds] },
            userId: "me",
          }),
        operation: "gmail.users.threads.modify",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        // `threads.modify` returns the Thread resource, and whether it carries `messages` is not something
        // to rely on: an empty list here means "read back nothing", which the caller reports as unverified
        // residue rather than as a thread with no messages.
        .map((response): readonly GmailMessage[] => threadReadBack({ data: response.data }))
        .mapErr((error) => toGmailError({ error })),
  };
}

/**
 * The seam over `users.labels` — the mailbox's vocabulary, and the only way a name becomes an id.
 * See {@link listSeam} for why the seam is built in pieces at all.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the label part of the seam
 */
function labelSeams({ client, scopeId }: { client: gmail_v1.Gmail; scopeId: string }): Pick<GmailApi, "listLabels"> {
  return {
    listLabels: async () =>
      safeProviderCall({
        execute: () => client.users.labels.list({ userId: "me" }),
        operation: "gmail.users.labels.list",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .mapErr((error) => toGmailError({ error }))
        .andThen((response) => projectLabels({ data: response.data })),
  };
}

/**
 * The calls that ASK THE MAILBOX ABOUT ITSELF: its own state, and what has changed in it.
 * See {@link listSeam} for why the seam is built in pieces at all.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the mailbox-state part of the seam
 */
function mailboxSeams({
  client,
  scopeId,
}: {
  client: gmail_v1.Gmail;
  scopeId: string;
}): Pick<GmailApi, "getProfile" | "listHistory"> {
  return {
    getProfile: async () =>
      safeProviderCall({
        execute: () => client.users.getProfile({ userId: "me" }),
        operation: "gmail.users.getProfile",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .map((response): GmailMailboxProfile => projectProfile({ data: response.data }))
        .mapErr((error) => toGmailError({ error })),
    listHistory: async ({ startHistoryId, pageToken }) =>
      safeProviderCall({
        execute: () =>
          client.users.history.list({
            historyTypes: ["messageAdded"],
            startHistoryId,
            userId: "me",
            ...(pageToken !== undefined ? { pageToken } : {}),
          }),
        operation: "gmail.users.history.list",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .map((response): GmailHistoryPage => projectHistoryPage({ data: response.data }))
        .mapErr((error) => historyError({ error, startHistoryId })),
  };
}

/**
 * The seam over `users.messages.attachments` — its own Gmail resource, so its own builder (see
 * {@link listSeam}). A READ, so it retries like every other read here.
 *
 * A response with no `data` is refused rather than mapped to an empty string: an empty file written where an
 * attachment should be reads as a real, empty attachment.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the attachment part of the seam
 */
function attachmentSeams({
  client,
  scopeId,
}: {
  client: gmail_v1.Gmail;
  scopeId: string;
}): Pick<GmailApi, "getAttachment"> {
  return {
    getAttachment: async ({ messageId, attachmentId }) =>
      safeProviderCall({
        execute: () => client.users.messages.attachments.get({ id: attachmentId, messageId, userId: "me" }),
        operation: "gmail.users.messages.attachments.get",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .mapErr((error) => toGmailError({ error }))
        .andThen((response): Result<GmailAttachmentBody, GmailError> => {
          const { data, size } = response.data;
          if (typeof data !== "string") {
            return err(GmailErrors.apiFailed({ message: "Gmail returned an attachment with no data" }));
          }
          return ok({ data, size: typeof size === "number" ? size : undefined });
        }),
  };
}

/**
 * Build the production Gmail API seam over a bound SDK client.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param account the mailbox the grant bound to, hashed into the shared rate scope
 * @returns the seam every Gmail verb calls
 */
export function makeGmailApi({ client, account }: { client: gmail_v1.Gmail; account: string }): GmailApi {
  const scopeId = scopeIdForToken({ token: account });
  return {
    ...listSeam({ client, scopeId }),
    ...messageSeams({ client, scopeId }),
    ...threadSeams({ client, scopeId }),
    ...labelSeams({ client, scopeId }),
    ...mailboxSeams({ client, scopeId }),
    ...draftSeams({ client, scopeId }),
    ...attachmentSeams({ client, scopeId }),
  };
}
