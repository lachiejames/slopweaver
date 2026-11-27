/**
 * The cmux control socket's wire format, as pure functions.
 *
 * Measured live against cmux 0.64.22 (`CMUX_SOCKET_PATH`, a Unix stream socket): the protocol is
 * newline-delimited JSON in both directions. A request is `{"id":"…","method":"…","params":{…}}`; a reply is
 * `{"ok":true,"id":"…","result":…}` or `{"ok":false,"id":"…","error":{"code":"…","message":"…"}}`. A frame
 * missing `method` is rejected by cmux itself with `invalid_request: Missing method`, which is how the
 * alternative `{"command":…,"args":…}` shape was ruled out — it is not accepted on this socket at all.
 *
 * `cmux capabilities` lists the method set; an unknown one answers `method_not_found`. None of that is in
 * cmux's published CLI contract, which documents the CLI's user-visible behaviour and explicitly not the
 * wire format — so everything here is empirical, and `docs/cmux-client/socket-and-measured-facts.md` records
 * how to re-verify it.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";

/** The exact cmux error message that means "this surface is still settling", lower-cased for comparison. */
const TERMINAL_TEXT_UNREADABLE_NEEDLE = "failed to read terminal text";

/** The word cmux's own CLI writes before a capability token, ahead of the JSON request on the same line. */
const CAPABILITY_PREFIX = "_cmux_capability_v1";

/**
 * Encode one request as a wire frame.
 *
 * A `capability` is presented the way cmux's bundled CLI presents it — captured off a fake socket on
 * a capability line: `_cmux_capability_v1 <token> {"params":…,"method":…,"id":…}`, on every frame. Under the
 * default `cmuxOnly` access mode that token is the ONLY way in for a process cmux did not start: one that
 * outlived its launcher (the console's `next dev`, reparented to launchd by `scripts/docs-site.sh --start`)
 * is otherwise answered `ERROR: Access denied - only processes started inside cmux can connect` and closed.
 * Measured the same day: a double-forked node process (ppid 1) had `system.ping` and `workspace.list`
 * answered with the prefix, and got the access-denied line without it. `docs/cmux-client/socket-and-measured-facts.md` § 1 has the repro.
 *
 * @param id the correlation id echoed back on the reply
 * @param method the v2 socket method to call
 * @param params the method's parameters
 * @param capability the `CMUX_SOCKET_CAPABILITY` token to present, or `undefined` to present none
 * @returns the newline-terminated frame to write
 */
export function encodeRequest({
  id,
  method,
  params,
  capability,
}: {
  id: string;
  method: string;
  params: Readonly<Record<string, unknown>>;
  capability?: string | undefined;
}): string {
  const json = JSON.stringify({ id, method, params });
  if (capability === undefined) {
    return `${json}\n`;
  }
  return `${CAPABILITY_PREFIX} ${capability} ${json}\n`;
}

/**
 * The refusal cmux writes as a bare text line before it closes a connection it will not serve, or
 * `undefined` for any other frame.
 *
 * It is not JSON and carries no id, so without this the transport dropped it as an unmatched reply and
 * reported only "the connection closed" — what five voice relays recorded while the real
 * reason was the access mode.
 *
 * The words become an error message, so the capability this connection presented is redacted out of them:
 * cmux does not echo it today, and a message is the one place the token must never reach if it ever did.
 *
 * @param line one complete frame, without its trailing newline
 * @param capability the token this connection presented, redacted wherever it appears
 * @returns cmux's own words with `ERROR:` stripped, or `undefined`
 */
export function socketRefusalOf({
  line,
  capability,
}: {
  line: string;
  capability: string | undefined;
}): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("ERROR:")) {
    return undefined;
  }
  return redactCapability({ capability, text: trimmed.slice("ERROR:".length).trim() });
}

/**
 * A frame's text with the capability this connection presented replaced wherever it appears. Every frame passes
 * through this before it is parsed, so a token cmux ever echoed in an error message or a result never reaches a
 * delivery record, a log line or a caller.
 *
 * A JSON frame is decoded, redacted string by string and re-encoded, because a raw-text match misses a token
 * written with JSON escapes (`v1.abc`) that the parse then rebuilds. Re-encoding also
 * writes every escape out, so what a caller logs carries no escaped form of it either. A frame that is not JSON — a
 * bare `ERROR:` refusal — is matched as text.
 *
 * @param text what cmux sent
 * @param capability the token this connection presented, or `undefined` when it presented none
 * @returns the frame, the token replaced by `<capability>`
 */
export function redactCapability({ capability, text }: { capability: string | undefined; text: string }): string {
  if (capability === undefined || capability.length === 0) {
    return text;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return text.replaceAll(capability, "<capability>");
  }
  return JSON.stringify(redactDecoded({ capability, value: decoded }));
}

/** Every string inside a decoded frame, keys included, with the capability replaced. */
function redactDecoded({ capability, value }: { capability: string; value: unknown }): unknown {
  if (typeof value === "string") {
    return value.replaceAll(capability, "<capability>");
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactDecoded({ capability, value: item }));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(capability, "<capability>"),
        redactDecoded({ capability, value: item }),
      ]),
    );
  }
  return value;
}

