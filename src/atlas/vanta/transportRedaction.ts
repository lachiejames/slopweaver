/**
 * What a failing Vanta request may say about itself: the secrets it sent, a failing body as the log sees it, and
 * a thrown error as a published reason sees it. Split out of `transport.ts`, whose concern is sending; this
 * module's is that nothing the request carried, nor anything the provider reflected back, reaches a line.
 */
import { headerValue } from "./retryBackoff.js";
import type { VantaRequestInit } from "./transport.js";

/** The failure classes a fetch or body read throws, the only ones a withheld cause names. */
const KNOWN_FAILURE_KINDS: ReadonlySet<string> = new Set([
  "AbortError",
  "Error",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
]);

/**
 * The cause a failure may carry. A thrown error's message is text this code did not author and it reaches a
 * published reason, so for a request that sent declared credentials only the error's class survives — the same
 * reasoning that withholds such a request's failing body from the log. Even the class is named only from
 * {@link KNOWN_FAILURE_KINDS}: `Error.name` is a writable string, so a thrower could set it to anything.
 *
 * @param withholdBody whether the request declared credentials in its own body
 * @returns the error itself, or a fresh one naming only a known class
 */
export function publishableCause({ error, withholdBody }: { error: unknown; withholdBody: boolean }): unknown {
  if (!withholdBody) {
    return error;
  }
  const kind = error instanceof Error && KNOWN_FAILURE_KINDS.has(error.name) ? error.name : "Error";
  return new Error(`${kind} (message withheld: this request sent declared credentials)`);
}

/**
 * What one request's failure lines may carry: its path with every secret it sent replaced, those secrets for a
 * failing body's redaction, and whether it declared credentials in its body, which withholds that body whole.
 *
 * @param requestInit the request about to be sent
 * @returns the redacted path, the secrets, and whether a failing body is withheld
 */
export function requestRedaction({
  requestInit,
}: {
  requestInit: Pick<VantaRequestInit, "headers" | "path" | "sensitiveValues">;
}): { safePath: string; secrets: readonly string[]; withholdBody: boolean } {
  const declared = declaredValues({ requestInit });
  const secrets = secretsSentInRequest({ headers: requestInit.headers, sensitiveValues: declared });
  return { safePath: redactSecrets({ secrets, text: requestInit.path }), secrets, withholdBody: declared.length > 0 };
}

/** The values a request declared its body carries; a request declaring none, by design, carries none. */
function declaredValues({
  requestInit,
}: {
  requestInit: Pick<VantaRequestInit, "sensitiveValues">;
}): readonly string[] {
  if (requestInit.sensitiveValues === undefined) {
    return [];
  }
  return requestInit.sensitiveValues;
}

/**
 * Every secret value this specific request sent, so a response body that reflects one back can be
 * redacted before it reaches anywhere this transport's callers persist or print an error.
 */
function secretsSentInRequest({
  headers,
  sensitiveValues,
}: {
  headers: Readonly<Record<string, string>>;
  sensitiveValues: readonly string[];
}): readonly string[] {
  const secrets = new Set<string>();
  const authorization = headerValue({ headers, name: "authorization" });
  if (authorization !== null && authorization.trim() !== "") {
    secrets.add(authorization);
    secrets.add(authorization.replace(/^bearer\s+/i, ""));
  }
  for (const secret of sensitiveValues.filter((value) => value.trim() !== "")) {
    secrets.add(secret);
  }
  return [...secrets].filter((secret) => secret.length > 0);
}

/**
 * How much of a failing body reaches the LOG. Unchanged from what used to reach the published reason, so
 * this is a move rather than a widening; the credentials this process sent are still replaced first.
 */
const DIAGNOSTIC_BODY_CHARS = 400;

/**
 * A failing body as the log line carries it. For a request that declared credentials in its own body, the body
 * is never logged at all: a reflection of one may come back in any encoding JSON or a form allows (`\/`,
 * `a`, `%2f`, `+`), and an exact-text redactor cannot enumerate them all. Otherwise it is redacted WHOLE
 * before it is cut, since a secret straddling the cut would no longer match whole.
 *
 * @param body the response body as read off the wire
 * @param secrets every secret this request sent
 * @param withholdBody whether the request declared credentials in its own body
 * @returns the text the log line carries in the body's place
 */
export function diagnosticBodyText({
  body,
  secrets,
  withholdBody,
}: {
  body: string;
  secrets: readonly string[];
  withholdBody: boolean;
}): string {
  if (withholdBody) {
    return `[body withheld: ${String(body.length)} chars — this request sent declared credentials, which a reflection could carry in any encoding]`;
  }
  return redactSecrets({ secrets, text: body.trim() }).slice(0, DIAGNOSTIC_BODY_CHARS);
}

/** Replace every occurrence of a known-sent secret with a fixed marker, never the secret's own length. */
function redactSecrets({ text, secrets }: { text: string; secrets: readonly string[] }): string {
  return secrets.reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), text);
}
