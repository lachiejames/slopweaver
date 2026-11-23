import { describe, expect, it } from "vitest";

import {
  eventFingerprint,
  readTrackEvent,
  trackEventAttributes,
  trackInstant,
  trackString,
} from "../../../../datadog/census/event.js";

/** One log event, exactly as the unified track's envelope returns it. */
function logEvent(): unknown {
  return {
    "datadog.index": "main",
    event: {
      __dd: { log_identity: { fingerprinting_algorithm_version: "3", raw_msg_fingerprint: "9fe6556d87b8" } },
      custom: { "http.status_code": 200, level: 30, requestId: "9e0c" },
      discovery_timestamp: 1_789_511_871_000,
      host: "localhost",
      ingest_size_in_bytes: 812,
      message: "[sessionTypeForBooking] booking 4821 absent",
      random_draw: 0.5,
      service: "core-api",
      status: "info",
      tags: ["env:production", "service:core-api"],
      tiebreaker: 12,
      timestamp: "2026-09-15T22:45:55.874Z",
    },
    event_id: "AwAAAaCn",
  };
}

describe("trackEventAttributes — custom attributes take the @ sigil, reserved ones stay bare", () => {
  it("prefixes every custom attribute with @, which is the spelling a Datadog query uses", () => {
    const attributes = trackEventAttributes({ event: (logEvent() as { event: unknown }).event });
    expect(attributes["@http.status_code"]).toBe(200);
    expect(attributes["@level"]).toBe(30);
  });

  it("leaves a reserved attribute bare, because a query spells it without a sigil", () => {
    const attributes = trackEventAttributes({ event: (logEvent() as { event: unknown }).event });
    expect(attributes["service"]).toBe("core-api");
    expect(attributes["status"]).toBe("info");
  });

  it("drops the ingest bookkeeping that differs on every single event", () => {
    const attributes = trackEventAttributes({ event: (logEvent() as { event: unknown }).event });
    expect(Object.keys(attributes).toSorted()).toEqual([
      "@http.status_code",
      "@level",
      "@requestId",
      "host",
      "message",
      "service",
      "status",
      "tags",
      "timestamp",
    ]);
  });

  it("answers an empty tree for an event that is not an object at all", () => {
    expect(trackEventAttributes({ event: "not an event" })).toEqual({});
  });
});

describe("eventFingerprint — the one field read out of the dropped __dd tree", () => {
  it("reads the pattern fingerprint a logs row is keyed on", () => {
    expect(eventFingerprint({ event: (logEvent() as { event: unknown }).event })).toBe("9fe6556d87b8");
  });

  it("answers nothing on a track that carries no fingerprint", () => {
    expect(eventFingerprint({ event: { service: "jobs-api" } })).toBeNull();
  });
});

describe("trackString / trackInstant", () => {
  it("answers nothing rather than an empty string for an absent field", () => {
    expect(trackString({ attributes: { service: "" }, path: "service" })).toBeNull();
  });

  it("places an undated event at the window's own far edge, said out loud rather than coalesced", () => {
    expect(trackInstant({ attributes: {}, fallbackIso: "2026-09-15T23:00:00.000Z" })).toBe("2026-09-15T23:00:00.000Z");
  });

  it("uses the event's own timestamp when it carries one", () => {
    expect(
      trackInstant({ attributes: { timestamp: "2026-09-15T22:45:55.874Z" }, fallbackIso: "2026-09-16T00:00:00.000Z" }),
    ).toBe("2026-09-15T22:45:55.874Z");
  });
});

describe("readTrackEvent", () => {
  it("unwraps the envelope, keeping the message and the fingerprint", () => {
    const read = readTrackEvent({ fallbackIso: "2026-09-16T00:00:00.000Z", raw: logEvent() })!;
    expect(read.fingerprint).toBe("9fe6556d87b8");
    expect(read.event.message).toBe("[sessionTypeForBooking] booking 4821 absent");
    expect(read.event.occurredAtIso).toBe("2026-09-15T22:45:55.874Z");
  });

  it("answers nothing for an element carrying no inner event, rather than an empty one", () => {
    expect(readTrackEvent({ fallbackIso: "2026-09-16T00:00:00.000Z", raw: { event_id: "x" } })).toBeNull();
  });
});
