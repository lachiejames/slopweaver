import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { RECONNECT_MAX_MS } from "../../../../../live/listen/reconnect.js";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_AFTER_MS,
  heartbeatAgeMs,
  isHeartbeatStale,
  type ListenerHeartbeat,
  parseListenerHeartbeat,
  SOCKET_DOWN_AFTER_MS,
  socketStateAgeMs,
} from "../../../../../live/listen/supervise/heartbeat.js";

const AT = "2026-08-23T03:00:00.000Z";
const AT_MS = Date.parse(AT);

const beat = (over: Partial<ListenerHeartbeat> = {}): ListenerHeartbeat => ({
  armId: "arm-1",
  lastSocketEventAtIso: AT,
  pid: 4242,
  socketState: "connected",
  socketStateSinceIso: AT,
  writtenAtIso: AT,
  ...over,
});

describe("parseListenerHeartbeat", () => {
  it("accepts a whole, well-formed beat", () => {
    const parsed = parseListenerHeartbeat({ raw: JSON.parse(JSON.stringify(beat())) });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual(beat());
  });

  it("accepts a beat that has never seen a socket event", () => {
    const raw = { armId: "arm-1", pid: 1, socketState: "connecting", socketStateSinceIso: AT, writtenAtIso: AT };
    const parsed = parseListenerHeartbeat({ raw });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).lastSocketEventAtIso).toBe(undefined);
  });

  it("refuses a beat with no armId — an unattributable beat cannot prove which process wrote it", () => {
    const parsed = parseListenerHeartbeat({ raw: { pid: 1, socketState: "connected", writtenAtIso: AT } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("LISTENER_STATE_INVALID");
    expect(unwrapErr(parsed).message).toContain("armId");
  });

  it("refuses a socket state it does not know", () => {
    const parsed = parseListenerHeartbeat({ raw: { ...beat(), socketState: "sleepy" } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("socketState");
  });

  it("refuses a non-integer pid", () => {
    const parsed = parseListenerHeartbeat({ raw: { ...beat(), pid: 12.5 } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("pid");
  });

  it("refuses an unparseable writtenAtIso", () => {
    const parsed = parseListenerHeartbeat({ raw: { ...beat(), writtenAtIso: "yesterday" } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("writtenAtIso");
  });

  it("refuses a value that is not an object at all", () => {
    const parsed = parseListenerHeartbeat({ raw: "arm-1" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("heartbeat");
  });
});

describe("heartbeatAgeMs", () => {
  it("measures the beat's age against the supplied clock", () => {
    expect(heartbeatAgeMs({ heartbeat: beat(), nowMs: AT_MS + 7_000 })).toBe(7_000);
  });

  it("goes negative for a beat stamped in the future rather than clamping", () => {
    expect(heartbeatAgeMs({ heartbeat: beat(), nowMs: AT_MS - 3_000 })).toBe(-3_000);
  });
});

describe("isHeartbeatStale", () => {
  it("is fresh one interval after the beat", () => {
    expect(isHeartbeatStale({ heartbeat: beat(), nowMs: AT_MS + HEARTBEAT_INTERVAL_MS })).toBe(false);
  });

  it("is fresh exactly AT the tolerance — the boundary is not stale", () => {
    expect(isHeartbeatStale({ heartbeat: beat(), nowMs: AT_MS + HEARTBEAT_STALE_AFTER_MS })).toBe(false);
  });

  it("is stale one millisecond past the tolerance", () => {
    expect(isHeartbeatStale({ heartbeat: beat(), nowMs: AT_MS + HEARTBEAT_STALE_AFTER_MS + 1 })).toBe(true);
  });

  it("honours a caller-supplied tolerance over the default", () => {
    expect(isHeartbeatStale({ heartbeat: beat(), nowMs: AT_MS + 5_000, staleAfterMs: 1_000 })).toBe(true);
  });

  it("treats a future-stamped beat as fresh, so clock skew never re-arms a live listener", () => {
    expect(isHeartbeatStale({ heartbeat: beat(), nowMs: AT_MS - 600_000 })).toBe(false);
  });

  it("tolerates four missed beats and no more", () => {
    expect(HEARTBEAT_STALE_AFTER_MS).toBe(HEARTBEAT_INTERVAL_MS * 4);
  });
});

describe("socketStateAgeMs", () => {
  it("measures from when the socket ENTERED its state, not from when the beat was written", () => {
    const heartbeat = beat({ socketStateSinceIso: "2026-08-23T02:59:00.000Z", writtenAtIso: AT });
    expect(socketStateAgeMs({ heartbeat, nowMs: AT_MS })).toBe(60_000);
  });

  it("is zero when the state was entered at this instant", () => {
    expect(socketStateAgeMs({ heartbeat: beat(), nowMs: AT_MS })).toBe(0);
  });
});

describe("parseListenerHeartbeat's socketStateSinceIso", () => {
  it("refuses a beat with no socketStateSinceIso — without it, a backoff cannot be told from a dead socket", () => {
    const raw = { armId: "a", pid: 1, socketState: "connected", writtenAtIso: AT };
    const parsed = parseListenerHeartbeat({ raw });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("socketStateSinceIso");
  });
});

describe("SOCKET_DOWN_AFTER_MS", () => {
  it("clears the longest legitimate reconnect backoff with room to spare", () => {
    expect(SOCKET_DOWN_AFTER_MS).toBeGreaterThan(RECONNECT_MAX_MS);
  });
});
