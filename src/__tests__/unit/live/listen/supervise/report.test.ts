import { describe, expect, it } from "vitest";

import type { ListenerHeartbeat } from "../../../../../live/listen/supervise/heartbeat.js";
import type { ListenerArm, ListenerLiveness } from "../../../../../live/listen/supervise/liveness.js";
import type { ListenerArmEvent } from "../../../../../live/listen/supervise/rearm.js";
import { listenerReport } from "../../../../../live/listen/supervise/report.js";

const NOW = Date.parse("2026-08-23T04:00:00.000Z");

const arm: ListenerArm = {
  armId: "arm-1",
  logPath: "/tmp/listener-logs/arm-1.log",
  pid: 4242,
  scope: { kind: "all" },
  startedAtIso: "2026-08-23T03:55:00.000Z",
  threadReplyChannels: [],
};

const beat = (over: Partial<ListenerHeartbeat> = {}): ListenerHeartbeat => ({
  armId: "arm-1",
  lastSocketEventAtIso: "2026-08-23T03:59:50.000Z",
  pid: 4242,
  socketState: "connected",
  socketStateSinceIso: "2026-08-23T03:55:05.000Z",
  writtenAtIso: "2026-08-23T03:59:55.000Z",
  ...over,
});

const healthy: ListenerLiveness = { ageMs: 5_000, armId: "arm-1", pid: 4242, state: "healthy" };

const died = ({ minutesAgo, lastLog }: { minutesAgo: number; lastLog?: string }): ListenerArmEvent => ({
  armId: "arm-1",
  atIso: new Date(NOW - minutesAgo * 60_000).toISOString(),
  kind: "died",
  pid: 4242,
  reason: "socket-down",
  ...(lastLog === undefined ? {} : { lastLog }),
});

const report = ({
  events = [],
  heartbeat = beat(),
  liveness = healthy,
  armRecord = arm,
}: {
  events?: readonly ListenerArmEvent[];
  heartbeat?: ListenerHeartbeat | undefined;
  liveness?: ListenerLiveness;
  armRecord?: ListenerArm;
} = {}) => listenerReport({ arm: armRecord, events, heartbeat, liveness, nowMs: NOW, why: "because" });

describe("the grade", () => {
  it("is healthy for a healthy verdict", () => {
    expect(report().grade).toBe("healthy");
  });

  it("is degraded — not down — while starting", () => {
    const liveness: ListenerLiveness = { armAgeMs: 1_000, armId: "arm-1", pid: 4242, state: "starting" };
    expect(report({ liveness }).grade).toBe("degraded");
  });

  it("is degraded — not down — while reconnecting, because a backoff is normal", () => {
    const liveness: ListenerLiveness = { armId: "arm-1", pid: 4242, socketDownMs: 5_000, state: "reconnecting" };
    expect(report({ liveness }).grade).toBe("degraded");
  });

  it("is down for a dead process", () => {
    const liveness: ListenerLiveness = { armId: "arm-1", pid: 4242, state: "process-dead" };
    expect(report({ liveness }).grade).toBe("down");
  });

  it("is down for a live process whose socket is gone", () => {
    const liveness: ListenerLiveness = { armId: "arm-1", pid: 4242, socketDownMs: 200_000, state: "socket-down" };
    expect(report({ liveness }).grade).toBe("down");
  });

  it("keeps unarmed APART from down — nothing running is the expected state with no loop session up", () => {
    const unarmed = listenerReport({
      arm: undefined,
      events: [],
      heartbeat: undefined,
      liveness: { state: "unarmed" },
      nowMs: NOW,
      why: "because",
    });
    expect(unarmed.grade).toBe("unarmed");
  });

  it("carries the one-sentence why it was given, verbatim", () => {
    expect(report().why).toBe("because");
  });
});

