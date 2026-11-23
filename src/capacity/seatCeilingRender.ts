/**
 * `./seatCeiling.ts`'s report in the owner's words: a headline that does the arithmetic for them, then every figure
 * behind it with what it does and does not claim.
 *
 * The `≤` on an unused figure is never dropped — each is an upper bound (`./unused.ts`) — and a seat count is
 * always WORKING seats, never a bare "seats", because an open seat at `needs-input` draws nothing.
 */
import type { SeatBurnMeasurement } from "./seatBurn.js";
import type { FleetCeilingReport, WorkingSeatCeiling } from "./seatCeiling.js";

/** A number to one decimal place, without a trailing `.0`. */
function oneDecimal({ value }: { value: number }): string {
  return String(Math.round(value * 10) / 10);
}

/** A 0..1 share as a whole percentage. */
function percent({ share }: { share: number }): string {
  return `${String(Math.round(share * 100))}%`;
}

/** The left-on-the-table clause. */
function unusedClause({ report }: { report: FleetCeilingReport }): string {
  if (report.unusedPlanWeeksUpperBound === null || report.combinedUnusedShareUpperBound === null) {
    return "no Claude plan's week was observed resetting in this span, so what was left unused is unknown";
  }
  return (
    `the Claude plans left at most ${oneDecimal({ value: report.unusedPlanWeeksUpperBound })} of one plan's week ` +
    `unused (≤${percent({ share: report.combinedUnusedShareUpperBound })} of the ` +
    `${String(report.observedExpiredPlanWeeks)} plan-weeks that reset)`
  );
}

/** The seats-that-ran clause. */
function seatsClause({ report }: { report: FleetCeilingReport }): string {
  const { seats } = report;
  if (seats.meanWorkingSeats === null || seats.meanOpenSeats === null) {
    return "no supervisor tick saw the fleet, so how many seats worked is unknown";
  }
  return (
    `${oneDecimal({ value: seats.meanWorkingSeats })} seats were working on average ` +
    `(peak ${String(seats.peakWorkingSeats)}) out of ${oneDecimal({ value: seats.meanOpenSeats })} open`
  );
}

/** The ceiling clause. */
function ceilingClause({ ceiling }: { ceiling: WorkingSeatCeiling }): string {
  if (ceiling.kind === "unmeasurable") {
    return `how many working seats the plans can carry is unknown: ${ceiling.reason}`;
  }
  return `at the measured burn the plans can carry ${String(ceiling.seats)} working seats until they reset`;
}

/**
 * The one sentence the owner reads first.
 *
 * @param report the measurement
 * @returns the headline, every figure in it already worked out
 */
export function fleetCeilingHeadline({ report }: { report: FleetCeilingReport }): string {
  const days = Math.round((Date.parse(report.toIso) - Date.parse(report.fromIso)) / (24 * 3_600_000));
  return (
    `Over the last ${String(days)} days ${unusedClause({ report })}; ${seatsClause({ report })}; ` +
    `${ceilingClause({ ceiling: report.ceiling })}.`
  );
}

/** The burn line. */
function burnLine({ burn }: { burn: SeatBurnMeasurement }): string {
  if (burn.kind === "unmeasurable") {
    return `burn: unmeasurable — ${burn.reason}`;
  }
  return (
    `burn: one working seat draws ${percent({ share: burn.planWeeksPerWorkingSeatHour * 24 })} of a plan's week a day ` +
    `(fleet average: ${oneDecimal({ value: burn.planWeeksDrawn })} plan-weeks drawn over ` +
    `${String(Math.round(burn.workingSeatHours))} working seat-hours, across ${oneDecimal({ value: burn.overlapHours })}h ` +
    "where a tick and every plan were read together)"
  );
}

/**
 * The headline, then every figure behind it.
 *
 * @param report the measurement
 * @returns the lines `fleet ceiling` prints
 */
export function renderFleetCeilingLines({ report }: { report: FleetCeilingReport }): readonly string[] {
  const { seats } = report;
  const lines = [
    fleetCeilingHeadline({ report }),
    "",
    `span: ${report.fromIso} → ${report.toIso}; plans: ${report.planAliases.join(", ")}`,
    "left unused at each weekly reset (an upper bound — use can rise after the last reading):",
    ...report.unusedByPlan.map((plan) => {
      if (plan.unusedPlanWeeksUpperBound === null || plan.widestLastReadingToResetSeconds === null) {
        return `  ${plan.planAlias}: no reset observed in the span`;
      }
      return (
        `  ${plan.planAlias}: ≤${percent({ share: plan.unusedPlanWeeksUpperBound })} of a week over ` +
        `${String(plan.expiredWindows)} reset(s), last reading ≤` +
        `${oneDecimal({ value: plan.widestLastReadingToResetSeconds / 3600 })}h before it`
      );
    }),
    `seats: ${String(seats.samples)} ticks; ${oneDecimal({ value: seats.coveredHours })}h seen, ` +
      `${oneDecimal({ value: seats.unknownHours })}h unknown (a gap over 40 minutes between ticks is unknown, never idle)`,
    burnLine({ burn: report.burn }),
  ];
  if (report.ceiling.kind === "measured") {
    lines.push(
      "runway now (what each plan has left to its cap, spread over the hours to its reset):",
      ...report.ceiling.plans.map(
        (plan) =>
          `  ${plan.planAlias}: ${percent({ share: plan.utilization })} used of a ${percent({ share: plan.spendCap })} cap, ` +
          `resets ${plan.resetAtIso} (${String(Math.round(plan.hoursToReset))}h)`,
      ),
    );
  }
  lines.push(
    ...report.problems.map((problem) => `problem: ${problem}`),
    ...report.uncountedPlans.map((plan) => `uncounted plan: ${plan}`),
  );
  return lines;
}
