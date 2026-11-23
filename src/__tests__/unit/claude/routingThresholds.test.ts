/*
 * A NON-default threshold changes the verdict. The bars are the install's own, off the plan register, so each case
 * runs one fixture twice — at the defaults, then at one changed bar — and asserts the two verdicts differ.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge } from "../../../claude/contracts.js";
import { acceptanceShortfall, planExcludedBy, rankClaudePlans } from "../../../claude/loadBalance.js";
import { routeSpawnToPlan, spawnBlockedBy } from "../../../claude/routeSpawn.js";
import { selectClaudeAccount, spendCapForSample } from "../../../claude/select.js";
import { triggerDecision } from "../../../claude/trigger.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { THRESHOLDS } from "./defaultThresholds.js";

const OBSERVED = "2026-09-03T15:39:00.000Z";
const FAR_RESET = "2026-09-10T00:00:00.000Z";

/**
 * One healthy weekly-window plan whose week resets a week away, so no spend-out lift is in force.
 *
 * @param alias the plan's label
 * @param week the plan-wide seven-day utilization
 * @returns the gauge
 */
function plan({ alias, week = 0.1 }: { alias: string; week?: number }): ClaudePlanGauge {
  return {
    alias,
    allowance: WEEKLY_WINDOW,
    fiveHour: { resetAtIso: "2026-09-04T00:00:00.000Z", status: "allowed", utilization: 0.1 },
    observedAtIso: OBSERVED,
    sevenDay: { resetAtIso: FAR_RESET, status: "allowed", utilization: week },
    sevenDayFable: { resetAtIso: FAR_RESET, status: "allowed", utilization: week },
    usageLimitPercent: 100,
  };
}

const LOWER_ROUTE_BAR = { ...THRESHOLDS, routeAt: 0.8 };

describe("the routing bar is the register's", () => {
  it("excludes a plan at 85% once the bar is 80%, which the default 95% keeps", () => {
    const gauge = plan({ alias: "plan-one", week: 0.85 });

    expect(planExcludedBy({ gauge, modelClass: "all-models", thresholds: THRESHOLDS })).toBeUndefined();
    expect(planExcludedBy({ gauge, modelClass: "all-models", thresholds: LOWER_ROUTE_BAR })!.kind).toBe("routing-bar");
  });

  it("ranks a plan at 85% out of the pool at an 80% bar and keeps it at the default", () => {
    const gauges = [plan({ alias: "plan-one", week: 0.85 }), plan({ alias: "plan-two" })];

    const defaults = rankClaudePlans({ gauges, modelClass: "all-models", thresholds: THRESHOLDS });
    const lowered = rankClaudePlans({ gauges, modelClass: "all-models", thresholds: LOWER_ROUTE_BAR });

    expect(defaults.ranked.map((ranked) => ranked.alias).toSorted()).toEqual(["plan-one", "plan-two"]);
    expect(lowered.ranked.map((ranked) => ranked.alias)).toEqual(["plan-two"]);
  });

  it("rotates the fleet off an active plan at 85% only once the bar is 80%", () => {
    const gauges = [plan({ alias: "plan-one", week: 0.85 }), plan({ alias: "plan-two" })];

    expect(selectClaudeAccount({ active: "plan-one", gauges, spends: [], thresholds: THRESHOLDS }).kind).toBe("stay");
    expect(selectClaudeAccount({ active: "plan-one", gauges, spends: [], thresholds: LOWER_ROUTE_BAR }).kind).toBe(
      "rotate",
    );
  });

  it("blocks a spawn on a plan at 85% only once the bar is 80%", () => {
    const gauge = plan({ alias: "plan-one", week: 0.85 });

    expect(spawnBlockedBy({ gauge, model: "opus", thresholds: THRESHOLDS })).toBeUndefined();
    expect(spawnBlockedBy({ gauge, model: "opus", thresholds: LOWER_ROUTE_BAR })!.kind).toBe("routing-bar");
  });

  it("routes a lone plan at 85% by default and finds no plan at an 80% bar", () => {
    const gauges = [plan({ alias: "plan-one", week: 0.85 })];

    expect(routeSpawnToPlan({ gauges, model: "opus", spends: [], thresholds: THRESHOLDS }).kind).toBe("route");
    expect(routeSpawnToPlan({ gauges, model: "opus", spends: [], thresholds: LOWER_ROUTE_BAR }).kind).toBe("no-plan");
  });

  it("holds a proactive trigger on a plan at 85% by default and rotates it at an 80% bar", () => {
    const gauges = [plan({ alias: "plan-one", week: 0.85 }), plan({ alias: "plan-two" })];

    expect(
      triggerDecision({ active: "plan-one", gauges, spends: [], seat: "worker", thresholds: THRESHOLDS }).act,
    ).toBe("hold");
    expect(
      triggerDecision({ active: "plan-one", gauges, spends: [], seat: "worker", thresholds: LOWER_ROUTE_BAR }).act,
    ).toBe("rotate");
  });
});

describe("the spend-out bar and its lead time are the register's", () => {
  const SIX_HOURS_OUT = "2026-09-17T19:00:00.000Z";
  const OBSERVED_AT = "2026-09-17T13:00:00.000Z";

  it("lifts the cap to the spend-out bar only once the lead time reaches six hours", () => {
    const sample = { claim: "seven_day", observedAtIso: OBSERVED_AT, resetAtIso: SIX_HOURS_OUT } as const;

    expect(spendCapForSample({ ...sample, thresholds: THRESHOLDS })).toBe(0.95);
    expect(spendCapForSample({ ...sample, thresholds: { ...THRESHOLDS, spendOutBeforeResetMs: 6 * 3_600_000 } })).toBe(
      1,
    );
  });

  it("lifts to the register's own spend-out bar rather than to 100%", () => {
    const sample = { claim: "seven_day", observedAtIso: OBSERVED_AT, resetAtIso: "2026-09-17T14:00:00.000Z" } as const;

    expect(spendCapForSample({ ...sample, thresholds: THRESHOLDS })).toBe(1);
    expect(spendCapForSample({ ...sample, thresholds: { ...THRESHOLDS, spendOutAt: 0.97 } })).toBe(0.97);
  });
});

describe("the acceptance bar is the register's", () => {
  it("grades a fleet with one plan at 85% short at the default 90% and met at an 80% bar", () => {
    const gauges = [plan({ alias: "plan-one", week: 1 }), plan({ alias: "plan-two", week: 0.85 })];

    const defaults = acceptanceShortfall({ configured: 2, gauges, thresholds: THRESHOLDS });
    const lowered = acceptanceShortfall({ configured: 2, gauges, thresholds: { ...THRESHOLDS, acceptanceAt: 0.8 } });

    expect(defaults.verdict).toBe("short");
    expect(defaults.shortOfBar).toEqual(["plan-two"]);
    expect(lowered.verdict).toBe("met");
    expect(lowered.barPercent).toBe(80);
  });
});
