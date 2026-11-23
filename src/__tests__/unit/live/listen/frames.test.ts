/**
 * Socket Mode's frame grammar. The load-bearing case is the last one in the `events_api` block: the dedupe
 * id comes from `payload.event_id`, never from the envelope, which is fresh on every redelivery.
 */
import { describe, expect, it } from "vitest";

import { parseSocketFrame } from "../../../../live/listen/frames.js";

/** A well-formed `events_api` frame carrying an `app_mention`. */
function eventsApi(over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    envelope_id: "e-1",
    payload: {
      event: { channel: "C1", text: "<@U0BOT> hi", ts: "1.1", type: "app_mention", user: "U1" },
      event_id: "Ev123",
      type: "event_callback",
    },
    type: "events_api",
    ...over,
  });
}

describe("parseSocketFrame", () => {
  it("reads the hello frame and the connection count", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ num_connections: 2, type: "hello" }) })).toEqual({
      connections: 2,
      kind: "hello",
    });
  });

  it("reads a hello with no connection count", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ type: "hello" }) })).toEqual({
      connections: undefined,
      kind: "hello",
    });
  });

  it("reads a disconnect and its reason", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ reason: "warning", type: "disconnect" }) })).toEqual({
      kind: "disconnect",
      reason: "warning",
    });
  });

  it("says a disconnect reason was unstated rather than inventing one", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ type: "disconnect" }) })).toEqual({
      kind: "disconnect",
      reason: "unstated",
    });
  });

  it("reads an events_api frame, taking the dedupe id from the PAYLOAD and the ack id from the envelope", () => {
    const frame = parseSocketFrame({ text: eventsApi() });

    expect(frame).toEqual({
      envelopeId: "e-1",
      event: { channel: "C1", text: "<@U0BOT> hi", ts: "1.1", type: "app_mention", user: "U1" },
      eventId: "Ev123",
      eventType: "app_mention",
      kind: "event",
      retryAttempt: 0,
      retryReason: undefined,
    });
  });

  it("reads a redelivery's attempt count and reason", () => {
    const frame = parseSocketFrame({ text: eventsApi({ retry_attempt: 2, retry_reason: "timeout" }) });

    expect(frame).toEqual({
      envelopeId: "e-1",
      event: { channel: "C1", text: "<@U0BOT> hi", ts: "1.1", type: "app_mention", user: "U1" },
      eventId: "Ev123",
      eventType: "app_mention",
      kind: "event",
      retryAttempt: 2,
      retryReason: "timeout",
    });
  });

  it("ignores a frame type this listener does not subscribe to, by name", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ type: "slash_commands" }) })).toEqual({
      frameType: "slash_commands",
      kind: "ignored",
    });
  });

  it("refuses an events_api frame with no envelope_id, because it could never be acknowledged", () => {
    expect(parseSocketFrame({ text: eventsApi({ envelope_id: undefined }) })).toEqual({
      kind: "unreadable",
      why: "an events_api frame carried no envelope_id, so it could not be acknowledged",
    });
  });

  it("refuses an events_api frame with no payload", () => {
    expect(parseSocketFrame({ text: eventsApi({ payload: undefined }) })).toEqual({
      kind: "unreadable",
      why: "an events_api frame carried no payload object",
    });
  });

  it("refuses a payload with no event", () => {
    expect(parseSocketFrame({ text: eventsApi({ payload: { event_id: "Ev1" } }) })).toEqual({
      kind: "unreadable",
      why: "an events_api payload carried no event object",
    });
  });

  it("refuses an event with no type", () => {
    expect(parseSocketFrame({ text: eventsApi({ payload: { event: { channel: "C1" } } }) })).toEqual({
      kind: "unreadable",
      why: "an events_api event carried no type",
    });
  });

  it("reads a missing event_id as undefined rather than failing the frame", () => {
    const frame = parseSocketFrame({
      text: eventsApi({ payload: { event: { channel: "C1", ts: "1.1", type: "app_mention", user: "U1" } } }),
    });

    expect(frame).toEqual({
      envelopeId: "e-1",
      event: { channel: "C1", ts: "1.1", type: "app_mention", user: "U1" },
      eventId: undefined,
      eventType: "app_mention",
      kind: "event",
      retryAttempt: 0,
      retryReason: undefined,
    });
  });

  it("never throws on a frame that is not JSON", () => {
    expect(parseSocketFrame({ text: "not json at all" })).toEqual({
      kind: "unreadable",
      why: "the frame was not JSON",
    });
  });

  it("refuses a JSON value that is not an object", () => {
    expect(parseSocketFrame({ text: "[1,2,3]" })).toEqual({
      kind: "unreadable",
      why: "the frame was not a JSON object",
    });
  });

  it("refuses a frame with no type", () => {
    expect(parseSocketFrame({ text: JSON.stringify({ envelope_id: "e-1" }) })).toEqual({
      kind: "unreadable",
      why: "the frame carried no type",
    });
  });
});
