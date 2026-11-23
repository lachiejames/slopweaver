import { describe, expect, it } from "vitest";

import {
  escalationStanding,
  type ListenerArmEvent,
  MAX_DEATHS_PER_WINDOW,
  parseListenerArmEvent,
  REARM_WINDOW_MS,
  rearmDecision,
} from "../../../../../live/listen/supervise/rearm.js";

const NOW = Date.parse("2026-08-23T03:30:00.000Z");

const died = ({ minutesAgo, armId = "arm-1" }: { minutesAgo: number; armId?: string }): ListenerArmEvent => ({
  armId,
  atIso: new Date(NOW - minutesAgo * 60_000).toISOString(),
  kind: "died",
  pid: 1,
  reason: "process-dead",
});

describe("parseListenerArmEvent", () => {
  it("round-trips an armed event", () => {
    const event: ListenerArmEvent = { armId: "arm-1", atIso: "2026-08-23T03:00:00.000Z", kind: "armed", pid: 9 };
    expect(parseListenerArmEvent({ line: JSON.stringify(event) })).toEqual(event);
  });

  it("round-trips a died event, keeping its reason", () => {
    const event = died({ minutesAgo: 1 });
    expect(parseListenerArmEvent({ line: JSON.stringify(event) })).toEqual(event);
  });

  it("round-trips a reconciled superseded death — the shape a pass that watched nothing writes", () => {
    const event: ListenerArmEvent = {
      armId: "45177d69",
      atIso: "2026-08-24T09:27:45.148Z",
      discovery: "reconciled",
      kind: "died",
      pid: 95251,
      reason: "superseded",
    };
    expect(parseListenerArmEvent({ line: JSON.stringify(event) })).toEqual(event);
  });

  it("drops a discovery it does not recognise rather than storing it, leaving the death observed", () => {
    const line = JSON.stringify({
      armId: "arm-1",
      atIso: "2026-08-23T03:00:00.000Z",
      discovery: "guessed",
      kind: "died",
      pid: 9,
      reason: "process-dead",
    });
    expect(parseListenerArmEvent({ line })).toEqual({
      armId: "arm-1",
      atIso: "2026-08-23T03:00:00.000Z",
      kind: "died",
      pid: 9,
      reason: "process-dead",
    });
  });

  it("round-trips a disarmed event", () => {
    const event: ListenerArmEvent = { armId: "arm-1", atIso: "2026-08-23T03:00:00.000Z", kind: "disarmed", pid: 9 };
    expect(parseListenerArmEvent({ line: JSON.stringify(event) })).toEqual(event);
  });

  it("round-trips an escalated event, which carries no pid", () => {
    const event: ListenerArmEvent = {
      armId: "arm-1",
      atIso: "2026-08-23T03:00:00.000Z",
      kind: "escalated",
      why: "three deaths",
    };
    expect(parseListenerArmEvent({ line: JSON.stringify(event) })).toEqual(event);
  });

  it("drops a torn line rather than failing the whole journal read", () => {
    expect(parseListenerArmEvent({ line: '{"kind":"died","armId":' })).toBe(undefined);
  });

  it("drops a died event whose reason is not one this supervisor produces", () => {
    expect(parseListenerArmEvent({ line: JSON.stringify({ ...died({ minutesAgo: 1 }), reason: "vibes" }) })).toBe(
      undefined,
    );
  });

  it("drops an event with an unparseable timestamp", () => {
    expect(parseListenerArmEvent({ line: JSON.stringify({ ...died({ minutesAgo: 1 }), atIso: "later" }) })).toBe(
      undefined,
    );
  });

  it("drops an event of an unknown kind", () => {
    const line = JSON.stringify({ armId: "a", atIso: "2026-08-23T03:00:00.000Z", kind: "napped", pid: 1 });
    expect(parseListenerArmEvent({ line })).toBe(undefined);
  });
});

