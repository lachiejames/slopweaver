/**
 * Where each seat sits on the sessions page: the board's order of urgency, then the empty slots.
 */
import { describe, expect, it } from "vitest";

import { compareSeats, emptySeats } from "../../../fleet/seatOrder.js";
import type { FleetSeat } from "../../../fleet/types.js";

/** A green worker on a row, named by its title and band. */
function worker({ priority, rowTitle }: Pick<FleetSeat, "priority" | "rowTitle">): FleetSeat {
  return { colour: "green", detail: "d", flashing: false, priority, role: "worker", rowTitle, seatId: rowTitle };
}

describe("compareSeats", () => {
  it("puts a higher band first, then orders by title, and an unassigned seat after every band", () => {
    const seats = [
      worker({ priority: "unassigned", rowTitle: "a" }),
      worker({ priority: "p2", rowTitle: "b" }),
      worker({ priority: "p0", rowTitle: "z" }),
      worker({ priority: "p2", rowTitle: "a" }),
    ];
    expect(
      seats.toSorted((left, right) => compareSeats({ left, right })).map((seat) => `${seat.priority}:${seat.rowTitle}`),
    ).toEqual(["p0:z", "p2:a", "p2:b", "unassigned:a"]);
  });
});

describe("emptySeats", () => {
  it("numbers each free slot after the seats already on the page", () => {
    expect(emptySeats({ after: 3, count: 2 }).map((seat) => [seat.seatId, seat.colour, seat.role])).toEqual([
      ["slot-4", "red", "empty"],
      ["slot-5", "red", "empty"],
    ]);
  });

  it("pads nothing when no slot is free", () => {
    expect(emptySeats({ after: 15, count: 0 })).toEqual([]);
  });
});
