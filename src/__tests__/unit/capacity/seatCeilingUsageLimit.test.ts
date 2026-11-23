/**
 * `measureFleetCeiling` under a per-plan usage limit — the limit lowers a plan's runway below the house cap, holds in
 * the week's last five hours, and a monthly-spend plan, judged in dollars, is left out of burn and runway.
 */
import { describe, expect, it } from "vitest";
import { measureFleetCeiling } from "../../../capacity/seatCeiling.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { ceilingFixture, HOUR_FROM, HOUR_TO, THREE_WORKING, weekly } from "./seatCeilingFixtures.js";

describe("measureFleetCeiling — the usage limit set on a plan", () => {
  it("lowers a plan's runway to the usage limit set on it, below the house cap", () => {
    // alpha at a 60% usage limit: (0.6 − 0.45) / 11 = 0.013636…; + beta 0.01 = 0.023636…; ÷ 0.003 = 7.87 → 7.
    const report = unwrap(
      measureFleetCeiling({
        fromIso: HOUR_FROM,
        plans: [{ alias: "alpha", allowance: WEEKLY_WINDOW, usageLimitPercent: 60 }, ...weekly("beta")],
        problems: [],
        thresholds: DEFAULT_THRESHOLDS.claude,
        samples: ceilingFixture({ alphaReset: "2026-10-04T12:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toMatchObject({
      kind: "measured",
      plans: [
        { planAlias: "alpha", spendCap: 0.6 },
        { planAlias: "beta", spendCap: 0.95 },
      ],
      seats: 7,
    });
  });

  it("keeps the usage limit in the week's last five hours, where the house cap lifts to 1.0", () => {
    // alpha resets 4h out at a 60% limit: min(1, 0.6) = 0.6; (0.6 − 0.45) / 4 = 0.0375; + 0.01 = 0.0475 → 15.
    const report = unwrap(
      measureFleetCeiling({
        fromIso: HOUR_FROM,
        plans: [{ alias: "alpha", allowance: WEEKLY_WINDOW, usageLimitPercent: 60 }, ...weekly("beta")],
        problems: [],
        thresholds: DEFAULT_THRESHOLDS.claude,
        samples: ceilingFixture({ alphaReset: "2026-10-04T05:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toMatchObject({
      kind: "measured",
      plans: [
        { hoursToReset: 4, planAlias: "alpha", spendCap: 0.6 },
        { planAlias: "beta", spendCap: 0.95 },
      ],
      seats: 15,
    });
  });

  it("leaves a monthly-spend plan out of burn and runway, and says so as a coverage gap, not a broken reader", () => {
    const report = unwrap(
      measureFleetCeiling({
        fromIso: HOUR_FROM,
        plans: [...weekly("alpha"), { alias: "beta", allowance: { kind: "monthly-spend" }, usageLimitPercent: 100 }],
        problems: [],
        thresholds: DEFAULT_THRESHOLDS.claude,
        samples: ceilingFixture({ alphaReset: "2026-10-04T12:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.planAliases).toEqual(["alpha"]);
    expect(report.problems).toEqual([]);
    expect(report.uncountedPlans[0]).toBe(
      "beta: a monthly-spend plan is judged in dollars, never weekly windows, so it is neither burn nor runway here",
    );
    expect(report.ceiling).toMatchObject({ kind: "measured", plans: [{ planAlias: "alpha", spendCap: 0.95 }] });
  });
});
