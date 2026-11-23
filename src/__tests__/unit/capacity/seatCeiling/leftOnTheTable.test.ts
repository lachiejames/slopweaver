/*
 * `measureFleetCeiling` — what each plan left on the table: the unused plan-weeks bounded from its expired weekly
 * windows, the combined share over the plan-weeks observed resetting, and the plans with no observed reset. Every
 * figure is worked out by hand in the test that asserts it, from fixtures small enough to check on paper.
 */
import { describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../../claude/drawdownAnomaly.js";
import { unwrap } from "../../../../lib/result.js";
import { measureFleetCeiling, sample, weekly } from "../seatCeilingFixtures.js";

describe("measureFleetCeiling — left on the table", () => {
  const FROM = "2026-09-21T00:00:00.000Z";
  const TO = "2026-10-05T00:00:00.000Z";
  const samples: readonly DrawdownSample[] = [
    // alpha, week one: highest 0.8 → 20% unused; last reading 4h before the reset.
    sample({
      alias: "alpha",
      observedAtIso: "2026-09-23T10:00:00.000Z",
      resetAtIso: "2026-09-24T00:00:00.000Z",
      utilization: 0.6,
    }),
    sample({
      alias: "alpha",
      observedAtIso: "2026-09-23T20:00:00.000Z",
      resetAtIso: "2026-09-24T00:00:00.000Z",
      utilization: 0.8,
    }),
    // A five-hour reading at 0.1 that, counted as a week, would claim 90% unused — it is not a week.
    sample({
      alias: "alpha",
      observedAtIso: "2026-09-23T21:00:00.000Z",
      resetAtIso: "2026-09-24T00:00:00.000Z",
      utilization: 0.1,
      window: "five-hour",
    }),
    // alpha, week two: highest 0.9 → 10% unused; last reading 2h before the reset.
    sample({
      alias: "alpha",
      observedAtIso: "2026-09-30T22:00:00.000Z",
      resetAtIso: "2026-10-01T00:00:00.000Z",
      utilization: 0.9,
    }),
    // beta, one week: highest 0.5 → 50% unused; last reading 1h before the reset.
    sample({
      alias: "beta",
      observedAtIso: "2026-09-27T23:00:00.000Z",
      resetAtIso: "2026-09-28T00:00:00.000Z",
      utilization: 0.5,
    }),
    // gamma's only window resets after the span ends, so none of its weeks has gone unused yet.
    sample({
      alias: "gamma",
      observedAtIso: "2026-10-04T12:00:00.000Z",
      resetAtIso: "2026-10-08T00:00:00.000Z",
      utilization: 0.3,
    }),
  ];

  it("bounds each plan's unused plan-weeks from its expired windows, and names a plan with none", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta", "gamma"),
        fromIso: FROM,
        problems: [],
        samples,
        ticks: [],
        toIso: TO,
      }),
    );
    expect(report.unusedByPlan).toEqual([
      { expiredWindows: 2, planAlias: "alpha", unusedPlanWeeksUpperBound: 0.3, widestLastReadingToResetSeconds: 14400 },
      { expiredWindows: 1, planAlias: "beta", unusedPlanWeeksUpperBound: 0.5, widestLastReadingToResetSeconds: 3600 },
      {
        expiredWindows: 0,
        planAlias: "gamma",
        unusedPlanWeeksUpperBound: null,
        widestLastReadingToResetSeconds: null,
      },
    ]);
  });

  it("divides the combined bound by the plan-weeks observed resetting, never by the plan count", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta", "gamma"),
        fromIso: FROM,
        problems: [],
        samples,
        ticks: [],
        toIso: TO,
      }),
    );
    expect(report.observedExpiredPlanWeeks).toBe(3);
    expect(report.unusedPlanWeeksUpperBound).toBe(0.8);
    expect(report.combinedUnusedShareUpperBound).toBeCloseTo(0.8 / 3, 12);
  });

  it("carries the readers' problems through, and names the plan with no observed reset apart from them", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta", "gamma"),
        fromIso: FROM,
        problems: ["the tick ledger had 2 unparseable lines"],
        samples,
        ticks: [],
        toIso: TO,
      }),
    );
    expect(report.problems).toEqual(["the tick ledger had 2 unparseable lines"]);
    expect(report.uncountedPlans).toEqual([
      "gamma: no weekly window was observed resetting in the span, so it is not counted",
    ]);
  });

  it("reports nothing unused, rather than zero, when no plan's week reset in the span", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("gamma"),
        fromIso: FROM,
        problems: [],
        samples,
        ticks: [],
        toIso: TO,
      }),
    );
    expect(report.observedExpiredPlanWeeks).toBe(0);
    expect(report.unusedPlanWeeksUpperBound).toBe(null);
    expect(report.combinedUnusedShareUpperBound).toBe(null);
    expect(report.problems).toEqual([]);
    expect(report.uncountedPlans).toEqual([
      "gamma: no weekly window was observed resetting in the span, so it is not counted",
    ]);
  });
});
