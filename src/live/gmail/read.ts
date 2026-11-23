/**
 * The two Gmail READ document builders — `gmail list` and `gmail read` — shaped exactly like every other
 * named-object reader in `src/live`: a bounded read, a `readAtIso`, and a coverage block that says what the
 * read did NOT establish.
 *
 * ## Residue is the point, not decoration
 *
 * A mailbox is the one source where "here is what I found" reads most convincingly as "here is everything".
 * It is never everything: Gmail's `resultSizeEstimate` is an estimate it says so itself, a listing is one
 * page of a cursor, a thread read is the messages the grant can see rather than every message ever in it,
 * and an attachment is reported by metadata with its bytes deliberately left on Google's servers. Each of
 * those becomes a residue line, so a caller that renders the document cannot accidentally present a page as
 * a total — the `probeScopeDetail` lesson from `src/connect/types.ts`, applied to the read lane.
 *
 * Effectful only through the injected {@link GmailApi} and the injected clock, so both builders are unit
 * tested against plain fakes.
 */
import { stripQuotedTail } from "../../corpus/gmail/quoted.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import type { GmailApi } from "./api.js";
import type { GmailError } from "./errors.js";
import type { GmailLabel } from "./labels.js";
import { type GmailMessage, getHeader, type ParsedGmailMessage, parseGmailMessage } from "./parse.js";
import { messageResidue, readThreadId } from "./readReport.js";
import { type GmailUnsubscribeKind, unsubscribeKindOf } from "./triageKey.js";

/** The largest page `gmail list` will ask Gmail for in one call. */
export const MAX_LIST_LIMIT = 100;

/** The default page size when the caller names none. */
export const DEFAULT_LIST_LIMIT = 25;

/**
 * What one listing line carries — everything a triage decision needs, and no body. The four optional
 * fields mirror {@link ParsedGmailMessage}'s: an absent header is `undefined` rather than an invented
 * empty string, and the renderer is where a stand-in like `(no subject)` belongs.
 */
export interface GmailListingEntry {
  readonly id: string;
  readonly threadId: string;
  readonly sentAtIso: string | undefined;
  readonly from: string | undefined;
  readonly subject: string | undefined;
  readonly snippet: string | undefined;
  readonly labelIds: readonly string[];
  readonly unread: boolean;
  readonly hasAttachments: boolean;
}

/** The payload of a `gmail list` document. */
interface GmailListing {
  readonly account: string;
  readonly query: string | undefined;
  readonly labelIds: readonly string[];
  readonly entries: readonly GmailListingEntry[];
  /** Gmail's own estimate of how many match the query — an ESTIMATE, never a count of what was read. */
  readonly resultSizeEstimate: number | undefined;
  /** Whether Gmail said more messages match than this one page read. */
  readonly more: boolean;
}

/** A listing read: the shared document AND the typed payload, so a caller never re-narrows `data`. */
export interface GmailListingResult {
  readonly document: ProviderReadDocument;
  readonly listing: GmailListing;
}

/**
 * What one message's own headers offer as a way out, verbatim beside the kind `gmail triage` would read off them.
 * Carried on a READ rather than on {@link ParsedGmailMessage}, which the corpus lane also builds and never needs it:
 * "can I unsubscribe from this without a sign-in" is a question about one live message.
 */
export interface GmailReadUnsubscribe {
  readonly kind: GmailUnsubscribeKind;
  /** The `List-Unsubscribe` value as the sender wrote it, when it wrote one. */
  readonly listUnsubscribe: string | undefined;
  /** The `List-Unsubscribe-Post` value, RFC 8058's one-click promise, when present. */
  readonly listUnsubscribePost: string | undefined;
}

/**
 * A message as `gmail read` reports it: the parsed message, plus its way out, plus what its sender AUTHORED.
 *
 * `authored` is the body above its quoted history and signature ({@link stripQuotedTail}), so a reader drawing a
 * thread shows each message once rather than every earlier one again beneath it; `body` stays whole beside it.
 */
export type GmailReadMessage = ParsedGmailMessage & {
  readonly unsubscribe: GmailReadUnsubscribe;
  readonly authored: string;
  /** How many characters of `body` the quoted tail held — zero when nothing was cut. */
  readonly quotedCharsDropped: number;
};

/** The payload of a `gmail read` document. */
interface GmailReadPayload {
  readonly account: string;
  readonly threadId: string;
  readonly messages: readonly GmailReadMessage[];
  /** Messages Gmail answered that carried no id or thread id, so are not in `messages` — a partial read when above zero. */
  readonly unreadMessages: number;
}

