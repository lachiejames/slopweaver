/**
 * The Knock door's one way to the network: a GET, to `api.knock.app`, on one of five message paths, each bound to
 * its operation, with only the query keys that operation is read with. Nothing else is expressible here.
 *
 * Read-only doors for investigations: Knock mints no read-only key — a
 * secret key can make any request — so this module IS the read-only wall: the method is a TYPE with one member, a
 * URL is refused before any call and again at the send when its route does not match its operation, and the
 * message routes that write (`/read`, `/seen`, `/archived`, …) or return content (`/content`) are not on the
 * list. Knock's official SDK is deliberately not used: it puts `workflows.trigger`, a notification to a person,
 * one method call from the read (`docs/provider-sdks.md` § "An SDK that widens what a caller can do").
 *
 * A path here can carry a person's Knock user id, so a failure NEVER quotes the URL or a native error's words:
 * it is fixed prose naming the operation and, when Knock answered, its HTTP status.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { KnockCredential } from "./credential.js";
import { type KnockReadError, KnockReadErrors } from "./errors.js";

/** The only HTTP method this door sends. A second member here is the read-only ask broken. */
type KnockHttpMethod = "GET";

/** The API origin. The key goes nowhere else. */
const KNOCK_API_ORIGIN = "https://api.knock.app";

/** How long one GET may take before it fails, so a stalled response cannot hang an investigation. */
const KNOCK_REQUEST_TIMEOUT_MS = 30_000;

/** The five reads, named as the operation labels `src/lib/operationEndpointClass.ts` paces them by. */
export type KnockOperation =
  | "knock.messages.list"
  | "knock.users.messages.list"
  | "knock.message.read"
  | "knock.message.events.list"
  | "knock.message.deliveryLogs.list";

/** Paging keys every list sends. */
const PAGING_KEYS = ["after", "before", "page_size"] as const;

/** The investigation filters the two message lists send — the closed list describes what this door sends. */
const MESSAGE_FILTER_KEYS = [
  "channel_id",
  "status",
  "source",
  "tenant",
  "workflow_run_id",
  "workflow_recipient_run_id",
  "inserted_at.gte",
  "inserted_at.lte",
] as const;

/** One query key some operation admits. */
export type KnockQueryKey = (typeof PAGING_KEYS)[number] | (typeof MESSAGE_FILTER_KEYS)[number];

/** Each operation's admitted query keys. */
const ADMITTED: Readonly<Record<KnockOperation, readonly string[]>> = {
  "knock.message.deliveryLogs.list": PAGING_KEYS,
  "knock.message.events.list": PAGING_KEYS,
  "knock.message.read": [],
  "knock.messages.list": [...PAGING_KEYS, ...MESSAGE_FILTER_KEYS],
  "knock.users.messages.list": [...PAGING_KEYS, ...MESSAGE_FILTER_KEYS],
};

/** Each id-bearing operation's route, with its one id segment as `{id}`. */
const EXPECTED_SHAPE: Readonly<Record<Exclude<KnockOperation, "knock.messages.list">, string>> = {
  "knock.message.deliveryLogs.list": "messages/{id}/delivery_logs",
  "knock.message.events.list": "messages/{id}/events",
  "knock.message.read": "messages/{id}",
  "knock.users.messages.list": "users/{id}/messages",
};

/** The longest id this door puts in a path. Knock publishes no grammar; this only bounds a pasted mistake. */
const MAX_ID_LENGTH = 256;

/**
 * Whether a value is safe as ONE path segment: non-empty, bounded, no delimiter, escape, whitespace or control
 * character, not a dot segment — and, for a message id, not `batch`, the one literal sibling route.
 *
 * Knock publishes no id grammar, so this refuses only what could change which route a URL names.
 *
 * @param value the id
 * @returns `true` when it can only ever name one resource
 */
