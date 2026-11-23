import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  HEARTBEAT_GRACE_MS,
  HEARTBEAT_STALE_AFTER_MS,
  type ListenerHeartbeat,
  SOCKET_DOWN_AFTER_MS,
} from "../../../../../live/listen/supervise/heartbeat.js";
import {
  isListenerDown,
  type ListenerArm,
  listenerLiveness,
  parseListenerArm,
} from "../../../../../live/listen/supervise/liveness.js";

const STARTED = "2026-08-23T03:00:00.000Z";
const STARTED_MS = Date.parse(STARTED);

const arm = (over: Partial<ListenerArm> = {}): ListenerArm => ({
  armId: "arm-1",
  logPath: "/tmp/listener-logs/arm-1.log",
  pid: 4242,
  scope: { kind: "all" },
  startedAtIso: STARTED,
  threadReplyChannels: [],
  ...over,
});

const beat = (over: Partial<ListenerHeartbeat> = {}): ListenerHeartbeat => ({
  armId: "arm-1",
  lastSocketEventAtIso: STARTED,
  pid: 4242,
  socketState: "connected",
  socketStateSinceIso: STARTED,
  writtenAtIso: STARTED,
  ...over,
});

describe("parseListenerArm", () => {
  it("accepts a well-formed arm record", () => {
    const parsed = parseListenerArm({ raw: JSON.parse(JSON.stringify(arm())) });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual(arm());
  });

  it("refuses a record with no log path — a shared log is the measured failure this field exists to stop", () => {
    const parsed = parseListenerArm({ raw: { armId: "arm-1", pid: 1, startedAtIso: STARTED } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("logPath");
  });

  it("refuses a zero pid", () => {
    const parsed = parseListenerArm({ raw: { ...arm(), pid: 0 } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("pid");
  });

  it("refuses a value that is not an object", () => {
    const parsed = parseListenerArm({ raw: 7 });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("arm");
  });

  it("carries the thread-reply channels back off a record that names them", () => {
    const parsed = parseListenerArm({
      raw: JSON.parse(JSON.stringify(arm({ threadReplyChannels: ["C0SYN000016"] }))),
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).threadReplyChannels).toEqual(["C0SYN000016"]);
  });

  it("reads a record written before thread replies existed as switched off, rather than refusing it", () => {
    // The five fields every arm record on disk carried before this field was added. Failing the parse here
    // would make `listen supervise` call the whole record unreadable and re-arm UNSCOPED, which is a larger
    // loss than the one the field prevents.
    const parsed = parseListenerArm({
      raw: {
        armId: "arm-1",
        logPath: "/tmp/listener-logs/arm-1.log",
        pid: 4242,
        scope: { kind: "all" },
        startedAtIso: STARTED,
      },
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).threadReplyChannels).toEqual([]);
  });

  it("refuses thread-reply channels that are not a list of channel ids", () => {
    const parsed = parseListenerArm({ raw: { ...arm(), threadReplyChannels: "C0SYN000016" } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("threadReplyChannels");
  });

  it("refuses a thread-reply list carrying a DM id, which is the other addressing path entirely", () => {
    const parsed = parseListenerArm({ raw: { ...arm(), threadReplyChannels: ["D0SYN000001"] } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("threadReplyChannels");
  });
});

describe("listenerLiveness", () => {
  it("reports unarmed when nothing is being supervised", () => {
    const verdict = listenerLiveness({ arm: undefined, heartbeat: undefined, nowMs: STARTED_MS, pidAlive: false });
    expect(verdict.state).toBe("unarmed");
    expect(isListenerDown({ liveness: verdict })).toBe(false);
  });

  it("reports process-dead when the pid is gone, EVEN WITH a fresh connected beat on disk", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat(),
      nowMs: STARTED_MS + 1_000,
      pidAlive: false,
    });
    expect(verdict.state).toBe("process-dead");
    expect(isListenerDown({ liveness: verdict })).toBe(true);
  });

  it("reports starting inside the grace window when no beat exists yet", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: undefined,
      nowMs: STARTED_MS + HEARTBEAT_GRACE_MS,
      pidAlive: true,
    });
    expect(verdict.state).toBe("starting");
    expect(isListenerDown({ liveness: verdict })).toBe(false);
  });

  it("reports heartbeat-missing once the grace window has passed with no beat", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: undefined,
      nowMs: STARTED_MS + HEARTBEAT_GRACE_MS + 1,
      pidAlive: true,
    });
    expect(verdict.state).toBe("heartbeat-missing");
    expect(isListenerDown({ liveness: verdict })).toBe(true);
  });

  it("reports heartbeat-foreign when the newest beat belongs to a previous arm", () => {
    const verdict = listenerLiveness({
      arm: arm({ armId: "arm-2" }),
      heartbeat: beat({ armId: "arm-1", writtenAtIso: "2026-08-23T03:02:00.000Z" }),
      nowMs: Date.parse("2026-08-23T03:02:01.000Z"),
      pidAlive: true,
    });
    expect(verdict.state).toBe("heartbeat-foreign");
    expect(isListenerDown({ liveness: verdict })).toBe(true);
  });

  it("treats a foreign beat inside the grace window as starting, not as death", () => {
    const verdict = listenerLiveness({
      arm: arm({ armId: "arm-2", startedAtIso: "2026-08-23T03:02:00.000Z" }),
      heartbeat: beat({ armId: "arm-1" }),
      nowMs: Date.parse("2026-08-23T03:02:10.000Z"),
      pidAlive: true,
    });
    expect(verdict.state).toBe("starting");
  });

  it("reports heartbeat-stale when this arm's own beat stopped being written", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat(),
      nowMs: STARTED_MS + HEARTBEAT_STALE_AFTER_MS + 1,
      pidAlive: true,
    });
    expect(verdict.state).toBe("heartbeat-stale");
    expect(isListenerDown({ liveness: verdict })).toBe(true);
  });

  it("calls a briefly disconnected socket RECONNECTING, not down — a backoff is normal, not a fault", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat({ socketState: "disconnected" }),
      nowMs: STARTED_MS + 1_000,
      pidAlive: true,
    });
    expect(verdict.state).toBe("reconnecting");
    expect(isListenerDown({ liveness: verdict })).toBe(false);
  });

  it("still calls it reconnecting at the very edge of the longest legitimate backoff", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat({ socketState: "connecting", writtenAtIso: "2026-08-23T03:01:20.000Z" }),
      nowMs: STARTED_MS + SOCKET_DOWN_AFTER_MS,
      pidAlive: true,
    });
    expect(verdict.state).toBe("reconnecting");
  });

  it("reports socket-down once the socket has been un-connected longer than any reconnect explains", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat({ socketState: "disconnected", writtenAtIso: "2026-08-23T03:01:40.000Z" }),
      nowMs: STARTED_MS + SOCKET_DOWN_AFTER_MS + 1,
      pidAlive: true,
    });
    expect(verdict.state).toBe("socket-down");
    expect(isListenerDown({ liveness: verdict })).toBe(true);
  });

  it("reports socket-down for a socket stuck CONNECTING, not just one that disconnected", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat({ socketState: "connecting", writtenAtIso: "2026-08-23T03:01:40.000Z" }),
      nowMs: STARTED_MS + SOCKET_DOWN_AFTER_MS + 1,
      pidAlive: true,
    });
    expect(verdict.state).toBe("socket-down");
  });

  it("honours a caller-supplied socket-down tolerance", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat({ socketState: "disconnected" }),
      nowMs: STARTED_MS + 2_000,
      pidAlive: true,
      socketDownAfterMs: 1_000,
    });
    expect(verdict.state).toBe("socket-down");
  });

  it("reports healthy for a live process, a fresh beat and a connected socket", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat(),
      nowMs: STARTED_MS + 5_000,
      pidAlive: true,
    });
    expect(verdict.state).toBe("healthy");
    expect(isListenerDown({ liveness: verdict })).toBe(false);
  });

  it("honours a caller-supplied staleness tolerance", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      heartbeat: beat(),
      nowMs: STARTED_MS + 2_000,
      pidAlive: true,
      staleAfterMs: 1_000,
    });
    expect(verdict.state).toBe("heartbeat-stale");
  });

  it("honours a caller-supplied grace window", () => {
    const verdict = listenerLiveness({
      arm: arm(),
      graceMs: 1_000,
      heartbeat: undefined,
      nowMs: STARTED_MS + 2_000,
      pidAlive: true,
    });
    expect(verdict.state).toBe("heartbeat-missing");
  });
});