describe("the numbers a sweep reads", () => {
  it("names the arm and pid from the record", () => {
    expect(report().armId).toBe("arm-1");
    expect(report().pid).toBe(4242);
  });

  it("leaves arm and pid undefined when nothing is registered", () => {
    // Built directly rather than through the helper: a destructuring default fires on an ABSENT property,
    // not on an explicit `undefined`, so passing `armRecord: undefined` there would silently keep the arm.
    const unarmed = listenerReport({
      arm: undefined,
      events: [],
      heartbeat: undefined,
      liveness: { state: "unarmed" },
      nowMs: NOW,
      why: "because",
    });
    expect(unarmed.armId).toBe(undefined);
    expect(unarmed.pid).toBe(undefined);
  });

  it("reports the socket state the listener itself last wrote", () => {
    expect(report({ heartbeat: beat({ socketState: "disconnected" }) }).socketState).toBe("disconnected");
  });

  it("measures how long since Slack last delivered anything", () => {
    expect(report().lastEventAgoMs).toBe(10_000);
  });

  it("leaves lastEventAgoMs undefined when Slack has never delivered anything", () => {
    expect(report({ heartbeat: beat({ lastSocketEventAtIso: undefined }) }).lastEventAgoMs).toBe(undefined);
  });

  it("measures how long since the last beat", () => {
    expect(report().heartbeatAgoMs).toBe(5_000);
  });

  it("counts only the deaths inside the re-arm window", () => {
    const events = [died({ minutesAgo: 2 }), died({ minutesAgo: 5 }), died({ minutesAgo: 40 })];
    expect(report({ events }).deathsInWindow).toBe(2);
  });

  it("counts zero deaths for a journal that has none", () => {
    expect(report().deathsInWindow).toBe(0);
  });
});

describe("the last death", () => {
  it("is undefined when nothing has ever died", () => {
    expect(report().lastDeath).toBe(undefined);
  });

  it("is the NEWEST death, not the first", () => {
    const events = [died({ minutesAgo: 40, lastLog: "old" }), died({ minutesAgo: 2, lastLog: "new" })];
    expect(report({ events }).lastDeath?.lastLog).toBe("new");
  });

  it("carries the reason and the evidence, so a reader is not sent to find the log", () => {
    const events = [died({ minutesAgo: 2, lastLog: "invalid_auth\nreconnecting in 30000ms\n" })];
    expect(report({ events }).lastDeath?.reason).toBe("socket-down");
    expect(report({ events }).lastDeath?.lastLog).toContain("invalid_auth");
  });

  it("reports lastLog as undefined — never an empty string — when no log could be read", () => {
    expect(report({ events: [died({ minutesAgo: 2 })] }).lastDeath?.lastLog).toBe(undefined);
  });

  it("survives a death from OUTSIDE the window: still reported, just not counted", () => {
    const events = [died({ minutesAgo: 40 })];
    expect(report({ events }).deathsInWindow).toBe(0);
    expect(report({ events }).lastDeath?.atIso).toBe(new Date(NOW - 40 * 60_000).toISOString());
  });
});

describe("the escalation flag", () => {
  it("is false with no escalation on record", () => {
    expect(report({ events: [died({ minutesAgo: 2 })] }).escalated).toBe(false);
  });

  it("is true while an escalation stands, so a sweep knows nothing will re-arm on its own", () => {
    const events: readonly ListenerArmEvent[] = [
      died({ minutesAgo: 2 }),
      { armId: "arm-1", atIso: new Date(NOW - 60_000).toISOString(), kind: "escalated", why: "three deaths" },
    ];
    expect(report({ events }).escalated).toBe(true);
  });

  it("is false once a deliberate arm has cleared it", () => {
    const events: readonly ListenerArmEvent[] = [
      { armId: "arm-1", atIso: new Date(NOW - 120_000).toISOString(), kind: "escalated", why: "three deaths" },
      { armId: "arm-2", atIso: new Date(NOW - 60_000).toISOString(), kind: "armed", pid: 5 },
    ];
    expect(report({ events }).escalated).toBe(false);
  });
});
