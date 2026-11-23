/**
 * `seatTickOf` — pure: one parsed tick ledger row in, its seat counts out, or nothing when the tick saw no fleet.
 */
import { describe, expect, it } from "vitest";
import { seatTickOf } from "../../../capacity/seatCeilingRead.js";

const AT = "2026-10-04T00:00:00.000Z";

/** A tick row whose watch source reads `status` over `states`. */
function row({ status, states }: { status: string; states: readonly string[] }): unknown {
  return {
    sources: { watch: { facts: { rows: states.map((state) => ({ state })) }, observedAtIso: AT, status } },
  };
}

describe("seatTickOf", () => {
  it("counts every listed session as open and only the working ones as working", () => {
    const tick = seatTickOf({ row: row({ states: ["working", "needs-input", "working"], status: "read" }) });

    expect(tick).toEqual({ observedAtIso: AT, openSeats: 3, workingSeats: 2 });
  });

  it("counts a partial watch reading", () => {
    const tick = seatTickOf({ row: row({ states: ["working"], status: "partial" }) });

    expect(tick).toEqual({ observedAtIso: AT, openSeats: 1, workingSeats: 1 });
  });

  it("reads a tick whose watch saw no fleet as no tick, never as zero seats", () => {
    expect(seatTickOf({ row: row({ states: [], status: "unavailable" }) })).toBe(undefined);
    expect(seatTickOf({ row: { sources: { watch: { status: "read" } } } })).toBe(undefined);
    expect(seatTickOf({ row: "not a row" })).toBe(undefined);
  });
});
