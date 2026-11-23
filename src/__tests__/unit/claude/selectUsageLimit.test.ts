import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading, ClaudeWindowStatus } from "../../../claude/contracts.js";
import { MONTHLY_GAUGE_NOT_ITS_ALLOWANCE, monthlyGaugeExclusion } from "../../../claude/select.js";
import { type PlanAllowance, type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import {
  claudeEffectiveUsageCeiling,
  claudeWindowExclusion,
  selectClaudeAccount,
  THRESHOLDS,
} from "./defaultThresholds.js";

/** Build one gauge. Defaults are a healthy plan, so each test states only what it is actually testing. */
function gauge({
  alias,
  allowance = WEEKLY_WINDOW,
  fiveHourStatus = "allowed",
  fiveHourUtilization = 0.1,
  sevenDayReset = "2026-09-10T00:00:00.000Z",
  sevenDayStatus = "allowed",
  sevenDayUtilization = 0.1,
  usageLimitPercent = 100,
}: {
  alias: string;
  allowance?: PlanAllowance;
  fiveHourStatus?: ClaudeWindowStatus;
  fiveHourUtilization?: number;
  sevenDayReset?: string;
  sevenDayStatus?: ClaudeWindowStatus;
  sevenDayUtilization?: number;
  usageLimitPercent?: UsageLimitPercent;
}): ClaudePlanGauge {
  return {
    alias,
    allowance,
    fiveHour: {
      resetAtIso: "2026-09-04T00:00:00.000Z",
      status: fiveHourStatus,
      utilization: fiveHourUtilization,
    },
    observedAtIso: "2026-09-03T15:39:00.000Z",
    sevenDay: { resetAtIso: sevenDayReset, status: sevenDayStatus, utilization: sevenDayUtilization },
    usageLimitPercent,
  };
}

describe("the usage limit the owner sets on a plan", () => {
  const OBSERVED = "2026-09-03T15:39:00.000Z";
  const WEEK_RESET = "2026-09-10T00:00:00.000Z";
  const FIVE_HOUR_RESET = "2026-09-04T00:00:00.000Z";

  /** One weekly window at a stated utilization. */
  const week = ({ utilization }: { utilization: number }): ClaudeWindowReading => ({
    resetAtIso: WEEK_RESET,
    status: "allowed",
    utilization,
  });

  it("lowers a weekly window's ceiling to the limit when it is below the house cap", () => {
    expect(
      claudeEffectiveUsageCeiling({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        resetAtIso: WEEK_RESET,
        usageLimitPercent: 30,
      }),
    ).toStrictEqual({ source: "usage-limit", utilization: 0.3 });
  });

  it("keeps the house cap when the limit is no lower, and never lowers the five-hour window", () => {
    expect(
      claudeEffectiveUsageCeiling({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        resetAtIso: WEEK_RESET,
        usageLimitPercent: 100,
      }),
    ).toStrictEqual({ source: "routing-bar", utilization: THRESHOLDS.routeAt });
    expect(
      claudeEffectiveUsageCeiling({
        claim: "five_hour",
        observedAtIso: OBSERVED,
        resetAtIso: FIVE_HOUR_RESET,
        usageLimitPercent: 30,
      }),
    ).toStrictEqual({ source: "routing-bar", utilization: THRESHOLDS.routeAt });
  });

  it("excludes 0.3 at a 30% limit, as a usage limit and not a routing bar", () => {
    expect(
      claudeWindowExclusion({
        alias: "plan-one",
        claim: "seven_day",
        observedAtIso: OBSERVED,
        usageLimitPercent: 30,
        window: week({ utilization: 0.3 }),
      }),
    ).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: WEEK_RESET,
      kind: "usage-limit",
      reason: "seven_day at 30%, at its usage limit of 30%",
    });
  });

  it("excludes the float just over 0.3 and keeps the one just under it", () => {
    const at = ({ utilization }: { utilization: number }) =>
      claudeWindowExclusion({
        alias: "plan-one",
        claim: "seven_day",
        observedAtIso: OBSERVED,
        usageLimitPercent: 30,
        window: week({ utilization }),
      });
    expect(at({ utilization: 0.30000000000000004 })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: WEEK_RESET,
      kind: "usage-limit",
      reason: "seven_day at 30%, at its usage limit of 30%",
    });
    expect(at({ utilization: 0.299999999 })).toBe(undefined);
  });

  it("keeps 0.3 eligible at a 40% limit", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "plan-one", sevenDayUtilization: 0.3, usageLimitPercent: 40 })],
    });
    expect(decision).toStrictEqual({ excluded: [], kind: "rotate", to: "plan-one" });
  });

  it("never trips a 30% limit from a five-hour window at 0.3", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "plan-one", fiveHourUtilization: 0.3, sevenDayUtilization: 0.1, usageLimitPercent: 30 })],
    });
    expect(decision).toStrictEqual({ excluded: [], kind: "rotate", to: "plan-one" });
  });

  it("rotates off a plan at its usage limit and names the limit", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [
        gauge({ alias: "plan-one", sevenDayUtilization: 0.3, usageLimitPercent: 30 }),
        gauge({ alias: "plan-two" }),
      ],
    });
    expect(decision).toStrictEqual({
      excluded: [
        {
          alias: "plan-one",
          eligibleAtIso: WEEK_RESET,
          kind: "usage-limit",
          reason: "seven_day at 30%, at its usage limit of 30%",
        },
      ],
      from: "plan-one",
      kind: "rotate",
      to: "plan-two",
    });
  });

  // A five-hour routing bar reported first would mask the week's usage limit.
  it("names the week's usage limit when the five-hour window is past the house bar as well", () => {
    const decision = selectClaudeAccount({
      gauges: [
        gauge({ alias: "plan-one", fiveHourUtilization: 0.96, sevenDayUtilization: 0.3, usageLimitPercent: 30 }),
      ],
    });
    expect(decision).toMatchObject({
      excluded: [{ alias: "plan-one", kind: "usage-limit", reason: "seven_day at 30%, at its usage limit of 30%" }],
      kind: "all-exhausted",
    });
  });

  it("reports a provider-rejected week past the usage limit as usage-limit, which no hatch crosses", () => {
    const decision = selectClaudeAccount({
      gauges: [
        gauge({ alias: "plan-one", sevenDayStatus: "rejected", sevenDayUtilization: 0.5, usageLimitPercent: 30 }),
      ],
    });
    expect(decision).toMatchObject({
      excluded: [
        {
          alias: "plan-one",
          eligibleAtIso: WEEK_RESET,
          kind: "usage-limit",
          reason: "seven_day at 50%, at its usage limit of 30%",
        },
      ],
      kind: "all-exhausted",
    });
  });

  it("keeps a provider-rejected week BELOW the usage limit provider-refused", () => {
    const decision = selectClaudeAccount({
      gauges: [
        gauge({ alias: "plan-one", sevenDayStatus: "rejected", sevenDayUtilization: 0.2, usageLimitPercent: 30 }),
      ],
    });
    expect(decision).toMatchObject({
      excluded: [
        { alias: "plan-one", eligibleAtIso: WEEK_RESET, kind: "provider-refused", reason: "seven_day refused" },
      ],
      kind: "all-exhausted",
    });
  });

  it("excludes a monthly-spend plan's gauge, whatever its windows read, since its spend is its measure", () => {
    expect(monthlyGaugeExclusion({ plan: { alias: "plan-one", allowance: { kind: "monthly-spend" } } })).toStrictEqual({
      alias: "plan-one",
      kind: "not-measured",
      reason: MONTHLY_GAUGE_NOT_ITS_ALLOWANCE,
    });
    expect(monthlyGaugeExclusion({ plan: { alias: "plan-one", allowance: WEEKLY_WINDOW } })).toBe(undefined);
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "plan-one", allowance: { kind: "monthly-spend" } })],
      spends: [{ alias: "plan-one", verdict: { kind: "not-measured", reason: "no spend reading recorded" } }],
    });
    expect(decision).toStrictEqual({
      excluded: [{ alias: "plan-one", kind: "not-measured", reason: "monthly spend: no spend reading recorded" }],
      kind: "all-exhausted",
    });
  });
});

