import { describe, expect, it } from "vitest";

import type { ListenerArmEvent } from "../../../../../live/listen/supervise/rearm.js";
import { deathLowerBoundIso, reconciledDeaths } from "../../../../../live/listen/supervise/reconcile.js";

/** One `armed` line, the shape the listener writes about itself on startup. */
const armed = ({ armId, atIso, pid }: { armId: string; atIso: string; pid: number }): ListenerArmEvent => ({
  armId,
  atIso,
  kind: "armed",
  pid,
});

/**
 * The journal EXACTLY as the reaped day left it: every arm of the day registered, and not one death — because
 * the only writer of a death was a background task the harness reaped alongside the listener it watched.
 */
const theSilentDay: readonly ListenerArmEvent[] = [
  armed({ armId: "928671dd", atIso: "2026-08-24T05:23:34.236Z", pid: 49358 }),
  armed({ armId: "a6adc431", atIso: "2026-08-24T08:40:04.169Z", pid: 78857 }),
  armed({ armId: "45177d69", atIso: "2026-08-24T09:13:19.346Z", pid: 95251 }),
  armed({ armId: "396268d4", atIso: "2026-08-24T09:27:45.148Z", pid: 53974 }),
];

describe("reconciledDeaths on the day nothing was watching", () => {
  it("back-writes one death per arm a later arm replaced, so silence is impossible", () => {
    const deaths = reconciledDeaths({ events: theSilentDay, observed: undefined });
    expect(deaths.length).toBe(3);
    expect(deaths.map((death) => death.armId)).toEqual(["928671dd", "a6adc431", "45177d69"]);
  });

  it("stamps each one at the moment its successor armed — the tightest upper bound the journal carries", () => {
    const deaths = reconciledDeaths({ events: theSilentDay, observed: undefined });
    expect(deaths[0]!.atIso).toBe("2026-08-24T08:40:04.169Z");
    expect(deaths[2]!.atIso).toBe("2026-08-24T09:27:45.148Z");
  });

  it("calls them superseded and reconciled — the arm ENDED, and it does not claim to know how", () => {
    const death = reconciledDeaths({ events: theSilentDay, observed: undefined })[0]!;
    expect(death.kind).toBe("died");
    expect(death.kind === "died" ? death.reason : "").toBe("superseded");
    expect(death.kind === "died" ? death.discovery : "").toBe("reconciled");
  });

  it("carries the dead arm's own pid forward, so a reader can check the process table itself", () => {
    const death = reconciledDeaths({ events: theSilentDay, observed: undefined })[0]!;
    expect(death.kind === "died" ? death.pid : 0).toBe(49358);
  });

  it("leaves the arm still on record alone — nothing replaced it, so nothing says it died", () => {
    const deaths = reconciledDeaths({ events: theSilentDay, observed: undefined });
    expect(deaths.some((death) => death.armId === "396268d4")).toBe(false);
  });

  it("is idempotent: feeding its own output back returns nothing", () => {
    const first = reconciledDeaths({ events: theSilentDay, observed: undefined });
    expect(reconciledDeaths({ events: [...theSilentDay, ...first], observed: undefined })).toEqual([]);
  });
});

