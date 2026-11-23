/**
 * The `fetch` the Gmail SDK client's auth transport sends through (`./client.ts`'s `resolveGmailClient` installs it
 * before `gmail(...)` is built), and the only place a Gmail request can be stopped after the SDK has finished building
 * it.
 *
 * ## Why the transport, and not the seam's methods
 *
 * By the time gaxios calls `fetch` it has serialised the JSON body, so what is judged here is what is sent. Every
 * route the client reaches crosses it — a label change, a draft, a send, and any endpoint added later — so a new
 * write is guarded by construction rather than by somebody remembering a call. A request that is not Gmail's (the
 * OAuth refresh, a Google Docs read on the same grant) and every measured Gmail read go straight through and never
 * load the policy. A write runs its two refusals (`../../outbound/gmail/writePrivacy.ts`'s `refuseGmailWrite`: the
 * dead Datadog host first, then the privacy check) before the underlying `fetch`.
 *
 * ## A send is judged on the draft Gmail holds
 *
 * `drafts.send` carries only a draft id, and the draft may have been edited in Gmail since it was composed or
 * approved. So immediately before the send this re-reads it with `format=raw`, over the same underlying transport and
 * the same authorisation, and judges that message. A re-read that fails, answers no `raw`, or carries a message that
 * cannot be parsed sends nothing. The residue is the instant between that read and the send: Gmail offers no
 * conditional send, so an edit landing in it goes out unjudged.
 *
 * ## Both JSON reads are strict boundaries
 *
 * The send body and the re-read's answer are each read through a strict schema of the pinned SDK's own
 * `Schema$Draft` and `Schema$Message` (`@googleapis/gmail`), every field declared and only `id` and `raw` trusted. A
 * field Gmail adds, renames or retypes refuses the send by name rather than being read as absent. `payload` is not
 * declared: a `format=raw` answer carries none, so one arriving is itself a drift and refuses.
 */
import { z } from "zod";

import { defineBoundary } from "../../lib/boundary.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GmailWritePrivacy, refuseGmailWrite } from "../../outbound/gmail/writePrivacy.js";
import {
  type GmailWriteRequest,
  gmailJsonBody,
  gmailRequestCommand,
  gmailUnreadableWriteRequest,
  gmailWriteRequest,
  isGmailApiRequest,
  isGmailDraftSend,
  isGmailReadRequest,
} from "../../outbound/gmail/writePrivacyPayload.js";
import { type GmailGuardError, GmailGuardErrors } from "./guardedFetchErrors.js";

/** The `fetch` gaxios calls, exactly the platform's. */
export type GmailFetch = typeof fetch;

/** A declared SDK field the guard never reads. */
const unread = z.unknown().optional();

/** A string the SDK types `string | null`, optional. */
const text = z.string().nullable().optional();

/** `Schema$Message`, every field the pinned SDK declares; `payload` excepted, as the file header says. */
const messageWire = z.strictObject({
  classificationLabelValues: unread,
  historyId: unread,
  id: unread,
  internalDate: unread,
  labelIds: unread,
  raw: text,
  sizeEstimate: unread,
  snippet: unread,
  threadId: unread,
});

/** What `users.drafts.send` carries: a `Schema$Draft` naming the draft by id. */
const DRAFT_SEND_BODY = defineBoundary({
  endpoint: "POST gmail users.drafts.send (request body)",
  schema: z.strictObject({ id: z.string(), message: messageWire.optional() }),
});

/** What `users.drafts.get` answers under `format=raw`: a `Schema$Draft` whose message carries `raw`. */
const DRAFT_RAW_READ = defineBoundary({
  endpoint: "GET gmail users.drafts.get format=raw",
  schema: z.strictObject({ id: text, message: messageWire.optional() }),
});

/** One request as the guard reads it, before deciding whether it is a Gmail write. */
interface SentRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Result<string | undefined, GmailGuardError>;
}

/**
 * Bytes as strict UTF-8, or why they are not. A lenient decode would judge U+FFFD in place of a malformed byte and
 * then send the original bytes, so what was judged would not be what was sent.
 */
function strictUtf8({ bytes }: { bytes: ArrayBuffer | ArrayBufferView }): Result<string, GmailGuardError> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return err(GmailGuardErrors.bodyNotUtf8());
  }
}

/** A body as text, or why the guard cannot read it without consuming what is about to be sent. */
async function bodyText({
  body,
}: {
  body: BodyInit | null | undefined;
}): Promise<Result<string | undefined, GmailGuardError>> {
  if (body === undefined || body === null) {
    return ok(undefined);
  }
  if (typeof body === "string") {
    return ok(body);
  }
  if (body instanceof URLSearchParams) {
    return ok(body.toString());
  }
  if (body instanceof Blob) {
    return strictUtf8({ bytes: await body.arrayBuffer() });
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return strictUtf8({ bytes: body });
  }
  return err(GmailGuardErrors.bodyStreamed());
}

/** The URL, method, headers and body of one call, or undefined for an address that does not parse. */
async function sentRequest({
  input,
  init,
}: {
  input: Parameters<GmailFetch>[0];
  init: Parameters<GmailFetch>[1];
}): Promise<SentRequest | undefined> {
  if (input instanceof Request) {
    let body = init?.body;
    if (body === undefined) {
      body = await input.clone().arrayBuffer();
    }
    return {
      body: await bodyText({ body }),
      headers: new Headers(input.headers),
      method: methodOf({ init, request: input }),
      url: new URL(input.url),
    };
  }
  if (!URL.canParse(input)) {
    return undefined;
  }
  return {
    body: await bodyText({ body: init?.body }),
    headers: new Headers(init?.headers),
    method: methodOf({ init, request: undefined }),
    url: new URL(input),
  };
}

