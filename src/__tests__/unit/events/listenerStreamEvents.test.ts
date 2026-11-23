import { describe, expect, it } from "vitest";

import type { SupervisorEvent } from "../../../events/event.js";
import {
  listenerArmedEvent,
  listenerDeathEvents,
  listenerDegradedEvent,
  listenerDisarmedEvent,
  newestListenerKind,
  RECOVERY_STALLED_AFTER_MS,
  recoveryStalledEvent,
} from "../../../live/listen/supervise/streamEvents.js";

const atIso = "2026-08-23T03:00:00.000Z";

const recipeEvent: SupervisorEvent = {
  atIso,
  kind: "completed",
  runId: "run-9",
  slotHash: "slot-7",
  source: "recipe-scheduler",
  why: "a recipe slot completed",
};

describe("arming and disarming", () => {
  it("publishes the arm id and pid a supervisor needs to check the process itself", () => {
    const event = listenerArmedEvent({ armId: "a1b2c3d4", atIso, pid: 4242 });
    expect(event.kind).toBe("armed");
    expect(event.armId).toBe("a1b2c3d4");
    expect(event.pid).toBe(4242);
  });

  it("says a disarm was deliberate, so a supervisor does not read it as a fault", () => {
    const event = listenerDisarmedEvent({ armId: "a1b2c3d4", atIso, pid: 4242 });
    expect(event.kind).toBe("disarmed");
    expect(event.why.includes("deliberately")).toBe(true);
  });
});

describe("a degraded tick", () => {
  const degraded = ({
    grade = "degraded",
    ...over
  }: { previousKind?: "armed" | "heartbeat-degraded"; grade?: "degraded" | "healthy" } = {}) =>
    listenerDegradedEvent({
      armId: "a1b2c3d4",
      atIso,
      grade,
      pid: 4242,
      previousKind: over.previousKind,
      why: "reconnecting — off the socket for 12s",
    });

  it("publishes the first time it sees a degraded listener", () => {
    expect(degraded()?.kind).toBe("heartbeat-degraded");
  });

  it("carries the tick's own sentence rather than a generic one", () => {
    expect(degraded()?.why).toBe("reconnecting — off the socket for 12s");
  });

  it("stays silent on the next tick, so a reconnect does not repeat the same warning", () => {
    expect(degraded({ previousKind: "heartbeat-degraded" })).toBe(undefined);
  });

  it("publishes again once something else has happened since the last warning", () => {
    expect(degraded({ previousKind: "armed" })?.kind).toBe("heartbeat-degraded");
  });

  it("publishes nothing at all when the listener is not degraded", () => {
    expect(degraded({ grade: "healthy" })).toBe(undefined);
  });
});

describe("a death", () => {
  const death = ({ escalatedWhy, lastLog }: { escalatedWhy?: string; lastLog?: string } = {}) =>
    listenerDeathEvents({
      armId: "a1b2c3d4",
      atIso,
      deathsInWindow: 1,
      escalatedWhy,
      lastLog,
      pid: 4242,
      reason: "process-dead",
    });

  it("publishes the death and the re-arm as two events, never one merged outcome", () => {
    expect(death().map((event) => event.kind)).toStrictEqual(["died", "re-armed"]);
  });

  it("names the reason in the sentence, so a reader never has to go and look it up", () => {
    expect(death()[0]!.why.includes("process-dead")).toBe(true);
  });

  it("counts the death inside the window in the sentence", () => {
    const events = listenerDeathEvents({
      armId: "a1b2c3d4",
      atIso,
      deathsInWindow: 3,
      escalatedWhy: undefined,
      lastLog: undefined,
      pid: 4242,
      reason: "socket-down",
    });
    expect(events[0]!.why.includes("death 3")).toBe(true);
  });

  it("carries the dead arm's own log when there was one to read", () => {
    expect(death({ lastLog: "connected to Slack over Socket Mode" })[0]!.lastLog).toBe(
      "connected to Slack over Socket Mode",
    );
  });

  it("omits the log entirely when a foreground arm had no file to read", () => {
    expect(death()[0]!.lastLog).toBe(undefined);
  });

  it("publishes the death and the escalation when the tick stopped re-arming", () => {
    const events = death({ escalatedWhy: "died 3 times inside 15 minutes" });
    expect(events.map((event) => event.kind)).toStrictEqual(["died", "escalated"]);
    expect(events[1]!.why).toBe("died 3 times inside 15 minutes");
  });

  it("gives an escalation no pid, because it outlives the process it is about", () => {
    expect(death({ escalatedWhy: "stopped re-arming" })[1]!.pid).toBe(undefined);
  });

  it("says a re-arm is a command handed back, not a listener that is up again", () => {
    expect(death()[1]!.why.includes("not up again")).toBe(true);
  });
});