describe("reconciledDeaths and the terminal events already on record", () => {
  it("never reclassifies a deliberate stop: a disarmed arm gets no death", () => {
    const events: readonly ListenerArmEvent[] = [
      armed({ armId: "one", atIso: "2026-08-24T09:00:00.000Z", pid: 11 }),
      { armId: "one", atIso: "2026-08-24T09:05:00.000Z", kind: "disarmed", pid: 11 },
      armed({ armId: "two", atIso: "2026-08-24T09:06:00.000Z", pid: 12 }),
    ];
    expect(reconciledDeaths({ events, observed: undefined })).toEqual([]);
  });

  it("closes an arm by a death written far later in the file, not only by an adjacent one", () => {
    const events: readonly ListenerArmEvent[] = [
      armed({ armId: "one", atIso: "2026-08-24T09:00:00.000Z", pid: 11 }),
      armed({ armId: "two", atIso: "2026-08-24T09:06:00.000Z", pid: 12 }),
      { armId: "one", atIso: "2026-08-24T09:06:00.000Z", kind: "died", pid: 11, reason: "superseded" },
    ];
    expect(reconciledDeaths({ events, observed: undefined })).toEqual([]);
  });

  it("does not treat an escalation as terminal — supervise writes died THEN escalated for one arm", () => {
    const events: readonly ListenerArmEvent[] = [
      armed({ armId: "one", atIso: "2026-08-24T09:00:00.000Z", pid: 11 }),
      { armId: "one", atIso: "2026-08-24T09:05:00.000Z", kind: "escalated", why: "three in a row" },
      armed({ armId: "two", atIso: "2026-08-24T09:06:00.000Z", pid: 12 }),
    ];
    const deaths = reconciledDeaths({ events, observed: undefined });
    expect(deaths.length).toBe(1);
    expect(deaths[0]!.armId).toBe("one");
  });

  it("records nothing at all for an empty journal", () => {
    expect(reconciledDeaths({ events: [], observed: undefined })).toEqual([]);
  });
});

describe("reconciledDeaths and a death the caller observed", () => {
  const observed = {
    armId: "396268d4",
    atIso: "2026-08-24T09:40:00.000Z",
    lastLog: "listen: connected to Slack over Socket Mode\n",
    reason: "process-dead",
  } as const;

  it("journals it against the arm still on record, with its evidence and its lower-bound stamp", () => {
    const deaths = reconciledDeaths({ events: theSilentDay, observed });
    const last = deaths[deaths.length - 1]!;
    expect(last.armId).toBe("396268d4");
    expect(last.atIso).toBe("2026-08-24T09:40:00.000Z");
    expect(last.kind === "died" ? last.reason : "").toBe("process-dead");
    expect(last.kind === "died" ? last.lastLog : "").toBe("listen: connected to Slack over Socket Mode\n");
  });

  it("counts as the fourth death of the day, the three unwatched ones included", () => {
    expect(reconciledDeaths({ events: theSilentDay, observed }).length).toBe(4);
  });

  it("refuses to record it twice once the journal already holds one for that arm", () => {
    const journalled: readonly ListenerArmEvent[] = [
      ...theSilentDay,
      { armId: "396268d4", atIso: "2026-08-24T09:40:00.000Z", kind: "died", pid: 53974, reason: "process-dead" },
    ];
    expect(reconciledDeaths({ events: journalled, observed }).length).toBe(3);
  });

  it("ignores an observed death naming an arm that is not the one on record", () => {
    const stale = { armId: "45177d69", atIso: "2026-08-24T09:40:00.000Z", reason: "process-dead" } as const;
    const deaths = reconciledDeaths({ events: theSilentDay, observed: stale });
    expect(deaths.length).toBe(3);
    expect(deaths.every((death) => death.kind === "died" && death.reason === "superseded")).toBe(true);
  });
});

describe("deathLowerBoundIso", () => {
  const nowMs = Date.parse("2026-08-24T10:00:00.000Z");

  it("uses the last beat that arm wrote — the newest instant it is KNOWN to have been alive", () => {
    expect(
      deathLowerBoundIso({
        armStartedAtIso: "2026-08-24T09:27:45.148Z",
        lastBeatAtIso: "2026-08-24T09:40:36.000Z",
        nowMs,
      }),
    ).toBe("2026-08-24T09:40:36.000Z");
  });

  it("falls back to the arm's start when it never beat, or the newest beat is another arm's", () => {
    expect(deathLowerBoundIso({ armStartedAtIso: "2026-08-24T09:27:45.148Z", lastBeatAtIso: undefined, nowMs })).toBe(
      "2026-08-24T09:27:45.148Z",
    );
  });

  it("clamps a beat stamped in the future to now, so clock skew cannot push a death out of the window", () => {
    expect(
      deathLowerBoundIso({
        armStartedAtIso: "2026-08-24T09:27:45.148Z",
        lastBeatAtIso: "2026-08-24T11:00:00.000Z",
        nowMs,
      }),
    ).toBe("2026-08-24T10:00:00.000Z");
  });
});