/** The method one call sends: its init's, else its Request's own, else `GET`, which is fetch's own default. */
function methodOf({ init, request }: { init: Parameters<GmailFetch>[1]; request: Request | undefined }): string {
  if (init?.method !== undefined) {
    return init.method;
  }
  if (request !== undefined) {
    return request.method;
  }
  return "GET";
}

/** The draft id a `drafts.send` body names, or why it names none. */
function draftIdOf({ body }: { body: string | undefined }): Result<string, GmailGuardError> {
  if (body === undefined) {
    return err(GmailGuardErrors.sendWithoutDraftId({ reason: "the send carried no body" }));
  }
  return DRAFT_SEND_BODY.parseJson({ text: body })
    .map((draft) => draft.id)
    .mapErr((refused) => GmailGuardErrors.sendWithoutDraftId({ reason: refused.message }));
}

/** The `raw` a `drafts.get` answer carries, or why it carries none. */
function rawOf({ text: answer }: { text: string }): Result<string, GmailGuardError> {
  const draft = DRAFT_RAW_READ.parseJson({ text: answer });
  if (draft.isErr()) {
    return err(GmailGuardErrors.draftReReadMalformed({ reason: draft.error.message }));
  }
  const raw = draft.value.message?.raw;
  if (typeof raw !== "string") {
    return err(GmailGuardErrors.draftWithoutRaw());
  }
  return ok(raw);
}

/**
 * Re-read the draft a send names, `format=raw`, over the underlying transport with the send's own authorisation.
 *
 * @param fetch the underlying transport, never the guarded one
 * @param sent the send as the guard read it
 * @param signal the send's own abort signal, so a timeout covers the re-read too
 * @returns the draft's raw message, or why it could not be read — either way before anything is sent
 */
async function reReadDraft({
  fetch,
  sent,
  signal,
}: {
  fetch: GmailFetch;
  sent: SentRequest;
  signal: AbortSignal | null | undefined;
}): Promise<Result<string, GmailGuardError>> {
  const body = sent.body.isOk() ? sent.body.value : undefined;
  const id = draftIdOf({ body });
  if (id.isErr()) {
    return err(id.error);
  }
  const target = new URL(sent.url.href);
  target.pathname = sent.url.pathname.replace(/\/send$/u, `/${encodeURIComponent(id.value)}`);
  target.search = "?format=raw";
  const headers = new Headers(sent.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  try {
    const response = await fetch(target, { headers, method: "GET", ...(signal == null ? {} : { signal }) });
    if (!response.ok) {
      return err(GmailGuardErrors.draftReReadRefused({ status: response.status }));
    }
    return rawOf({ text: await response.text() });
  } catch (error: unknown) {
    return err(GmailGuardErrors.draftReReadFailed({ cause: error }));
  }
}

/**
 * The draft a send delivers when its body names only an id; undefined for any other write, and for a send carrying
 * its own `message.raw`, which is judged as sent.
 */
async function draftToSend({
  fetch,
  sent,
  signal,
}: {
  fetch: GmailFetch;
  sent: SentRequest;
  signal: AbortSignal | null | undefined;
}): Promise<Result<string, GmailGuardError> | undefined> {
  if (!isGmailDraftSend({ method: sent.method, url: sent.url }) || sent.body.isErr()) {
    return undefined;
  }
  const command = gmailRequestCommand({ method: sent.method, url: sent.url });
  const json = gmailJsonBody({ body: sent.body.value, command });
  if (json.isOk() && json.value.raws.length > 0) {
    return undefined;
  }
  return reReadDraft({ fetch, sent, signal });
}

/**
 * Wrap a `fetch` so every Gmail request that is not one of the door's measured reads is refused before it is sent
 * when it carries a dead Datadog console host or fails the outbound privacy check.
 *
 * @param fetch the underlying transport — the late-bound global in production, a counting function in a test
 * @param privacy the capability built from the verb's own home, its policy loaded afresh on every write
 * @returns the `fetch` the Gmail auth client's transport is given
 */
export function guardedGmailFetch({ fetch, privacy }: { fetch: GmailFetch; privacy: GmailWritePrivacy }): GmailFetch {
  const guarded: GmailFetch = async (input, init) => {
    const sent = await sentRequest({ init, input });
    if (sent === undefined || !isGmailApiRequest({ url: sent.url })) {
      return fetch(input, init);
    }
    if (isGmailReadRequest({ method: sent.method, url: sent.url })) {
      return fetch(input, init);
    }
    const signal = init?.signal;
    const draft = await draftToSend({ fetch, sent, signal });
    const { method, url } = sent;
    const request: GmailWriteRequest = sent.body.isErr()
      ? gmailUnreadableWriteRequest({ method, reason: sent.body.error.message, url })
      : await gmailWriteRequest({ body: sent.body.value, draft, method, url });
    await refuseGmailWrite({ privacy, request });
    return fetch(input, init);
  };
  return guarded;
}
