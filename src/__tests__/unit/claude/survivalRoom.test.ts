/**
 * The survival forecast's room arithmetic: every ceiling is the one routing reads, a take that fills a plan lands
 * exactly on its ceiling, and a READ utilization is never rounded up to one.
 */
import { describe, expect, it } from "vitest";

import { EPSILON, type LivePlan, roomOf, take, weeklyCeilingAt } from "../../../claude/survivalRoom.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;
const HOUR_MS = 3_600_000;
const NOW_MS = Date.parse("2026-11-05T00:00:00.000Z");

/** A live plan `hoursToReset` from its reset, unlimited and with no five-hour ceiling unless given. */
function livePlan({
  utilization,
  hoursToReset = 100,
  usageLimitPercent = 100,
  absorbPerHour,
  takenThisHour = 0,
}: {
  utilization: number;
  hoursToReset?: number;
  usageLimitPercent?: UsageLimitPercent;
  absorbPerHour?: number;
  takenThisHour?: number;
}): LivePlan {
  return {
    absorbPerHour,
    alias: "only",
    cappedThisCycle: false,
    resetMs: NOW_MS + hoursToReset * HOUR_MS,
    rolledAtMs: undefined,
    takenThisHour,
    usageLimitPercent,
    utilization,
  };
}

describe("weeklyCeilingAt", () => {
  it("is the house bar on an unlimited plan mid-week, and the limit where it is lower", () => {
    expect(weeklyCeilingAt({ atMs: NOW_MS, plan: livePlan({ utilization: 0 }), thresholds: THRESHOLDS })).toEqual({
      source: "routing-bar",
      utilization: 0.95,
    });
    const limited = livePlan({ usageLimitPercent: 50, utilization: 0 });
    expect(weeklyCeilingAt({ atMs: NOW_MS, plan: limited, thresholds: THRESHOLDS })).toEqual({
      source: "usage-limit",
      utilization: 0.5,
    });
  });

  it("lifts an unlimited plan to spend-out in its last hours, and a 50% plan not past its limit", () => {
    const unlimited = livePlan({ hoursToReset: 2, utilization: 0 });
    expect(weeklyCeilingAt({ atMs: NOW_MS, plan: unlimited, thresholds: THRESHOLDS }).utilization).toBe(1);
    const limited = livePlan({ hoursToReset: 2, usageLimitPercent: 50, utilization: 0 });
    expect(weeklyCeilingAt({ atMs: NOW_MS, plan: limited, thresholds: THRESHOLDS }).utilization).toBe(0.5);
  });
});

describe("roomOf", () => {
  it("is the week left under the ceiling, or the hour left where the five-hour ceiling binds first", () => {
    expect(
      roomOf({ atMs: NOW_MS, plan: livePlan({ utilization: 0.45, usageLimitPercent: 50 }), thresholds: THRESHOLDS }),
    ).toBeCloseTo(0.05, 12);
    const throttled = livePlan({ absorbPerHour: 0.04, takenThisHour: 0.03, utilization: 0.2 });
    expect(roomOf({ atMs: NOW_MS, plan: throttled, thresholds: THRESHOLDS })).toBeCloseTo(0.01, 12);
  });

  it("keeps a read utilization a hair under its limit open, as routing's exact comparison does", () => {
    const hair = livePlan({ usageLimitPercent: 50, utilization: 0.4999999995 });
    expect(roomOf({ atMs: NOW_MS, plan: hair, thresholds: THRESHOLDS })).toBeCloseTo(5e-10, 15);
  });
});

describe("take", () => {
  it("lands a take within rounding of the ceiling exactly on it, week and hour alike", () => {
    const plan = livePlan({ absorbPerHour: 0.1, takenThisHour: 0.05, usageLimitPercent: 50, utilization: 0.45 });
    take({ amount: 0.05 - EPSILON / 2, atMs: NOW_MS, plan, thresholds: THRESHOLDS });
    expect(plan.utilization).toBe(0.5);
    expect(plan.takenThisHour).toBe(0.1);
    expect(roomOf({ atMs: NOW_MS, plan, thresholds: THRESHOLDS })).toBe(0);
  });

  it("adds a take short of the ceiling as it is, and records it against the hour with no five-hour ceiling", () => {
    const plan = livePlan({ utilization: 0.25 });
    take({ amount: 0.25, atMs: NOW_MS, plan, thresholds: THRESHOLDS });
    expect(plan.utilization).toBe(0.5);
    expect(plan.takenThisHour).toBe(0.25);
  });
});
