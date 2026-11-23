/**
 * Socket Mode's wire frames, read into a typed union. PURE — no socket, no clock, no token.
 *
 * Socket Mode delivers newline-free JSON text frames over one websocket, and only four shapes matter to a
 * tag-driven listener:
 *
 *  - `hello` — the connection is live. Carries `num_connections`, which is how a second listener running by
 *    accident becomes visible instead of silently stealing half the events.
 *  - `events_api` — an event, wrapped in an ENVELOPE that must be acknowledged by `envelope_id` within
 *    Slack's window. The event itself sits at `payload.event`, and the stable id Slack redelivers under sits
 *    at `payload.event_id` — NOT on the envelope, which is fresh per delivery. It names the EVENT, not the
 *    message: dedupe keys on the message (`./dedupe.ts`), and the event id is what the drop line prints.
 *  - `disconnect` — Slack is about to close this socket and says why FIRST. A listener that treats this as
 *    an error rather than a routine rotation spends its whole backoff budget on normal operation.
 *  - anything else (`slash_commands`, `interactive`) — ignored by name, not by silence: this listener answers
 *    tags only, and a frame it did not expect is a fact worth printing.
 *
 * A frame this module cannot read becomes an `unreadable` value carrying WHY, never a throw and never a
 * silent skip. The shell prints it and carries on, because one malformed frame must not end a listener.
 */
import { isRecord } from "../../lib/parsers.js";

/** One event delivery: the envelope to acknowledge, the event's own id, and the raw event to parse. */
export interface SocketEventFrame {
  readonly kind: "event";
  /** The per-DELIVERY id Slack expects echoed back. Never a dedupe key — a redelivery carries a fresh one. */
  readonly envelopeId: string;
  /**
   * `payload.event_id` — stable across redeliveries of one event, but one message can carry two of them, so it
   * is a diagnostic and never the dedupe key. Absent on a malformed body.
   */
  readonly eventId: string | undefined;
  /** `payload.event.type`, e.g. `app_mention`. */
  readonly eventType: string;
  /** How many times Slack has redelivered this event (0 on the first). */
  readonly retryAttempt: number;
  /** Slack's stated reason for a redelivery, when it gave one. */
  readonly retryReason: string | undefined;
  /** The raw event object, handed to the pure mention parser. */
  readonly event: Readonly<Record<string, unknown>>;
}

/** Every frame shape this listener distinguishes. */
export type SocketFrame =
  | { readonly kind: "hello"; readonly connections: number | undefined }
  | { readonly kind: "disconnect"; readonly reason: string }
  | SocketEventFrame
  | { readonly kind: "ignored"; readonly frameType: string }
  | { readonly kind: "unreadable"; readonly why: string };

/** A non-empty string field, or undefined. */
function stringField({ from, key }: { from: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = from[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A finite number field, or undefined. */
function numberField({ from, key }: { from: Readonly<Record<string, unknown>>; key: string }): number | undefined {
  const value = from[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A nested object field, or undefined. */
function recordField({
  from,
  key,
}: {
  from: Readonly<Record<string, unknown>>;
  key: string;
}): Readonly<Record<string, unknown>> | undefined {
  const value = from[key];
  return isRecord(value) ? value : undefined;
}

/** How many times Slack has redelivered an event: a first delivery omits `retry_attempt` entirely, so 0. */
function retryAttemptOf({ frame }: { frame: Readonly<Record<string, unknown>> }): number {
  const attempt = numberField({ from: frame, key: "retry_attempt" });
  if (attempt === undefined) {
    return 0;
  }
  return attempt;
}

/**
 * Why Slack is closing the socket. `reason` is documented but not guaranteed, and naming the gap as
 * `unstated` beats coalescing it into a real reason.
 */
function disconnectReason({ frame }: { frame: Readonly<Record<string, unknown>> }): string {
  const reason = stringField({ from: frame, key: "reason" });
  if (reason === undefined) {
    return "unstated";
  }
  return reason;
}

/** Read an `events_api` frame, or say exactly which required part of it was missing. */
function eventFrame({ frame }: { frame: Readonly<Record<string, unknown>> }): SocketFrame {
  const envelopeId = stringField({ from: frame, key: "envelope_id" });
  if (envelopeId === undefined) {
    return { kind: "unreadable", why: "an events_api frame carried no envelope_id, so it could not be acknowledged" };
  }
  const payload = recordField({ from: frame, key: "payload" });
  if (payload === undefined) {
    return { kind: "unreadable", why: "an events_api frame carried no payload object" };
  }
  const event = recordField({ from: payload, key: "event" });
  if (event === undefined) {
    return { kind: "unreadable", why: "an events_api payload carried no event object" };
  }
  const eventType = stringField({ from: event, key: "type" });
  if (eventType === undefined) {
    return { kind: "unreadable", why: "an events_api event carried no type" };
  }
  return {
    envelopeId,
    event,
    eventId: stringField({ from: payload, key: "event_id" }),
    eventType,
    kind: "event",
    retryAttempt: retryAttemptOf({ frame }),
    retryReason: stringField({ from: frame, key: "retry_reason" }),
  };
}

/**
 * Read one Socket Mode text frame into a typed value. Total — every input yields a frame, and an
 * unreadable one carries the reason rather than throwing.
 *
 * @param text the raw text frame off the websocket
 * @returns the typed frame
 */
export function parseSocketFrame({ text }: { text: string }): SocketFrame {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    return { kind: "unreadable", why: "the frame was not JSON" };
  }
  if (!isRecord(decoded)) {
    return { kind: "unreadable", why: "the frame was not a JSON object" };
  }
  const frameType = stringField({ from: decoded, key: "type" });
  if (frameType === undefined) {
    return { kind: "unreadable", why: "the frame carried no type" };
  }
  if (frameType === "hello") {
    return { connections: numberField({ from: decoded, key: "num_connections" }), kind: "hello" };
  }
  if (frameType === "disconnect") {
    return { kind: "disconnect", reason: disconnectReason({ frame: decoded }) };
  }
  return frameType === "events_api" ? eventFrame({ frame: decoded }) : { frameType, kind: "ignored" };
}
