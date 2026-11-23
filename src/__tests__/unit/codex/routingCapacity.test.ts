/**
 * The Codex pause bar, asserted directly: which windows cross it, and the exact reason it prints.
 */
import { describe, expect, it } from "vitest";

import type { CodexGauge } from "../../../codex/gauge.js";
import {
  codexEffectiveUsageCeiling,
  codexNearCapWindows,
  codexUsageLimitReached,
  nearCapReason,
  usageLimitReason,
} from "../../../codex/routingCapacity.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const NOW = "2026-09-26T02:00:00.000Z";
const RESET = "2026-09-30T02:50:53.000Z";
const THRESHOLDS = DEFAULT_THRESHOLDS.codex;

/** A gauge whose weekly window reads the given percentage, observed an hour before {@link NOW}. */
function weeklyGauge({ usedPercent }: { usedPercent: number }): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso: "2026-09-26T01:00:00.000Z",
    planType: "pro",
    reached: undefined,
    reachedType: undefined,
    windows: [{ label: "weekly", resetAtIso: RESET, slot: "primary", usedPercent, windowMinutes: 10080 }],
  };
}

describe("the Codex pause bar", () => {
  it("defaults to 99 — about one percent left", () => {
    expect(THRESHOLDS.pauseAtPercent).toBe(99);
  });

  it("finds the weekly window at the bar and none just under it", () => {
    expect(
      codexNearCapWindows({ gauge: weeklyGauge({ usedPercent: 99 }), nowIso: NOW, thresholds: THRESHOLDS }),
    ).toEqual([{ label: "weekly", resetAtIso: RESET, usedPercent: 99 }]);
    expect(
      codexNearCapWindows({ gauge: weeklyGauge({ usedPercent: 98.99 }), nowIso: NOW, thresholds: THRESHOLDS }),
    ).toEqual([]);
  });

  it("finds nothing when there is no reading at all", () => {
    expect(codexNearCapWindows({ gauge: undefined, nowIso: NOW, thresholds: THRESHOLDS })).toEqual([]);
  });

  it("names the window, its exact reading, its reset and the bar", () => {
    expect(
      nearCapReason({
        thresholds: THRESHOLDS,
        windows: [{ label: "weekly", resetAtIso: RESET, usedPercent: 99.4 }],
      }),
    ).toBe(`weekly window at 99.4% used, resets ${RESET} — paused for new work at 99% (about 1 percent left)`);
  });

  it("moves with the register: a pause bar of 90 finds a 92% week, and names 90 and 10 percent left", () => {
    const thresholds = { alertAtPercent: 60, pauseAtPercent: 90 };
    const windows = codexNearCapWindows({ gauge: weeklyGauge({ usedPercent: 92 }), nowIso: NOW, thresholds });

    expect(windows).toEqual([{ label: "weekly", resetAtIso: RESET, usedPercent: 92 }]);
    expect(nearCapReason({ thresholds, windows })).toBe(
      `weekly window at 92% used, resets ${RESET} — paused for new work at 90% (about 10 percent left)`,
    );
    expect(
      codexNearCapWindows({ gauge: weeklyGauge({ usedPercent: 92 }), nowIso: NOW, thresholds: THRESHOLDS }),
    ).toEqual([]);
  });
});