/** Parse one fetched message and lift its unsubscribe pair; undefined when it carries no addressable identity. */
function toReadMessage({ message }: { message: GmailMessage }): GmailReadMessage | undefined {
  const parsed = parseGmailMessage({ message });
  if (parsed === undefined) {
    return undefined;
  }
  const headers = message.payload?.headers;
  const listUnsubscribe = getHeader({ headers, name: "List-Unsubscribe" });
  const listUnsubscribePost = getHeader({ headers, name: "List-Unsubscribe-Post" });
  const stripped = stripQuotedTail({ body: parsed.body });
  return {
    ...parsed,
    authored: stripped.text,
    quotedCharsDropped: stripped.droppedChars,
    unsubscribe: {
      kind: unsubscribeKindOf({ listUnsubscribe, listUnsubscribePost }),
      listUnsubscribe,
      listUnsubscribePost,
    },
  };
}

/** Reduce a parsed message to a listing line. */
function toEntry({ message }: { message: ParsedGmailMessage }): GmailListingEntry {
  return {
    from: message.from,
    hasAttachments: message.attachments.length > 0,
    id: message.id,
    labelIds: message.labelIds,
    sentAtIso: message.sentAtIso,
    snippet: message.snippet,
    subject: message.subject,
    threadId: message.threadId,
    unread: message.labelIds.includes("UNREAD"),
  };
}

/** The residue lines a listing always owes its reader. */
function listingResidue({
  page,
  read,
}: {
  page: { nextPageToken: string | undefined; resultSizeEstimate: number | undefined };
  read: number;
}): readonly string[] {
  const residue: string[] = [];
  if (page.nextPageToken !== undefined) {
    residue.push(`more messages match — this is one page of ${String(read)}, not the whole result`);
  }
  if (page.resultSizeEstimate !== undefined) {
    residue.push(
      `Gmail ESTIMATES ${String(page.resultSizeEstimate)} matching message(s); that is the provider's own ` +
        "estimate of the query, not a count of what was read here",
    );
  }
  residue.push("bodies and attachments are not read by a listing — use `gmail read <id>` for one message");
  return residue;
}

/**
 * What a listing document names as its address. A listing given no query searches the whole mailbox — the
 * call sends no `q` at all — so the address says that rather than naming no search.
 */
function listingAddress({ query }: { query: string | undefined }): string {
  if (query === undefined) {
    return "(whole mailbox)";
  }
  return query;
}

/**
 * List the messages matching a query, newest first as Gmail returns them.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param query a Gmail search expression, or undefined for the whole mailbox
 * @param labelIds label ids to restrict the search to
 * @param limit how many messages to read, capped at {@link MAX_LIST_LIMIT}
 * @param nowIso the read timestamp source
 * @returns the listing document and its typed payload, or the typed reason the read failed
 */
export async function readGmailListing({
  api,
  account,
  query,
  labelIds,
  limit,
  nowIso,
}: {
  api: GmailApi;
  account: string;
  query: string | undefined;
  labelIds: readonly string[];
  limit: number;
  nowIso: () => string;
}): Promise<Result<GmailListingResult, GmailError>> {
  const page = await api.listMessageIds({ labelIds, limit: Math.min(limit, MAX_LIST_LIMIT), query });
  if (page.isErr()) {
    return err(page.error);
  }
  const entries: GmailListingEntry[] = [];
  for (const id of page.value.ids) {
    const message = await api.getMessage({ format: "metadata", id });
    if (message.isErr()) {
      return err(message.error);
    }
    const parsed = parseGmailMessage({ message: message.value });
    if (parsed !== undefined) {
      entries.push(toEntry({ message: parsed }));
    }
  }
  const data: GmailListing = {
    account,
    entries,
    labelIds,
    more: page.value.nextPageToken !== undefined,
    query,
    resultSizeEstimate: page.value.resultSizeEstimate,
  };
  return ok({
    document: {
      coverage: {
        detail: `${String(entries.length)} message(s) read as metadata only, capped at ${String(limit)}`,
        kind: "bounded",
        residue: listingResidue({ page: page.value, read: entries.length }),
      },
      data,
      readAtIso: nowIso(),
      source: "gmail",
      target: {
        address: listingAddress({ query }),
        identity: account,
        kind: labelIds.length > 0 ? `search in ${labelIds.join(",")}` : "search",
      },
    },
    listing: data,
  });
}

/** A message or thread read: the shared document AND the typed payload. */
export interface GmailMessageResult {
  readonly document: ProviderReadDocument;
  readonly payload: GmailReadPayload;
}

