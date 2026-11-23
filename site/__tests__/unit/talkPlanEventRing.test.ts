/*
 * A plan call's replay rings: a reconnecting page replays what it missed. A herald's chime means something only just
 * before its line, so it is replayed to a page back inside its lead and never to one back after it, which would ring
 * a chime over nothing.
 */
import { describe, expect, it } from "vitest";

import { PLAN_CALL_LIMITS, type SequencedEvent } from "../../lib/planCallContract";
import { PlanEventRing } from "../../lib/talkPlanEventRing";

describe("PlanEventRing", () => {
  it("tells a listener a herald as it happens, numbers it, and never replays it once its lead is released", () => {
    const ring = new PlanEventRing();
    const heard: SequencedEvent[] = [];
    const live = ring.listen({ after: 0, listener: (event) => heard.push(event), onEmpty: () => undefined });
    ring.push({ event: { kind: "progress" }, telemetry: false });
    const release = ring.herald({ event: { cue: "focus", kind: "announce" } });
    ring.push({ event: { kind: "progress" }, telemetry: false });
    live.unsubscribe();
    release();
    const late = ring.listen({ after: 0, listener: () => undefined, onEmpty: () => undefined });
    expect([heard, late.replay]).toEqual([
      [
        { event: { kind: "progress" }, seq: 1 },
        { event: { cue: "focus", kind: "announce" }, seq: 2 },
        { event: { kind: "progress" }, seq: 3 },
      ],
      [
        { event: { kind: "progress" }, seq: 1 },
        { event: { kind: "progress" }, seq: 3 },
      ],
    ]);
  });

  // A rollover ask names the time left, so its replay must name the time left NOW.
  it("tells a live listener the event as sent, and replays it to a reconnecting page as measured at replay", () => {
    const ring = new PlanEventRing();
    const heard: SequencedEvent[] = [];
    const left = { contextUrgent: false, ms: 30_000 };
    const ask = () =>
      ({ contextUrgent: left.contextUrgent, kind: "rollover", lifetimeRemainingMs: left.ms, reason: "age" }) as const;
    const live = ring.listen({ after: 0, listener: (event) => heard.push(event), onEmpty: () => undefined });
    ring.push({ event: ask(), replayAs: ask, telemetry: false });
    live.unsubscribe();
    left.ms = 20_000;
    left.contextUrgent = true;
    const back = ring.listen({ after: 0, listener: () => undefined, onEmpty: () => undefined });
    expect([heard, back.replay]).toEqual([
      [{ event: { contextUrgent: false, kind: "rollover", lifetimeRemainingMs: 30_000, reason: "age" }, seq: 1 }],
      [{ event: { contextUrgent: true, kind: "rollover", lifetimeRemainingMs: 20_000, reason: "age" }, seq: 1 }],
    ]);
  });

  it("forgets an event's replay measure once the ring evicts it", () => {
    const ring = new PlanEventRing();
    const ask = () => ({ contextUrgent: false, kind: "rollover", lifetimeRemainingMs: 1, reason: "age" }) as const;
    ring.push({ event: ask(), replayAs: ask, telemetry: false });
    for (let i = 0; i < PLAN_CALL_LIMITS.replayRing; i += 1) {
      ring.push({ event: { kind: "progress" }, telemetry: false });
    }
    const back = ring.listen({ after: 0, listener: () => undefined, onEmpty: () => undefined });
    expect([back.replay.length, back.replay[0]]).toEqual([
      PLAN_CALL_LIMITS.replayRing,
      { event: { kind: "progress" }, seq: 2 },
    ]);
  });

  it("replays a herald to a page that reconnects while its lead still runs, in sequence order", () => {
    const ring = new PlanEventRing();
    ring.push({ event: { kind: "progress" }, telemetry: false });
    ring.herald({ event: { cue: "reminder", kind: "announce" } });
    ring.push({ event: { kind: "progress" }, telemetry: false });
    const back = ring.listen({ after: 1, listener: () => undefined, onEmpty: () => undefined });
    expect(back.replay).toEqual([
      { event: { cue: "reminder", kind: "announce" }, seq: 2 },
      { event: { kind: "progress" }, seq: 3 },
    ]);
  });
});
