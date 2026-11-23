/**
 * Where each seat sits on the sessions page: workers in the board's order of urgency, then the empty slots that pad
 * the page to its configured capacity.
 *
 * Pure: values in, values out.
 */
import { priorityIndex } from "../handover/rowKind.js";
import type { FleetSeat, SeatPriority } from "./types.js";

/** A band's place in the order, `unassigned` after every board band. */
function seatRank({ priority }: { priority: SeatPriority }): number {
  return priority === "unassigned" ? 4 : priorityIndex({ priority });
}

/**
 * Order two workers by priority band, then title — the board's own order of urgency.
 *
 * @returns negative when `left` sits first, positive when `right` does, zero when they tie
 */
export function compareSeats({ left, right }: { left: FleetSeat; right: FleetSeat }): number {
  const byBand = seatRank({ priority: left.priority }) - seatRank({ priority: right.priority });
  if (byBand !== 0) {
    return byBand;
  }
  return left.rowTitle.localeCompare(right.rowTitle);
}

/**
 * The empty slots that pad the page to its configured capacity, numbered after the seats already on it.
 *
 * @param count how many slots are free
 * @param after how many seats precede them on the page
 * @returns one red, empty seat per free slot
 */
export function emptySeats({ count, after }: { count: number; after: number }): FleetSeat[] {
  return Array.from({ length: count }, (_, index) => ({
    colour: "red",
    detail: "Empty.",
    flashing: false,
    priority: "unassigned",
    role: "empty",
    rowTitle: "Empty seat",
    seatId: `slot-${String(after + index + 1)}`,
  }));
}