describe("the effective usage ceiling — the owner's limit lowers the WEEKLY window only", () => {
  it("is 30, 40 and 99 on the weekly window for usage limits 30, 40 and 100", () => {
    expect(
      ([30, 40, 100] as const).map((usageLimitPercent) =>
        codexEffectiveUsageCeiling({ label: "weekly", thresholds: THRESHOLDS, usageLimitPercent }),
      ),
    ).toEqual([
      { source: "usage-limit", usedPercent: 30 },
      { source: "usage-limit", usedPercent: 40 },
      { source: "routing-bar", usedPercent: 99 },
    ]);
  });

  it("keeps the five-hour window at the house bar of 99 on a 30 row", () => {
    expect(codexEffectiveUsageCeiling({ label: "five-hour", thresholds: THRESHOLDS, usageLimitPercent: 30 })).toEqual({
      source: "routing-bar",
      usedPercent: 99,
    });
  });

  it("takes the register's pause bar as the ceiling of a 100 row, and caps a limit set above it", () => {
    const thresholds = { alertAtPercent: 60, pauseAtPercent: 80 };

    expect(codexEffectiveUsageCeiling({ label: "weekly", thresholds, usageLimitPercent: 100 })).toEqual({
      source: "routing-bar",
      usedPercent: 80,
    });
    expect(codexEffectiveUsageCeiling({ label: "weekly", thresholds, usageLimitPercent: 90 })).toEqual({
      source: "routing-bar",
      usedPercent: 80,
    });
  });

  it("finds the weekly window at its limit and none just under it, and leaves a 100 row to the bar", () => {
    expect(
      codexUsageLimitReached({
        gauge: weeklyGauge({ usedPercent: 30 }),
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "at-limit", resetAtIso: RESET, usageLimitPercent: 30, usedPercent: 30 });
    expect(
      codexUsageLimitReached({
        gauge: weeklyGauge({ usedPercent: 29.9999999 }),
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toBeUndefined();
    expect(
      codexUsageLimitReached({
        gauge: weeklyGauge({ usedPercent: 100 }),
        gaugeSource: "rollout",
        nowIso: NOW,
        usageLimitPercent: 100,
      }),
    ).toBeUndefined();
  });

  // A 90 limit above a pause bar of 80 is still the owner's. The bar ignores a week it
  // cannot date, so the limit must hold an UNDATED 90% week itself, and an 89% one is the falsifier that it is the
  // limit, not the bar, deciding.
  it("holds an undated week at a limit set above a lowered pause bar, and passes one just under it", () => {
    const undated = ({ usedPercent }: { usedPercent: number }): CodexGauge => ({
      ...weeklyGauge({ usedPercent }),
      windows: [{ label: "weekly", resetAtIso: undefined, slot: "primary", usedPercent, windowMinutes: 10080 }],
    });
    const lowBar = { alertAtPercent: 70, pauseAtPercent: 80 };

    expect(codexNearCapWindows({ gauge: undated({ usedPercent: 90 }), nowIso: NOW, thresholds: lowBar })).toEqual([]);
    expect(
      codexUsageLimitReached({
        gauge: undated({ usedPercent: 90 }),
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 90,
      }),
    ).toEqual({ evidence: "at-limit", resetAtIso: undefined, usageLimitPercent: 90, usedPercent: 90 });
    expect(
      codexUsageLimitReached({
        gauge: undated({ usedPercent: 89 }),
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 90,
      }),
    ).toBeUndefined();
  });

  it("keeps a limited row with no reading out, and leaves a 100 row with none to the ranker", () => {
    expect(
      codexUsageLimitReached({
        gauge: undefined,
        gaugeSource: "none",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({
      evidence: "unread",
      resetAtIso: undefined,
      usageLimitPercent: 30,
      usedPercent: undefined,
    });
    expect(
      codexUsageLimitReached({
        gauge: undefined,
        gaugeSource: "none",
        nowIso: NOW,
        usageLimitPercent: 100,
      }),
    ).toBeUndefined();
  });

  it("keeps a limited row whose reading carries no weekly window out", () => {
    const fiveHourOnly: CodexGauge = {
      ...weeklyGauge({ usedPercent: 10 }),
      windows: [{ label: "five-hour", resetAtIso: RESET, slot: "primary", usedPercent: 10, windowMinutes: 300 }],
    };
    expect(
      codexUsageLimitReached({
        gauge: fiveHourOnly,
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({
      evidence: "unread",
      resetAtIso: undefined,
      usageLimitPercent: 30,
      usedPercent: undefined,
    });
  });

  it("reads the most-spent of two weekly slots, so a second at the limit is never hidden", () => {
    const twoWeekly: CodexGauge = {
      ...weeklyGauge({ usedPercent: 20 }),
      windows: [
        { label: "weekly", resetAtIso: RESET, slot: "primary", usedPercent: 20, windowMinutes: 10080 },
        { label: "weekly", resetAtIso: RESET, slot: "secondary", usedPercent: 30, windowMinutes: 10080 },
      ],
    };
    expect(
      codexUsageLimitReached({
        gauge: twoWeekly,
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "at-limit", resetAtIso: RESET, usageLimitPercent: 30, usedPercent: 30 });
  });

  it("holds a row unread when one of two weekly slots carries an unbelievable percentage", () => {
    const oneUnbelievable: CodexGauge = {
      ...weeklyGauge({ usedPercent: 20 }),
      windows: [
        { label: "weekly", resetAtIso: RESET, slot: "primary", usedPercent: 20, windowMinutes: 10080 },
        { label: "weekly", resetAtIso: RESET, slot: "secondary", usedPercent: Number.NaN, windowMinutes: 10080 },
      ],
    };
    expect(
      codexUsageLimitReached({
        gauge: oneUnbelievable,
        gaugeSource: "live",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "unread", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: undefined });
  });

  it("holds a limited row whose under-limit reading came only from the rollout log", () => {
    expect(
      codexUsageLimitReached({
        gauge: weeklyGauge({ usedPercent: 29 }),
        gaugeSource: "rollout",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "rollout-only", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: 29 });
  });

  it("still holds a rollout reading at the limit as at-limit, its reset named", () => {
    expect(
      codexUsageLimitReached({
        gauge: weeklyGauge({ usedPercent: 31 }),
        gaugeSource: "rollout",
        nowIso: NOW,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "at-limit", resetAtIso: RESET, usageLimitPercent: 30, usedPercent: 31 });
  });

  it("holds a reading at the limit unread once its reset has passed, live or rollout", () => {
    const afterReset = "2026-10-01T00:00:00.000Z";
    const spent: CodexGauge = { ...weeklyGauge({ usedPercent: 40 }), observedAtIso: "2026-09-30T23:00:00.000Z" };
    expect(
      codexUsageLimitReached({
        gauge: spent,
        gaugeSource: "live",
        nowIso: afterReset,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "unread", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: undefined });
    expect(
      codexUsageLimitReached({
        gauge: spent,
        gaugeSource: "rollout",
        nowIso: afterReset,
        usageLimitPercent: 30,
      }),
    ).toEqual({ evidence: "unread", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: undefined });
  });

  it("says a rollout-only week cannot show it is under the limit, and that a live reading reopens it", () => {
    expect(
      usageLimitReason({
        reached: { evidence: "rollout-only", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: 29 },
      }),
    ).toBe(
      "weekly window read only from the rollout log, at 29%, which cannot show it is still under this plan's 30% " +
        "usage limit — the owner's own limit, and no --force crosses it; a live Codex reading reopens it",
    );
  });

  it("says an unread week is held at the limit, not that it was read there", () => {
    expect(
      usageLimitReason({
        reached: { evidence: "unread", resetAtIso: undefined, usageLimitPercent: 30, usedPercent: undefined },
      }),
    ).toBe(
      "weekly window unread, so nothing shows it under this plan's 30% usage limit — the owner's own limit, and no " +
        "--force crosses it; a fresh Codex reading reopens it",
    );
  });

  it("states the limit is the owner's own and no provider cap evidence", () => {
    expect(
      usageLimitReason({
        reached: { evidence: "at-limit", resetAtIso: RESET, usageLimitPercent: 30, usedPercent: 30.5 },
      }),
    ).toBe(
      `weekly window at 30.5% used, at this plan's 30% usage limit (it resets ${RESET}) — the owner's own limit, ` +
        "not provider cap evidence, and no --force crosses it",
    );
  });
});
