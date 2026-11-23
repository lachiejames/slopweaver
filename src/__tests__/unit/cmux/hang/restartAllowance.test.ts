/*
 * The cmux hang judge's `restartAllowance`: whether the fleet may restart cmux now — a first restart, the cooldown,
 * the three-a-day cap, and a hang that keeps coming back after a restart held as recurring.
 */
import { describe, expect, it } from "vitest";

import { restartAllowance } from "../../../../cmux/hang.js";
import type { CmuxReviveEvent } from "../../../../cmux/reviveJournal.js";
import { instant, reading, started } from "./harness.js";

describe("restartAllowance", () => {
  const unknown = { kind: "unknown" } as const;

  it("allows a first restart", () => {
    expect(restartAllowance({ events: [], hang: unknown, nowIso: instant({ clock: "20:00" }) })).toEqual({
      kind: "allowed",
    });
  });

  it("holds a second restart inside the cooldown, until it ends", () => {
    expect(
      restartAllowance({ events: [started({ at: "19:50" })], hang: unknown, nowIso: instant({ clock: "20:00" }) }),
    ).toEqual({
      kind: "cooldown",
      untilIso: instant({ clock: "20:20" }),
    });
  });

  it("allows one past the cooldown under the cap", () => {
    expect(
      restartAllowance({ events: [started({ at: "19:00" })], hang: unknown, nowIso: instant({ clock: "20:00" }) }),
    ).toEqual({
      kind: "allowed",
    });
  });

  it("caps the day at three, until the oldest is a day old", () => {
    const three = [started({ at: "10:00" }), started({ at: "14:00" }), started({ at: "18:00" })];
    expect(restartAllowance({ events: three, hang: unknown, nowIso: instant({ clock: "20:00" }) })).toEqual({
      kind: "capped",
      untilIso: "2026-10-11T10:00:00.000Z",
    });
  });

  it("holds a third hang in a loop as recurring, ahead of the cooldown and cap, past the hour", () => {
    const loop: CmuxReviveEvent[] = [
      {
        appPid: 1,
        atIso: instant({ clock: "06:37" }),
        hungSinceIso: instant({ clock: "06:20" }),
        kind: "restart-started",
        schemaVersion: 1,
      },
      {
        atIso: instant({ clock: "06:38" }),
        detail: "",
        kind: "restart-finished",
        newAppPid: 2,
        outcome: "answering",
        schemaVersion: 1,
      },
      {
        appPid: 2,
        atIso: instant({ clock: "07:14" }),
        hungSinceIso: instant({ clock: "06:56" }),
        kind: "restart-started",
        schemaVersion: 1,
      },
      {
        atIso: instant({ clock: "07:15" }),
        detail: "",
        kind: "restart-finished",
        newAppPid: 3,
        outcome: "answering",
        schemaVersion: 1,
      },
      reading({ appPid: 3, at: "07:26", state: "stalled" }),
    ];
    const hang = { appPid: 3, kind: "unresponsive", overBound: true, sinceIso: instant({ clock: "07:26" }) } as const;
    expect([
      restartAllowance({ events: loop, hang, nowIso: instant({ clock: "07:50" }) }),
      restartAllowance({ events: loop, hang, nowIso: instant({ clock: "08:16" }) }),
    ]).toEqual([{ kind: "recurring" }, { kind: "recurring" }]);
  });

  it("holds a third hang stamped before the loop's restart by a clock set back past the cooldown", () => {
    const loop: CmuxReviveEvent[] = [
      {
        appPid: 1,
        atIso: instant({ clock: "09:59" }),
        hungSinceIso: instant({ clock: "09:40" }),
        kind: "restart-started",
        schemaVersion: 1,
      },
      {
        atIso: instant({ clock: "10:00" }),
        detail: "",
        kind: "restart-finished",
        newAppPid: 2,
        outcome: "answering",
        schemaVersion: 1,
      },
      reading({ appPid: 2, at: "10:10", state: "stalled" }),
      {
        appPid: 2,
        atIso: instant({ clock: "10:20" }),
        hungSinceIso: instant({ clock: "10:10" }),
        kind: "restart-started",
        schemaVersion: 1,
      },
      {
        atIso: instant({ clock: "10:21" }),
        detail: "",
        kind: "restart-finished",
        newAppPid: 3,
        outcome: "answering",
        schemaVersion: 1,
      },
      // At 10:25 the wall clock is set back to 09:55, and cmux hangs at once.
      reading({ appPid: 3, at: "09:55", state: "stalled" }),
    ];
    const hang = { appPid: 3, kind: "unresponsive", overBound: true, sinceIso: instant({ clock: "09:55" }) } as const;
    expect(restartAllowance({ events: loop, hang, nowIso: instant({ clock: "10:50" }) })).toEqual({
      kind: "recurring",
    });
  });
});
