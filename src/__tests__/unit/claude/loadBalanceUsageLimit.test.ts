import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { MONTHLY_GAUGE_NOT_ITS_ALLOWANCE } from "../../../claude/select.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { headroomToReset, planExcludedBy, rankClaudePlans } from "./defaultThresholds.js";

const OBSERVED = "2026-09-09T14:40:00.000Z";
const RESET = "2026-09-13T03:00:00.000Z";

/**
 * One window at a utilization.
 *
 * @param utilization the fraction spent
 * @param status how the provider grades it
 * @param resetAtIso when it resets
 * @returns the reading
 */
const window = ({
  resetAtIso = RESET,
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status, utilization });

/**
 * One plan's gauge.
 *
 * @param alias the plan's label
 * @param week the plan-wide seven-day utilization
 * @param fable the Fable seven-day utilization, omitted for a gauge with no Fable reading
 * @param fiveHour the five-hour utilization
 * @param weekReset when the plan-wide week resets
 * @param fableReset when the Fable week resets
 * @returns the gauge
 */
const gauge = ({
  alias,
  fable,
  fableReset = RESET,
  fiveHour = 0.1,
  usageLimitPercent = 100,
  week,
  weekReset = RESET,
}: {
  alias: string;
  fable?: number;
  fableReset?: string;
  fiveHour?: number;
  usageLimitPercent?: UsageLimitPercent;
  week: number;
  weekReset?: string;
}): ClaudePlanGauge => ({
  alias,
  allowance: WEEKLY_WINDOW,
  fiveHour: window({ utilization: fiveHour }),
  observedAtIso: OBSERVED,
  sevenDay: window({ resetAtIso: weekReset, utilization: week }),
  usageLimitPercent,
  ...(fable === undefined ? {} : { sevenDayFable: window({ resetAtIso: fableReset, utilization: fable }) }),
});

/** Six days after {@link OBSERVED}. */
const IN_SIX_DAYS = "2026-09-15T14:40:00.000Z";

describe("headroomToReset — the line is drawn to the usage limit", () => {
  it("draws the line to the usage limit when it is below the house cap", () => {
    // One day into the week at a 30% limit: line 0.3 × 24/163.
    expect(
      headroomToReset({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        usageLimitPercent: 30,
        window: window({ resetAtIso: IN_SIX_DAYS, utilization: 0 }),
      }),
    ).toBeCloseTo((0.3 * 24) / 163, 10);
  });

  it("keeps the usage limit in the week's last five hours, where the house line lifts to 100%", () => {
    // One hour before the reset at a 30% limit: line 0.3 × 167/168, never 1 × 167/168.
    expect(
      headroomToReset({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        usageLimitPercent: 30,
        window: window({ resetAtIso: "2026-09-09T15:40:00.000Z", utilization: 0.1 }),
      }),
    ).toBeCloseTo((0.3 * 167) / 168 - 0.1, 10);
  });
});

describe("planExcludedBy and rankClaudePlans — the usage limit the owner sets on a plan", () => {
  it("excludes a plan at its weekly usage limit as a usage limit, for every spawn class", () => {
    const limited = gauge({ alias: "plan-one", fable: 0.1, usageLimitPercent: 30, week: 0.3 });
    const expected = {
      alias: "plan-one",
      eligibleAtIso: RESET,
      kind: "usage-limit",
      reason: "seven_day at 30%, at its usage limit of 30%",
    };
    expect(planExcludedBy({ gauge: limited, modelClass: "all-models" })).toStrictEqual(expected);
    expect(planExcludedBy({ gauge: limited, modelClass: "fable" })).toStrictEqual(expected);
  });

  it("excludes a Fable spawn at the Fable week's usage limit, and leaves an all-models spawn alone", () => {
    const limited = gauge({ alias: "plan-one", fable: 0.3, usageLimitPercent: 30, week: 0.2 });
    expect(planExcludedBy({ gauge: limited, modelClass: "fable" })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: RESET,
      kind: "usage-limit",
      reason: "seven_day_fable at 30%, at its usage limit of 30%",
    });
    expect(planExcludedBy({ gauge: limited, modelClass: "all-models" })).toBeUndefined();
  });

  // Reported in window order, the five-hour routing bar masked the week's limit,
  // and a spent-plan override that releases a routing bar booted the plan past it.
  it("reports the week's usage limit, not a five-hour routing bar that also excludes the plan", () => {
    const both = gauge({ alias: "plan-one", fiveHour: 0.96, usageLimitPercent: 30, week: 0.3 });
    expect(planExcludedBy({ gauge: both, modelClass: "all-models" })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: RESET,
      kind: "usage-limit",
      reason: "seven_day at 30%, at its usage limit of 30%",
    });
  });

  it("never trips the limit from the five-hour window", () => {
    expect(
      planExcludedBy({
        gauge: gauge({ alias: "plan-one", fiveHour: 0.3, usageLimitPercent: 30, week: 0.1 }),
        modelClass: "all-models",
      }),
    ).toBeUndefined();
  });

  it("excludes a monthly-spend plan's gauge before any window, since its spend is its measure", () => {
    const monthly: ClaudePlanGauge = {
      ...gauge({ alias: "plan-one", week: 0.1 }),
      allowance: { kind: "monthly-spend" },
    };
    expect(planExcludedBy({ gauge: monthly, modelClass: "all-models" })).toStrictEqual({
      alias: "plan-one",
      kind: "not-measured",
      reason: MONTHLY_GAUGE_NOT_ITS_ALLOWANCE,
    });
    const ranking = rankClaudePlans({
      gauges: [monthly, gauge({ alias: "plan-two", week: 0.9 })],
      modelClass: "all-models",
    });
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plan-two"]);
  });

  it("ranks against the plan's own effective ceiling, so a plan near a low limit sits behind an unlimited one", () => {
    // Both at 20% one day into the week. Unlimited: line 0.95 × 24/163 − 0.2 ≈ −0.06. Limited to 30%: line
    // 0.3 × 24/163 − 0.2 ≈ −0.156, further ahead of its own line, so it ranks second.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "limited", usageLimitPercent: 30, week: 0.2, weekReset: IN_SIX_DAYS }),
        gauge({ alias: "open", week: 0.2, weekReset: IN_SIX_DAYS }),
      ],
      modelClass: "all-models",
    });
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["open", "limited"]);
  });
});
