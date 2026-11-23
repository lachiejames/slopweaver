/**
 * The two seat figures the fleet-ceiling page (`./fleetCeilingReport.ts`) and its Queue card (`./fleetCeilingAsk.ts`)
 * both speak, in one place so the page and the card can never state a different headroom. Pure.
 */
import type { FleetCeilingReport } from "../../capacity/seatCeiling.js";

/**
 * The largest seat count spelled out. A near-zero burn divides into an N no fleet could reach; past this the page
 * says "over 999", so no headline grows with the number.
 */
const SEAT_FIGURE_MAX = 999;

/**
 * A seat count to one decimal place without a trailing `.0`, or "over 999" past what is spelled out.
 *
 * @returns the figure as written
 */
export function seatFigure({ value }: { value: number }): string {
  if (value > SEAT_FIGURE_MAX) {
    return `over ${String(SEAT_FIGURE_MAX)}`;
  }
  return String(Math.round(value * 10) / 10);
}

/**
 * How many more WHOLE working seats the plans could have carried than worked, or `null` when either side is
 * unmeasured. The difference is worked out here so the owner never subtracts.
 *
 * @param report the measurement
 * @returns the whole-seat headroom, never negative, or null
 */
export function seatHeadroom({ report }: { report: FleetCeilingReport }): number | null {
  const mean = report.seats.meanWorkingSeats;
  if (mean === null || report.ceiling.kind === "unmeasurable") {
    return null;
  }
  return Math.max(0, Math.floor(report.ceiling.seats - mean));
}