describe("rearmDecision", () => {
  it("re-arms on the first death, counting it as one", () => {
    const decision = rearmDecision({ events: [], nowMs: NOW });
    expect(decision.action).toBe("rearm");
    expect(decision.deathsInWindow).toBe(1);
  });

  it("re-arms on the second death and reports one re-arm remaining", () => {
    const decision = rearmDecision({ events: [died({ minutesAgo: 5 })], nowMs: NOW });
    expect(decision.action).toBe("rearm");
    expect(decision.deathsInWindow).toBe(2);
  });

  it("ESCALATES on the third death inside the window rather than arming a fourth listener", () => {
    const decision = rearmDecision({
      events: [died({ minutesAgo: 10 }), died({ minutesAgo: 4 })],
      nowMs: NOW,
    });
    expect(decision.action).toBe("escalate");
    expect(decision.deathsInWindow).toBe(3);
  });

  it("ESCALATES on three deaths spread across three DIFFERENT arms — the shape of the reaped day", () => {
    const decision = rearmDecision({
      events: [died({ armId: "928671dd", minutesAgo: 10 }), died({ armId: "a6adc431", minutesAgo: 4 })],
      nowMs: NOW,
    });
    expect(decision.action).toBe("escalate");
    expect(decision.deathsInWindow).toBe(3);
  });

  it("counts a reconciled superseded death toward the cluster — an unwatched death is still a death", () => {
    const superseded = ({ minutesAgo, armId }: { minutesAgo: number; armId: string }): ListenerArmEvent => ({
      armId,
      atIso: new Date(NOW - minutesAgo * 60_000).toISOString(),
      discovery: "reconciled",
      kind: "died",
      pid: 1,
      reason: "superseded",
    });
    const decision = rearmDecision({
      events: [superseded({ armId: "one", minutesAgo: 10 }), superseded({ armId: "two", minutesAgo: 4 })],
      nowMs: NOW,
    });
    expect(decision.action).toBe("escalate");
    expect(decision.deathsInWindow).toBe(3);
  });

  it("names the count and the window in the question it records for the owner", () => {
    const decision = rearmDecision({
      events: [died({ minutesAgo: 10 }), died({ minutesAgo: 4 })],
      nowMs: NOW,
    });
    expect(decision.action === "escalate" ? decision.why : "").toContain("3 times inside 15 minutes");
  });

  it("re-arms when the earlier deaths fall OUTSIDE the window — three in three days is not a cluster", () => {
    const decision = rearmDecision({
      events: [died({ minutesAgo: 20 }), died({ minutesAgo: 40 })],
      nowMs: NOW,
    });
    expect(decision.action).toBe("rearm");
    expect(decision.deathsInWindow).toBe(1);
  });

  it("ignores a death stamped in the future rather than counting it toward the cluster", () => {
    const decision = rearmDecision({ events: [died({ minutesAgo: -5 })], nowMs: NOW });
    expect(decision.action).toBe("rearm");
    expect(decision.deathsInWindow).toBe(1);
  });

  it("counts only deaths — an armed event in the window is not one", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "arm-1", atIso: new Date(NOW - 60_000).toISOString(), kind: "armed", pid: 1 },
      { armId: "arm-1", atIso: new Date(NOW - 30_000).toISOString(), kind: "armed", pid: 2 },
    ];
    const decision = rearmDecision({ events, nowMs: NOW });
    expect(decision.action).toBe("rearm");
    expect(decision.deathsInWindow).toBe(1);
  });

  it("honours a caller-supplied threshold", () => {
    const decision = rearmDecision({ events: [], maxDeaths: 1, nowMs: NOW });
    expect(decision.action).toBe("escalate");
  });

  it("honours a caller-supplied window", () => {
    const decision = rearmDecision({ events: [died({ minutesAgo: 20 })], nowMs: NOW, windowMs: 3_600_000 });
    expect(decision.deathsInWindow).toBe(2);
  });

  it("pins the contract the loop session set for itself", () => {
    expect(MAX_DEATHS_PER_WINDOW).toBe(3);
    expect(REARM_WINDOW_MS).toBe(900_000);
  });
});

describe("escalationStanding", () => {
  const at = ({ minutesAgo }: { minutesAgo: number }): string => new Date(NOW - minutesAgo * 60_000).toISOString();

  it("is false for an empty journal", () => {
    expect(escalationStanding({ events: [] })).toBe(false);
  });

  it("is true when the newest lifecycle event is an escalation", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "a", atIso: at({ minutesAgo: 5 }), kind: "armed", pid: 1 },
      { armId: "a", atIso: at({ minutesAgo: 1 }), kind: "escalated", why: "three deaths" },
    ];
    expect(escalationStanding({ events })).toBe(true);
  });

  it("is CLEARED by a later armed event — a deliberate arm is the way back", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "a", atIso: at({ minutesAgo: 5 }), kind: "escalated", why: "three deaths" },
      { armId: "b", atIso: at({ minutesAgo: 1 }), kind: "armed", pid: 2 },
    ];
    expect(escalationStanding({ events })).toBe(false);
  });

  it("is CLEARED by a later disarmed event — someone tidied up", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "a", atIso: at({ minutesAgo: 5 }), kind: "escalated", why: "three deaths" },
      { armId: "a", atIso: at({ minutesAgo: 1 }), kind: "disarmed", pid: 2 },
    ];
    expect(escalationStanding({ events })).toBe(false);
  });

  it("is NOT cleared by a later death — an automatic tick can never lift its own hold", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "a", atIso: at({ minutesAgo: 5 }), kind: "escalated", why: "three deaths" },
      died({ minutesAgo: 1 }),
    ];
    expect(escalationStanding({ events })).toBe(true);
  });

  it("reads the NEWEST escalation, not the oldest — an arm then a second escalation still holds", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "a", atIso: at({ minutesAgo: 30 }), kind: "escalated", why: "first" },
      { armId: "b", atIso: at({ minutesAgo: 20 }), kind: "armed", pid: 2 },
      { armId: "b", atIso: at({ minutesAgo: 1 }), kind: "escalated", why: "second" },
    ];
    expect(escalationStanding({ events })).toBe(true);
  });
});