describe("the newest listener kind on a stream", () => {
  it("is undefined for an empty stream", () => {
    expect(newestListenerKind({ events: [] })).toBe(undefined);
  });

  it("is undefined when the stream carries only recipe events", () => {
    expect(newestListenerKind({ events: [recipeEvent] })).toBe(undefined);
  });

  it("skips past newer recipe events to the newest listener one", () => {
    const armed = listenerArmedEvent({ armId: "a1b2c3d4", atIso, pid: 4242 });
    expect(newestListenerKind({ events: [armed, recipeEvent] })).toBe("armed");
  });

  it("is the LAST listener event, not the first", () => {
    const armed = listenerArmedEvent({ armId: "a1b2c3d4", atIso, pid: 4242 });
    const disarmed = listenerDisarmedEvent({ armId: "a1b2c3d4", atIso, pid: 4242 });
    expect(newestListenerKind({ events: [armed, disarmed] })).toBe("disarmed");
  });
});

describe("a stalled recovery watermark", () => {
  // The live pinned value, as measured.
  const PINNED = "1787613559.194000";
  const nowMs = Date.parse("2026-08-25T06:28:00.000Z");
  const stalled = ({
    grade = "healthy",
    ...over
  }: {
    completedThroughTs?: string | undefined;
    grade?: "healthy" | "degraded" | "down" | "unarmed";
    nowMs?: number;
    previousKind?: "armed" | "recovery-stalled";
  } = {}) => {
    // `over` is the rest COPY, so every caller field was already read, in the caller's own order, when it was
    // made. A case that stages no judging instant is judged at the fixed one above.
    const { nowMs: judgedAtMs = nowMs } = over;
    return recoveryStalledEvent({
      armId: "a1b2c3d4",
      atIso,
      completedThroughTs: "completedThroughTs" in over ? over.completedThroughTs : PINNED,
      failures: 7,
      grade,
      nowMs: judgedAtMs,
      pid: 4242,
      previousKind: over.previousKind,
    });
  };

  it("gripes at alert kind when the watermark has sat still for an hour under a healthy listener", () => {
    const event = stalled();
    expect(event?.kind).toBe("recovery-stalled");
    expect(event?.armId).toBe("a1b2c3d4");
    expect(event?.pid).toBe(4242);
  });

  // The instant is SECOND-resolution because it is derived through `lib/slackTs.ts`, which floors on
  // purpose: the watermark's exact identity is its `ts`, and the sub-second digits are Slack's
  // within-a-second disambiguator, not something a reader of this sentence wants. The AGE beside it is still
  // computed from the full-precision epoch ms.
  it("names the pinned instant, its age, the listener grade and the failure count in one sentence", () => {
    const why = stalled()!.why;
    expect(why).toContain("2026-08-24T23:19:19.000Z");
    expect(why).toContain("7.1h ago");
    expect(why).toContain("listener is healthy");
    expect(why).toContain("7 failure(s)");
  });

  it("still gripes under a degraded listener — a reconnect does not explain an hour of partial sweeps", () => {
    expect(stalled({ grade: "degraded" })?.kind).toBe("recovery-stalled");
  });

  it("stays silent under a down listener, whose death is already the alert", () => {
    expect(stalled({ grade: "down" })).toBe(undefined);
  });

  it("stays silent when nothing is armed — nobody is running the bot", () => {
    expect(stalled({ grade: "unarmed" })).toBe(undefined);
  });

  it("stays silent before any complete sweep has ever established a watermark", () => {
    expect(stalled({ completedThroughTs: undefined })).toBe(undefined);
  });

  it("stays silent while the watermark is younger than the threshold", () => {
    const pinnedMs = Number.parseFloat(PINNED) * 1000;
    expect(stalled({ nowMs: pinnedMs + RECOVERY_STALLED_AFTER_MS - 1 })).toBe(undefined);
    expect(stalled({ nowMs: pinnedMs + RECOVERY_STALLED_AFTER_MS })?.kind).toBe("recovery-stalled");
  });

  it("stays silent on the next sweep, so a five-minute cadence does not repeat the alert twelve times an hour", () => {
    expect(stalled({ previousKind: "recovery-stalled" })).toBe(undefined);
    expect(stalled({ previousKind: "armed" })?.kind).toBe("recovery-stalled");
  });
});
