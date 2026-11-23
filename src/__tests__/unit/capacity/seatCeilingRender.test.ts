/**
 * `fleetCeilingHeadline` / `renderFleetCeilingLines` — pure. Reports are literals, so each expected line is
 * worked out from the figures in front of it rather than from a measurement this file does not own.
 */
import { describe, expect, it } from "vitest";
import type { FleetCeilingReport } from "../../../capacity/seatCeiling.js";
import { fleetCeilingHeadline, renderFleetCeilingLines } from "../../../capacity/seatCeilingRender.js";

/** A week where every figure was measured. */
const MEASURED: FleetCeilingReport = {
  burn: {
    kind: "measured",
    overlapHours: 120.4,
    planWeeksDrawn: 1.44,
    planWeeksPerWorkingSeatHour: 0.002,
    workingSeatHours: 720.4,
  },
  ceiling: {
    burnPerWorkingSeatHour: 0.002,
    kind: "measured",
    plans: [
      {
        hoursToReset: 48,
        observedAtIso: "2026-10-04T00:00:00.000Z",
        planAlias: "alpha",
        resetAtIso: "2026-10-06T00:00:00.000Z",
        spendCap: 0.95,
        sustainablePlanWeeksPerHour: 0.0073,
        utilization: 0.6,
      },
      {
        hoursToReset: 4,
        observedAtIso: "2026-10-04T00:00:00.000Z",
        planAlias: "beta",
        resetAtIso: "2026-10-04T04:00:00.000Z",
        spendCap: 1,
        sustainablePlanWeeksPerHour: 0.025,
        utilization: 0.9,
      },
    ],
    seats: 9,
    sustainablePlanWeeksPerHour: 0.0323,
  },
  combinedUnusedShareUpperBound: 0.2,
  fromIso: "2026-09-27T00:00:00.000Z",
  observedExpiredPlanWeeks: 2,
  planAliases: ["alpha", "beta"],
  problems: ["a reader problem"],
  seats: {
    coveredHours: 150,
    meanOpenSeats: 20.04,
    meanWorkingSeats: 6,
    peakOpenSeats: 27,
    peakWorkingSeats: 12,
    samples: 300,
    unknownHours: 18,
    widestGapSeconds: 3600,
    workingSeatHours: 900,
  },
  toIso: "2026-10-04T00:00:00.000Z",
  uncountedPlans: [],
  unusedByPlan: [
    { expiredWindows: 1, planAlias: "alpha", unusedPlanWeeksUpperBound: 0.25, widestLastReadingToResetSeconds: 7200 },
    { expiredWindows: 1, planAlias: "beta", unusedPlanWeeksUpperBound: 0.15, widestLastReadingToResetSeconds: 1800 },
  ],
  unusedPlanWeeksUpperBound: 0.4,
};

/** A week where nothing could be measured: no reset seen, no tick, no burn. */
const UNKNOWN: FleetCeilingReport = {
  burn: { kind: "unmeasurable", reason: "alpha has no run of weekly readings in the span" },
  ceiling: { kind: "unmeasurable", reason: "the burn per working seat is unknown — alpha has no run" },
  combinedUnusedShareUpperBound: null,
  fromIso: "2026-09-27T00:00:00.000Z",
  observedExpiredPlanWeeks: 0,
  planAliases: ["alpha"],
  problems: [],
  seats: {
    coveredHours: 0,
    meanOpenSeats: null,
    meanWorkingSeats: null,
    peakOpenSeats: null,
    peakWorkingSeats: null,
    samples: 0,
    unknownHours: 168,
    widestGapSeconds: null,
    workingSeatHours: 0,
  },
  toIso: "2026-10-04T00:00:00.000Z",
  uncountedPlans: ["alpha: no weekly window was observed resetting in the span, so it is not counted"],
  unusedByPlan: [
    { expiredWindows: 0, planAlias: "alpha", unusedPlanWeeksUpperBound: null, widestLastReadingToResetSeconds: null },
  ],
  unusedPlanWeeksUpperBound: null,
};

describe("fleetCeilingHeadline", () => {
  it("does the arithmetic for the owner when every figure was measured", () => {
    expect(fleetCeilingHeadline({ report: MEASURED })).toBe(
      "Over the last 7 days the Claude plans left at most 0.4 of one plan's week unused (≤20% of the 2 plan-weeks " +
        "that reset); 6 seats were working on average (peak 12) out of 20 open; at the measured burn the plans " +
        "can carry 9 working seats until they reset.",
    );
  });

  it("says each figure is unknown rather than zero when nothing was observed", () => {
    expect(fleetCeilingHeadline({ report: UNKNOWN })).toBe(
      "Over the last 7 days no Claude plan's week was observed resetting in this span, so what was left unused " +
        "is unknown; no supervisor tick saw the fleet, so how many seats worked is unknown; how many working " +
        "seats the plans can carry is unknown: the burn per working seat is unknown — alpha has no run.",
    );
  });
});

describe("renderFleetCeilingLines", () => {
  it("prints the headline, then every figure behind it, the runway, and the problems", () => {
    expect(renderFleetCeilingLines({ report: MEASURED })).toEqual([
      fleetCeilingHeadline({ report: MEASURED }),
      "",
      "span: 2026-09-27T00:00:00.000Z → 2026-10-04T00:00:00.000Z; plans: alpha, beta",
      "left unused at each weekly reset (an upper bound — use can rise after the last reading):",
      "  alpha: ≤25% of a week over 1 reset(s), last reading ≤2h before it",
      "  beta: ≤15% of a week over 1 reset(s), last reading ≤0.5h before it",
      "seats: 300 ticks; 150h seen, 18h unknown (a gap over 40 minutes between ticks is unknown, never idle)",
      "burn: one working seat draws 5% of a plan's week a day (fleet average: 1.4 plan-weeks drawn over 720 " +
        "working seat-hours, across 120.4h where a tick and every plan were read together)",
      "runway now (what each plan has left to its cap, spread over the hours to its reset):",
      "  alpha: 60% used of a 95% cap, resets 2026-10-06T00:00:00.000Z (48h)",
      "  beta: 90% used of a 100% cap, resets 2026-10-04T04:00:00.000Z (4h)",
      "problem: a reader problem",
    ]);
  });

  it("names a plan with no observed reset, prints the unmeasurable burn, and omits the runway", () => {
    expect(renderFleetCeilingLines({ report: UNKNOWN })).toEqual([
      fleetCeilingHeadline({ report: UNKNOWN }),
      "",
      "span: 2026-09-27T00:00:00.000Z → 2026-10-04T00:00:00.000Z; plans: alpha",
      "left unused at each weekly reset (an upper bound — use can rise after the last reading):",
      "  alpha: no reset observed in the span",
      "seats: 0 ticks; 0h seen, 168h unknown (a gap over 40 minutes between ticks is unknown, never idle)",
      "burn: unmeasurable — alpha has no run of weekly readings in the span",
      "uncounted plan: alpha: no weekly window was observed resetting in the span, so it is not counted",
    ]);
  });
});