export function isSafeKnockId({ value }: { value: string }): boolean {
  if (value.length === 0 || value.length > MAX_ID_LENGTH || value === "." || value === ".." || value === "batch") {
    return false;
  }
  return /^[\x21-\x7E]+$/.test(value) && !/[/\\?#%]/.test(value);
}

/** One request this door can build: the operation, its ids, and its query pairs in send order. */
export interface KnockRequest {
  readonly operation: KnockOperation;
  /** Required by the three single-message operations; refused on the others. */
  readonly messageId: string | null;
  /** Required by `knock.users.messages.list`; refused on the others. */
  readonly userId: string | null;
  /** Pairs, so a repeated key (`status`) is sent repeated, never as `status[]`. */
  readonly query: readonly (readonly [KnockQueryKey, string])[];
}

/**
 * The path an operation's ids build.
 *
 * @param request the operation and its ids
 * @returns the path, or the refusal naming the operation
 */
function pathFor({ request }: { request: KnockRequest }): Result<string, KnockReadError> {
  const { operation, messageId, userId } = request;
  if (operation === "knock.messages.list") {
    if (messageId !== null || userId !== null) {
      return err(KnockReadErrors.urlRefused({ operation, why: "the environment list takes no id" }));
    }
    return ok("/v1/messages");
  }
  if (operation === "knock.users.messages.list") {
    if (messageId !== null || userId === null || !isSafeKnockId({ value: userId })) {
      return err(KnockReadErrors.urlRefused({ operation, why: "it takes one user id with no path character in it" }));
    }
    return ok(`/v1/users/${encodeURIComponent(userId)}/messages`);
  }
  if (userId !== null || messageId === null || !isSafeKnockId({ value: messageId })) {
    return err(KnockReadErrors.urlRefused({ operation, why: "it takes one message id with no path character in it" }));
  }
  const base = `/v1/messages/${encodeURIComponent(messageId)}`;
  if (operation === "knock.message.events.list") {
    return ok(`${base}/events`);
  }
  if (operation === "knock.message.deliveryLogs.list") {
    return ok(`${base}/delivery_logs`);
  }
  return ok(base);
}

/**
 * One path segment decoded, or `null` when it is not a well-formed escape.
 *
 * @param segment the raw segment
 * @returns the decoded text, or `null`
 */
function decodedSegment({ segment }: { segment: string | undefined }): string | null {
  if (segment === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Whether a URL is one this door could have built for `operation`: Knock's origin with no credentials or
 * fragment, the operation's own route shape, and only its admitted query keys.
 *
 * @param url the URL about to carry the key
 * @param operation the operation it is sent under
 * @returns `true` only for a URL on the closed call list
 * @internal
 */
export function isClosedKnockUrl({ url, operation }: { url: URL; operation: KnockOperation }): boolean {
  if (url.origin !== KNOCK_API_ORIGIN || url.username !== "" || url.password !== "" || url.hash !== "") {
    return false;
  }
  const admitted = ADMITTED[operation];
  if (![...url.searchParams.keys()].every((name) => admitted.includes(name))) {
    return false;
  }
  if (operation === "knock.messages.list") {
    return url.pathname === "/v1/messages";
  }
  // `["", "v1", <collection>, <id>, <tail>?]` — the id segment decoded and held to the same rule the builder applies,
  // and its raw spelling held to the one encoding the builder writes, so `%41` for `A` is refused rather than sent.
  const segments = url.pathname.split("/");
  const id = decodedSegment({ segment: segments[3] });
  if (segments[0] !== "" || segments[1] !== "v1" || id === null || !isSafeKnockId({ value: id })) {
    return false;
  }
  if (segments[3] !== encodeURIComponent(id)) {
    return false;
  }
  const shape = segments
    .slice(2)
    .map((segment, index) => (index === 1 ? "{id}" : segment))
    .join("/");
  return shape === EXPECTED_SHAPE[operation];
}

/**
 * Build a request's URL, refusing anything off the closed call list.
 *
 * @param request the operation, its ids and its query pairs
 * @returns the URL, or `URL_REFUSED` naming the operation only
 */
export function buildKnockUrl({ request }: { request: KnockRequest }): Result<URL, KnockReadError> {
  const path = pathFor({ request });
  if (path.isErr()) {
    return err(path.error);
  }
  const url = new URL(path.value, KNOCK_API_ORIGIN);
  for (const [name, value] of request.query) {
    url.searchParams.append(name, value);
  }
  if (!isClosedKnockUrl({ operation: request.operation, url })) {
    return err(
      KnockReadErrors.urlRefused({ operation: request.operation, why: "the URL leaves the closed call list" }),
    );
  }
  return ok(url);
}

/**
 * The read seam every read is written against: production is {@link knockGet} bound to the key, a test passes a
 * plain function answering canned bodies. It answers the body's TEXT; the read parses it next to the endpoint's
 * strict boundary.
 */
export type KnockGet = (request: { operation: KnockOperation; url: URL }) => Promise<Result<string, KnockReadError>>;

/** A non-2xx, carried in the shape `toIngestError` reads a status and a `retry-after` off. Its words name no URL. */
class KnockHttpStatusError extends Error {
  readonly status: number;
  readonly response: { readonly status: number; readonly headers: Readonly<Record<string, string>> };

  /**
   * @param status the HTTP status Knock answered
   * @param headers its response headers, lower-cased by `fetch`
   */
  constructor({ status, headers }: { status: number; headers: Readonly<Record<string, string>> }) {
    super(`Knock answered ${String(status)}`);
    this.status = status;
    this.response = { headers, status };
  }
}

/**
 * Send ONE GET through the paced provider door, with the key as a bearer token.
 *
 * @param credential the resolved key
 * @param operation the operation the URL was built for, which is also its rate class's label
 * @param url a URL {@link buildKnockUrl} built — refused here otherwise
 * @param scopeId the shared rate scope, already hashed from the key
 * @returns the body's text, for a strict boundary to read, or why it failed in fixed words
 */
export async function knockGet({
  credential,
  operation,
  url,
  scopeId,
}: {
  credential: KnockCredential;
  operation: KnockOperation;
  url: URL;
  scopeId: string;
}): Promise<Result<string, KnockReadError>> {
  // Checked again HERE, at the send, so a URL from anywhere but this module never carries the key. The check and
  // the fetch read one immutable string: the caller's `URL` is mutable, and the paced door awaits in between.
  const target = url.href;
  if (!isClosedKnockUrl({ operation, url: new URL(target) })) {
    return err(KnockReadErrors.urlRefused({ operation, why: "the URL is not one the closed call list builds" }));
  }
  const method: KnockHttpMethod = "GET";
  const answered = await safeProviderCall({
    execute: async () => {
      // `redirect: "error"`: a 3xx would be Knock sending the key somewhere this door never chose.
      const response = await fetch(target, {
        headers: { accept: "application/json", authorization: `Bearer ${credential.apiKey}` },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(KNOCK_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new KnockHttpStatusError({
          headers: Object.fromEntries(response.headers.entries()),
          status: response.status,
        });
      }
      return response.text();
    },
    maxAttempts: 1,
    operation,
    provider: "knock",
    retryMode: "transient",
    scopeId,
  });
  if (answered.isErr()) {
    return err(
      KnockReadErrors.transportFailed({
        operation,
        status: unsetFieldAsNull({ key: "status", record: answered.error }),
      }),
    );
  }
  return ok(answered.value);
}