describe("selectClaudeAccount — the monthly-spend lane, the fallback behind every weekly plan", () => {
  /** An open monthly verdict at a share of its permitted spend. */
  const open = ({ alias, usedFraction }: { alias: string; usedFraction: number }) => ({
    alias,
    verdict: { currency: "USD", headroomMinor: 100, kind: "open" as const, reason: `${alias} open`, usedFraction },
  });

  it("prefers an eligible weekly plan over an open monthly one, however little the monthly one has spent", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "plan-one", sevenDayUtilization: 0.6 })],
      spends: [open({ alias: "plan-two", usedFraction: 0 })],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "plan-one" });
  });

  it("falls back to the open monthly plan with the least of its spend used once no weekly plan is eligible", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "plan-one", sevenDayStatus: "rejected", sevenDayUtilization: 1 })],
      spends: [open({ alias: "plan-two", usedFraction: 0.7 }), open({ alias: "plan-three", usedFraction: 0.2 })],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "plan-three" });
  });

  it("leaves an active monthly plan for a weekly one that is eligible again", () => {
    const decision = selectClaudeAccount({
      active: "plan-two",
      gauges: [gauge({ alias: "plan-one", sevenDayUtilization: 0.2 })],
      spends: [open({ alias: "plan-two", usedFraction: 0.1 })],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "plan-one" });
  });

  it("stays on an active monthly plan under its limit while no weekly plan is eligible, and says it is monthly", () => {
    const decision = selectClaudeAccount({
      active: "plan-two",
      gauges: [gauge({ alias: "plan-one", sevenDayStatus: "rejected", sevenDayUtilization: 1 })],
      spends: [open({ alias: "plan-two", usedFraction: 0.1 })],
    });
    expect(decision).toMatchObject({ kind: "stay", reason: "the active plan is still under its monthly usage limit" });
  });

  it("takes an open monthly plan before the RESERVED weekly one, which is last across both lanes", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "browser", sevenDayUtilization: 0.1 })],
      reserved: "browser",
      spends: [open({ alias: "plan-two", usedFraction: 0.1 })],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "plan-two" });
  });

  it("stays on an active monthly plan when the only eligible weekly plan is the reserved one, never rotating to itself", () => {
    const decision = selectClaudeAccount({
      active: "plan-two",
      gauges: [gauge({ alias: "browser", sevenDayUtilization: 0.1 })],
      reserved: "browser",
      spends: [open({ alias: "plan-two", usedFraction: 0.1 })],
    });
    expect(decision).toStrictEqual({
      kind: "stay",
      on: "plan-two",
      reason: "the active plan is still under its monthly usage limit",
    });
  });

  it("puts a RESERVED monthly plan behind another open monthly plan, however little the reserved one has spent", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", sevenDayStatus: "rejected", sevenDayUtilization: 1 })],
      reserved: "browser",
      spends: [open({ alias: "browser", usedFraction: 0.1 }), open({ alias: "plan-two", usedFraction: 0.2 })],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "plan-two" });
  });

  it("falls back to the reserved weekly plan once the monthly lane is at its limit too", () => {
    const decision = selectClaudeAccount({
      gauges: [gauge({ alias: "browser", sevenDayUtilization: 0.1 })],
      reserved: "browser",
      spends: [{ alias: "plan-two", verdict: { kind: "usage-limit", reason: "$50 of $100, at its usage limit" } }],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "browser" });
  });
});
