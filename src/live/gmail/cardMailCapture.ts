/**
 * Fetch a card's pinned mail from Gmail and store it (`./cardMail.ts`) — the one place a card's mail is read from
 * Gmail. `gmail triage --key --pin` runs it BEFORE writing the pin; `gmail card-mail <slug> --fetch` runs it over a
 * pin that already stands.
 *
 * All or nothing: every selected message is fetched and shaped before anything is written, so a failure on the
 * seventh leaves no file holding six — and, on a re-fetch, leaves the previous file standing.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type GmailApi, makeGmailApi } from "./api.js";
import {
  type CardMailStore,
  type CardMailStoreError,
  cardMailSelection,
  type StoredCardMailGone,
  type StoredCardMailMessage,
  storedCardMailMessageOf,
  writeCardMailStore,
} from "./cardMail.js";
import {
  type CardMailBodySource,
  cardMailBodySources,
  decodeCardMailBody,
  MAX_CARD_MAIL_FETCHED_BODY_BYTES,
  type ResolvedCardMailAlternative,
} from "./cardMailBody.js";
import { resolveGmailClient } from "./client.js";
import type { GmailError } from "./errors.js";
import type { GmailTriageCard } from "./triageCards.js";

/** No Gmail grant carrying the read capability could be resolved, so nothing was read. */
interface CardMailClientUnavailableError {
  readonly code: "CARD_MAIL_CLIENT_UNAVAILABLE";
  readonly message: string;
  readonly cause: GmailError;
}

/** Gmail refused or failed one message's read. */
interface CardMailFetchFailedError {
  readonly code: "CARD_MAIL_FETCH_FAILED";
  readonly message: string;
  readonly id: string;
  readonly cause: GmailError;
}

/** Gmail answered a message with no id or thread id, so it cannot be drawn as the one pinned. */
interface CardMailMessageMalformedError {
  readonly code: "CARD_MAIL_MESSAGE_MALFORMED";
  readonly message: string;
  readonly id: string;
}

/** Every message was read, and writing them failed. */
interface CardMailStoreFailedError {
  readonly code: "CARD_MAIL_STORE_FAILED";
  readonly message: string;
  readonly cause: CardMailStoreError;
}

/** Every way capturing a card's mail fails. */
export type CardMailCaptureError =
  CardMailClientUnavailableError | CardMailFetchFailedError | CardMailMessageMalformedError | CardMailStoreFailedError;

/** How to raise one. */
export const CardMailCaptureErrors = {
  clientUnavailable: ({ cause }: { cause: GmailError }): CardMailClientUnavailableError => ({
    cause,
    code: "CARD_MAIL_CLIENT_UNAVAILABLE",
    message: `could not reach Gmail to read the pinned mail: ${cause.message}`,
  }),
  fetchFailed: ({ id, cause }: { id: string; cause: GmailError }): CardMailFetchFailedError => ({
    cause,
    code: "CARD_MAIL_FETCH_FAILED",
    id,
    message: `could not read pinned message ${id} from Gmail: ${cause.message}`,
  }),
  messageMalformed: ({ id }: { id: string }): CardMailMessageMalformedError => ({
    code: "CARD_MAIL_MESSAGE_MALFORMED",
    id,
    message: `Gmail answered pinned message ${id} with no id or thread id`,
  }),
  storeFailed: ({ cause }: { cause: CardMailStoreError }): CardMailStoreFailedError => ({
    cause,
    code: "CARD_MAIL_STORE_FAILED",
    message: cause.message,
  }),
} as const;

/**
 * Whether Gmail answered a read with a 404 — the message is gone, which no retry changes. Every other failure is
 * treated as one a re-run may clear, and fails the capture naming the id.
 */
function isNotFound({ error }: { error: GmailError }): boolean {
  if (error.code !== "API_FAILED" || typeof error.cause !== "object" || error.cause === null) {
    return false;
  }
  return "status" in error.cause && error.cause.status === 404;
}