/**
 * Every message of the thread `address` names — a thread id, or the id of any one message in it.
 *
 * A board row names the message it was born from as often as its thread, and Gmail answers a message id handed
 * to `threads.get` as not found. So a thread read that fails tries the address as a message and reads THAT
 * message's thread; when no message carries the address either, the thread read's own failure is the answer.
 *
 * @returns the thread's messages, or the thread read's failure
 */
async function threadMessages({
  api,
  address,
}: {
  api: GmailApi;
  address: string;
}): Promise<Result<readonly GmailMessage[], GmailError>> {
  const direct = await api.getThread({ format: "full", id: address });
  if (direct.isOk()) {
    return direct;
  }
  const message = await api.getMessage({ format: "metadata", id: address });
  if (message.isErr()) {
    return direct;
  }
  const threadId = message.value.threadId;
  if (typeof threadId !== "string" || threadId === address) {
    return direct;
  }
  return api.getThread({ format: "full", id: threadId });
}

/**
 * Read one message, or every message in one thread.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param address the message id, or with `thread` the thread id or the id of any message in it
 * @param thread whether to read the whole thread rather than the single message
 * @param nowIso the read timestamp source
 * @returns the read document and its typed payload, or the typed reason the read failed
 */
export async function readGmailMessage({
  api,
  account,
  address,
  thread,
  nowIso,
}: {
  api: GmailApi;
  account: string;
  address: string;
  thread: boolean;
  nowIso: () => string;
}): Promise<Result<GmailMessageResult, GmailError>> {
  const fetched = thread
    ? await threadMessages({ address, api })
    : (await api.getMessage({ format: "full", id: address })).map((message) => [message]);
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const messages = fetched.value
    .map((message) => toReadMessage({ message }))
    .filter((message): message is GmailReadMessage => message !== undefined);
  const unreadMessages = fetched.value.length - messages.length;
  const data: GmailReadPayload = { account, messages, threadId: readThreadId({ address, messages }), unreadMessages };
  return ok({
    document: {
      coverage: {
        detail: thread
          ? `${String(messages.length)} message(s) in the thread, each read in full`
          : "one message, read in full",
        kind: "bounded",
        residue: [
          ...messageResidue({ messages }),
          ...(unreadMessages > 0
            ? [`${String(unreadMessages)} message(s) Gmail answered carried no id or thread id and are not shown`]
            : []),
          ...(thread ? [] : ["this is ONE message — its thread may hold others; re-read with --thread"]),
        ],
      },
      data,
      readAtIso: nowIso(),
      source: "gmail",
      target: { address, identity: account, kind: thread ? "thread" : "message" },
    },
    payload: data,
  });
}

/** The payload of a `gmail labels` document. */
interface GmailLabelVocabulary {
  readonly account: string;
  readonly labels: readonly GmailLabel[];
}

/** A label read: the shared document AND the typed payload. */
export interface GmailLabelsResult {
  readonly document: ProviderReadDocument;
  readonly vocabulary: GmailLabelVocabulary;
}

/**
 * Read the mailbox's whole label vocabulary — the id/name pairs every mutation verb resolves against.
 *
 * This exists because Gmail's API takes label IDS and its interface shows label NAMES, and a person asked to
 * supply one while looking at the other guesses. `gmail label --add "Waiting on"` resolves the name for
 * them; this verb is how they see what names there are to write.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param nowIso the read timestamp source
 * @returns the label document and its typed payload, or the typed reason the read failed
 */
export async function readGmailLabels({
  api,
  account,
  nowIso,
}: {
  api: GmailApi;
  account: string;
  nowIso: () => string;
}): Promise<Result<GmailLabelsResult, GmailError>> {
  const labels = await api.listLabels();
  if (labels.isErr()) {
    return err(labels.error);
  }
  const data: GmailLabelVocabulary = { account, labels: labels.value };
  return ok({
    document: {
      coverage: {
        detail: `${String(labels.value.length)} label(s) — the mailbox's complete vocabulary`,
        // `users.labels.list` does not page — this really is every label in one call. The shared coverage
        // type has one value and it is `bounded`, so completeness is stated in `detail` rather than by
        // widening a contract every provider read shares for the sake of one verb.
        kind: "bounded",
        residue: [
          "a label's message counts are not read here — this is the vocabulary, not how much is filed under it",
        ],
      },
      data,
      readAtIso: nowIso(),
      source: "gmail",
      target: { address: "labels", identity: account, kind: "labels" },
    },
    vocabulary: data,
  });
}
