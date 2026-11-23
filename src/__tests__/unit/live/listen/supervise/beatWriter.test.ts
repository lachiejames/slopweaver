import { describe, expect, it } from "vitest";

import { startListenerBeat } from "../../../../../live/listen/supervise/beatWriter.js";
import { HEARTBEAT_INTERVAL_MS, type ListenerHeartbeat } from "../../../../../live/listen/supervise/heartbeat.js";

/** A recording rig: a stepped clock, a captured tick, and every beat the writer produced. */
function rig({ startMs = Date.parse("2026-08-23T03:00:00.000Z") }: { startMs?: number } = {}): {
  readonly beats: ListenerHeartbeat[];
  readonly advance: (args: { ms: number }) => void;
  readonly fire: () => void;
  readonly cancelled: () => number;
  readonly scheduledMs: () => number | undefined;
  readonly start: () => ReturnType<typeof startListenerBeat>;
} {
  const beats: ListenerHeartbeat[] = [];
  let nowMs = startMs;
  let tick: (() => void) | undefined;
  let scheduledMs: number | undefined;
  let cancelled = 0;
  return {
    advance: ({ ms }) => {
      nowMs += ms;
    },
    beats,
    cancelled: () => cancelled,
    fire: () => tick?.(),
    scheduledMs: () => scheduledMs,
    start: () =>
      startListenerBeat({
        armId: "arm-1",
        nowIso: () => new Date(nowMs).toISOString(),
        pid: 4242,
        schedule: ({ ms, tick: onTick }) => {
          scheduledMs = ms;
          tick = onTick;
          return () => {
            cancelled += 1;
          };
        },
        write: ({ heartbeat }) => {
          beats.push(heartbeat);
        },
      }),
  };
}

describe("startListenerBeat", () => {
  it("writes one beat IMMEDIATELY, not an interval later", () => {
    const r = rig();
    r.start();
    expect(r.beats.length).toBe(1);
    expect(r.beats[0]!.writtenAtIso).toBe("2026-08-23T03:00:00.000Z");
  });

  it("stamps every beat with the arm id and pid it was started for", () => {
    const r = rig();
    r.start();
    expect(r.beats[0]!.armId).toBe("arm-1");
    expect(r.beats[0]!.pid).toBe(4242);
  });

  it("starts in the connecting state, before any socket exists", () => {
    const r = rig();
    r.start();
    expect(r.beats[0]!.socketState).toBe("connecting");
    expect(r.beats[0]!.lastSocketEventAtIso).toBe(undefined);
  });

  it("schedules its repeat at the heartbeat interval", () => {
    const r = rig();
    r.start();
    expect(r.scheduledMs()).toBe(HEARTBEAT_INTERVAL_MS);
  });

  it("reflects a socket-state change on the NEXT beat, with the clock at that beat", () => {
    const r = rig();
    const writer = r.start();
    writer.noteSocketState({ state: "connected" });
    r.advance({ ms: 15_000 });
    r.fire();
    expect(r.beats.length).toBe(2);
    expect(r.beats[1]!.socketState).toBe("connected");
    expect(r.beats[1]!.writtenAtIso).toBe("2026-08-23T03:00:15.000Z");
  });

  it("records the instant of the last frame, not the instant of the beat that reports it", () => {
    const r = rig();
    const writer = r.start();
    r.advance({ ms: 4_000 });
    writer.noteFrame();
    r.advance({ ms: 11_000 });
    r.fire();
    expect(r.beats[1]!.lastSocketEventAtIso).toBe("2026-08-23T03:00:04.000Z");
    expect(r.beats[1]!.writtenAtIso).toBe("2026-08-23T03:00:15.000Z");
  });

  it("beatNow writes out of band without waiting for the interval", () => {
    const r = rig();
    const writer = r.start();
    writer.beatNow();
    expect(r.beats.length).toBe(2);
  });

  it("stamps socketStateSinceIso when the state CHANGES, and not when it is merely re-reported", () => {
    const r = rig();
    const writer = r.start();
    r.advance({ ms: 3_000 });
    writer.noteSocketState({ state: "connected" });
    r.advance({ ms: 2_000 });
    writer.noteSocketState({ state: "connected" });
    r.advance({ ms: 10_000 });
    r.fire();
    expect(r.beats[1]!.socketStateSinceIso).toBe("2026-08-23T03:00:03.000Z");
  });

  it("starts the socket-state clock at the first beat, so a never-connected socket ages from arming", () => {
    const r = rig();
    r.start();
    expect(r.beats[0]!.socketStateSinceIso).toBe("2026-08-23T03:00:00.000Z");
  });

  it("stop cancels the timer and writes a final disconnected beat", () => {
    const r = rig();
    const writer = r.start();
    writer.noteSocketState({ state: "connected" });
    r.advance({ ms: 1_000 });
    writer.stop();
    expect(r.cancelled()).toBe(1);
    expect(r.beats.length).toBe(2);
    expect(r.beats[1]!.socketState).toBe("disconnected");
  });

  it("stop is idempotent — a second call neither cancels twice nor writes a second final beat", () => {
    const r = rig();
    const writer = r.start();
    writer.stop();
    writer.stop();
    expect(r.cancelled()).toBe(1);
    expect(r.beats.length).toBe(2);
  });
});