/** One alternative's text: decoded inline, fetched from behind its attachment id, or declared too large to fetch. */
async function resolveAlternative({
  api,
  id,
  source,
}: {
  api: Pick<GmailApi, "getAttachment">;
  id: string;
  source: CardMailBodySource;
}): Promise<Result<ResolvedCardMailAlternative, CardMailCaptureError>> {
  if (source.kind === "absent") {
    return ok({ kind: "absent" });
  }
  if (source.kind === "inline") {
    return ok({ kind: "text", text: decodeCardMailBody({ data: source.data }) });
  }
  if (source.declaredBytes === undefined || source.declaredBytes > MAX_CARD_MAIL_FETCHED_BODY_BYTES) {
    return ok({ kind: "too-large" });
  }
  const fetched = await api.getAttachment({ attachmentId: source.attachmentId, messageId: id });
  if (fetched.isErr()) {
    return err(CardMailCaptureErrors.fetchFailed({ cause: fetched.error, id }));
  }
  return ok({ kind: "text", text: decodeCardMailBody({ data: fetched.value.data }) });
}

/** One pinned id read in full and shaped as the card stores it — gone on a 404, the failure on anything else. */
async function captureOne({
  api,
  id,
}: {
  api: Pick<GmailApi, "getAttachment" | "getMessage">;
  id: string;
}): Promise<Result<StoredCardMailMessage | StoredCardMailGone, CardMailCaptureError>> {
  const fetched = await api.getMessage({ format: "full", id });
  if (fetched.isErr()) {
    if (isNotFound({ error: fetched.error })) {
      return ok({ id, kind: "gone" });
    }
    return err(CardMailCaptureErrors.fetchFailed({ cause: fetched.error, id }));
  }
  const sources = cardMailBodySources({ message: fetched.value });
  const html = await resolveAlternative({ api, id, source: sources.html });
  if (html.isErr()) {
    return err(html.error);
  }
  const text = await resolveAlternative({ api, id, source: sources.text });
  if (text.isErr()) {
    return err(text.error);
  }
  const stored = storedCardMailMessageOf({ html: html.value, message: fetched.value, text: text.value });
  if (stored === undefined || stored.id !== id) {
    return err(CardMailCaptureErrors.messageMalformed({ id }));
  }
  return ok(stored);
}

/**
 * Fetch the pin's selected messages in full and store them, replacing any earlier snapshot for that card. A body Gmail
 * returns behind an attachment id is fetched too; a pinned id Gmail answers with a 404 is stored as gone.
 *
 * @param api the Gmail reader: each message in `full`, and a body Gmail keeps behind an attachment id
 * @param card the pin the snapshot is for — a pin already written, or the one about to be
 * @param home the state home
 * @param nowIso the clock the snapshot's own instant is read from
 * @returns the path and the snapshot written, or the first failure, with nothing written
 */
export async function captureCardMail({
  api,
  card,
  home,
  nowIso,
}: {
  api: Pick<GmailApi, "getAttachment" | "getMessage">;
  card: GmailTriageCard;
  home: string;
  nowIso: () => string;
}): Promise<Result<{ readonly path: string; readonly store: CardMailStore }, CardMailCaptureError>> {
  const mails: (StoredCardMailMessage | StoredCardMailGone)[] = [];
  for (const id of cardMailSelection({ pin: card })) {
    const captured = await captureOne({ api, id });
    if (captured.isErr()) {
      return err(captured.error);
    }
    mails.push(captured.value);
  }
  const store: CardMailStore = {
    key: card.key,
    mails,
    omittedCount: card.ids.length - mails.length,
    pinnedCount: card.ids.length,
    schemaVersion: 1,
    slug: card.slug,
    storedAtIso: nowIso(),
  };
  const written = writeCardMailStore({ home, store });
  if (written.isErr()) {
    return err(CardMailCaptureErrors.storeFailed({ cause: written.error }));
  }
  return ok({ path: written.value.path, store });
}

/**
 * {@link captureCardMail} through this home's Gmail grant, needing only the `read` capability — the production capture
 * both `gmail triage --pin` and `gmail card-mail --fetch` hand their runner. The grant is resolved here, at the moment
 * of capture, so a verb that never captures never reads a credential.
 *
 * @param card the pin the snapshot is for
 * @param home the state home the grant and the snapshot both live in
 * @returns the path and the snapshot written, or why nothing was
 */
export async function captureCardMailWithGrant({
  card,
  home,
}: {
  card: GmailTriageCard;
  home: string;
}): Promise<Result<{ readonly path: string; readonly store: CardMailStore }, CardMailCaptureError>> {
  const bound = resolveGmailClient({ capabilities: ["read"], home });
  if (bound.isErr()) {
    return err(CardMailCaptureErrors.clientUnavailable({ cause: bound.error }));
  }
  return captureCardMail({
    api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
    card,
    home,
    nowIso: () => new Date().toISOString(),
  });
}
