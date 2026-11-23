/**
 * One measured `FleetCeilingReport`, shaped like a live reading: about 13% of two plans' week
 * unused, 4.2 working seats on average against a ceiling of 6. Shared by the card's own tests and the
 * recipe runner's, so both read the same week.
 */
import type { FleetCeilingReport } from "../capacity/seatCeiling.js";

/**
 * A measured report, overridable field by field.
 *
 * @param over the fields a case changes
 * @returns the report
 */
export function measuredFleetCeilingReport(over: Partial<FleetCeilingReport> = {}): FleetCeilingReport {
  return {
    burn: {
      kind: "measured",
      overlapHours: 96,
      planWeeksDrawn: 2.8,
      planWeeksPerWorkingSeatHour: 0.007,
      workingSeatHours: 400,
    },
    ceiling: {
      burnPerWorkingSeatHour: 0.007,
      kind: "measured",
      plans: [],
      seats: 6,
      sustainablePlanWeeksPerHour: 0.042,
    },
    combinedUnusedShareUpperBound: 0.13,
    fromIso: "2026-09-28T06:00:00.000Z",
    observedExpiredPlanWeeks: 2,
    planAliases: ["max-a", "max-b"],
    problems: [],
    seats: {
      coveredHours: 150,
      meanOpenSeats: 9,
      meanWorkingSeats: 4.2,
      peakOpenSeats: 14,
      peakWorkingSeats: 11,
      samples: 300,
      unknownHours: 18,
      widestGapSeconds: 3600,
      workingSeatHours: 630,
    },
    toIso: "2026-10-05T06:00:00.000Z",
    uncountedPlans: [],
    unusedByPlan: [
      { expiredWindows: 1, planAlias: "max-a", unusedPlanWeeksUpperBound: 0.2, widestLastReadingToResetSeconds: 300 },
      { expiredWindows: 1, planAlias: "max-b", unusedPlanWeeksUpperBound: 0.06, widestLastReadingToResetSeconds: 120 },
    ],
    unusedPlanWeeksUpperBound: 0.26,
    ...over,
  };
}