/**
 * cmux's `cmuxOnly` refusal, exactly as it words it — measured twice, the second time when a
 * console restarted from outside cmux had four voice relays answered with it
 * (`slopweaver talk log --json | jq '.rows[].delivery.detail'`).
 */
const ACCESS_DENIED_REFUSAL = "Access denied - only processes started inside cmux can connect";

/**
 * The typed error a refusal line becomes: `access-denied` when it is cmux's `cmuxOnly` refusal word for word, which
 * no reconnect can change, else a transport failure carrying cmux's words. A boundary is the one place a provider's
 * wording is read, so nothing above it matches the sentence.
 *
 * @param refusal cmux's own words, as {@link socketRefusalOf} returned them
 * @param socketPath the socket that refused
 * @returns the error every pending call fails with
 */
export function refusalError({ refusal, socketPath }: { refusal: string; socketPath: string | undefined }): CmuxError {
  if (refusal === ACCESS_DENIED_REFUSAL) {
    return CmuxErrors.accessDenied({ refusal, socketPath });
  }
  return CmuxErrors.socketUnavailable({ detail: `cmux refused the connection: ${refusal}`, socketPath });
}

/**
 * Split an accumulated read buffer into whole frames plus whatever tail is still incomplete.
 *
 * Kept pure and separate from the socket itself because a stream chunk boundary lands wherever the kernel
 * puts it: a single `data` event routinely carries half a frame, and `workspace.list`'s reply is large
 * enough that this is the normal case rather than an edge one.
 *
 * @param buffer everything read so far and not yet consumed
 * @returns the complete frames in order, and the unconsumed remainder
 */
export function splitFrames({ buffer }: { buffer: string }): {
  readonly frames: readonly string[];
  readonly remainder: string;
} {
  const parts = buffer.split("\n");
  // `String.split` never returns an empty array, so `pop()` always has a value here — asserted rather than
  // coalesced, because a silent `""` would mean "nothing left over" for a case that cannot arise.
  const remainder = parts.pop()!;
  return { frames: parts.filter((line) => line.trim().length > 0), remainder };
}

/**
 * Classify one cmux error frame into this domain's typed union.
 *
 * The `TERMINAL_TEXT_UNREADABLE` decision reads cmux's own English message, and that is deliberate: a
 * boundary is the ONE place a provider's wording may be inspected, precisely so that no caller above it ever
 * has to. Every consumer branches on `error.code`.
 *
 * @param method the method that was called
 * @param cmuxCode the `error.code` cmux returned
 * @param message the `error.message` cmux returned
 * @param retryAfterMs the frame's `error.data.retry_after_ms`, when it carried a usable one
 * @returns the typed error
 */
export function classifyCallError({
  method,
  cmuxCode,
  message,
  retryAfterMs,
}: {
  method: string;
  cmuxCode: string;
  message: string;
  retryAfterMs?: number | undefined;
}): CmuxError {
  if (message.toLowerCase().includes(TERMINAL_TEXT_UNREADABLE_NEEDLE)) {
    return CmuxErrors.terminalTextUnreadable({ detail: message, method });
  }
  if (cmuxCode === "rate_limited") {
    return CmuxErrors.rateLimited({ message, method, retryAfterMs });
  }
  return CmuxErrors.callFailed({ cmuxCode, message, method });
}

/**
 * The `retry_after_ms` an error frame's `data` carries, only as a non-negative whole number of milliseconds:
 * anything else is no hint at all, never a guessed delay.
 */
function retryAfterOf({ error }: { error: Readonly<Record<string, unknown>> }): number | undefined {
  const data = error["data"];
  if (!isRecord(data)) {
    return undefined;
  }
  const hint = data["retry_after_ms"];
  if (typeof hint !== "number" || !Number.isSafeInteger(hint) || hint < 0) {
    return undefined;
  }
  return hint;
}

/** Pull `{code, message}` and any retry hint out of a reply's `error` field, defaulting both when cmux sends something odd. */
function errorFields({ value }: { value: unknown }): {
  readonly cmuxCode: string;
  readonly message: string;
  readonly retryAfterMs: number | undefined;
} {
  if (!isRecord(value)) {
    return { cmuxCode: "unknown", message: "cmux reported a failure with no error object", retryAfterMs: undefined };
  }
  return {
    cmuxCode: typeof value["code"] === "string" ? value["code"] : "unknown",
    message: typeof value["message"] === "string" ? value["message"] : "cmux reported a failure with no message",
    retryAfterMs: retryAfterOf({ error: value }),
  };
}

/**
 * Decode one reply frame into its `result` value, or this domain's typed error.
 *
 * @param method the method this frame is a reply to, carried for the error text
 * @param line one complete frame, without its trailing newline
 * @returns the decoded `result`, or the typed failure
 */
export function parseReplyFrame({ method, line }: { method: string; line: string }): Result<unknown, CmuxError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(CmuxErrors.malformedReply({ detail: "the reply frame was not JSON", method }));
  }
  if (!isRecord(decoded)) {
    return err(CmuxErrors.malformedReply({ detail: "the reply frame was not a JSON object", method }));
  }
  if (decoded["ok"] === false) {
    return err(classifyCallError({ method, ...errorFields({ value: decoded["error"] }) }));
  }
  if (!("result" in decoded)) {
    return err(CmuxErrors.malformedReply({ detail: "the reply carried no `result` field", method }));
  }
  return ok(decoded["result"]);
}
