/**
 * The Codex week simulated: one plan capping while another carries is no spell, every plan capped with demand left is,
 * a free reset claimed at the bar refills a plan exactly as the chair's claim does, and the level line is the router's.
 */
import { describe, expect, it } from "vitest";

import { CODEX_WEEK_MS, codexLevelLineHeadroom } from "../../../codex/levelLine.js";
import { type CodexWeekPlan, simulateCodexWeek } from "../../../codex/weekSimulation.js";

const NOW_MS = Date.parse("2026-11-08T12:00:00.000Z");
const HOUR_MS = 3_600_000;

/** A plan at `used` of a 99% bar, resetting `resetHours` from now. */
function plan({
  alias,
  claimableResets = 0,
  resetHours,
  used,
}: {
  alias: string;
  claimableResets?: number;
  resetHours: number;
  used: number;
}): CodexWeekPlan {
  return {
    ceilingPercent: 99,
    claimableResets,
    id: `codex:${alias}`,
    resetMs: NOW_MS + resetHours * HOUR_MS,
    usedPercent: used,
  };
}

describe("codexLevelLineHeadroom", () => {
  it("is the ceiling's share of the week elapsed, less what is used", () => {
    expect(
      codexLevelLineHeadroom({
        ceilingPercent: 99,
        nowMs: NOW_MS,
        resetMs: NOW_MS + CODEX_WEEK_MS / 2,
        usedPercent: 40,
      }),
    ).toBeCloseTo(9.5, 12);
    expect(
      codexLevelLineHeadroom({
        ceilingPercent: 99,
        nowMs: NOW_MS,
        resetMs: NOW_MS + CODEX_WEEK_MS * 2,
        usedPercent: 3,
      }),
    ).toBe(-3);
  });
});

describe("simulateCodexWeek", () => {
  it("projects no spell when one plan is capped and another carries the load", () => {
    const plans = [plan({ alias: "a", resetHours: 100, used: 99 }), plan({ alias: "b", resetHours: 100, used: 0 })];
    expect(simulateCodexWeek({ demandPerHour: 0.5, horizonHours: 168, nowMs: NOW_MS, plans }).spells).toEqual([]);
  });

  it("projects a spell from the hour every plan is capped to the first reset, naming that plan", () => {
    const plans = [plan({ alias: "a", resetHours: 30, used: 90 }), plan({ alias: "b", resetHours: 40, used: 90 })];
    expect(simulateCodexWeek({ demandPerHour: 1, horizonHours: 168, nowMs: NOW_MS, plans }).spells).toEqual([
      { endMs: NOW_MS + 30 * HOUR_MS, endedById: "codex:a", hours: 12, startMs: NOW_MS + 18 * HOUR_MS },
    ]);
  });

  it("says what each plan's current window used before it reset, and the hour it reached its ceiling", () => {
    // 12 points an hour is one point a slice, so five hours draw exactly 60 before the reset.
    const roomy = [plan({ alias: "a", resetHours: 5, used: 0 })];
    expect(simulateCodexWeek({ demandPerHour: 12, horizonHours: 168, nowMs: NOW_MS, plans: roomy }).plans).toEqual([
      { ceilingAtMs: undefined, claimsMs: [], id: "codex:a", usedAtWindowEndPercent: 60 },
    ]);
    const full = [plan({ alias: "a", resetHours: 5, used: 75 })];
    expect(simulateCodexWeek({ demandPerHour: 12, horizonHours: 168, nowMs: NOW_MS, plans: full }).plans).toEqual([
      { ceilingAtMs: NOW_MS + HOUR_MS, claimsMs: [], id: "codex:a", usedAtWindowEndPercent: 99 },
    ]);
  });

  it("names the hour a plan fills and the free reset claimed there, which ends its current window", () => {
    // 9 points fill it inside hour 0; the claimed week takes the other 3, then 12 an hour reaches 99 at hour 8.
    const plans = [plan({ alias: "a", claimableResets: 2, resetHours: 30, used: 90 })];
    expect(simulateCodexWeek({ demandPerHour: 12, horizonHours: 168, nowMs: NOW_MS, plans }).plans).toEqual([
      {
        ceilingAtMs: NOW_MS,
        claimsMs: [NOW_MS, NOW_MS + 8 * HOUR_MS],
        id: "codex:a",
        usedAtWindowEndPercent: 99,
      },
    ]);
  });

  it("claims a free reset at the bar, which refills the week and erases that spell", () => {
    const plans = [
      plan({ alias: "a", claimableResets: 1, resetHours: 30, used: 90 }),
      plan({ alias: "b", resetHours: 40, used: 90 }),
    ];
    expect(simulateCodexWeek({ demandPerHour: 1, horizonHours: 168, nowMs: NOW_MS, plans }).spells).toEqual([]);
  });

  it("claims for a plan that STARTS at its bar, which no slice would ever reach — a replay's false alarm", () => {
    const capped = [plan({ alias: "a", claimableResets: 3, resetHours: 30, used: 99 })];
    expect(simulateCodexWeek({ demandPerHour: 1, horizonHours: 168, nowMs: NOW_MS, plans: capped }).spells).toEqual([]);
  });

  it("follows a spell starting inside the horizon to its end past it", () => {
    const plans = [plan({ alias: "a", resetHours: 30, used: 90 })];
    expect(simulateCodexWeek({ demandPerHour: 1, horizonHours: 10, nowMs: NOW_MS, plans }).spells).toEqual([
      { endMs: NOW_MS + 30 * HOUR_MS, endedById: "codex:a", hours: 21, startMs: NOW_MS + 9 * HOUR_MS },
    ]);
  });

  it("starts no spell after the horizon", () => {
    const plans = [plan({ alias: "a", resetHours: 30, used: 90 })];
    expect(simulateCodexWeek({ demandPerHour: 1, horizonHours: 9, nowMs: NOW_MS, plans }).spells).toEqual([]);
  });
});
