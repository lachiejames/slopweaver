/**
 * `./idleCapacitySeats.ts` directly. The gate's verdicts over a measured seat ceiling are
 * `idleCapacityGate.test.ts`'s; this pins the three pieces it is assembled from.
 */
import { describe, expect, it } from "vitest";

import { owedScopeOf, refusalSeatFieldsOf, seatFillOf } from "../../../supervisor/idleCapacitySeats.js";

/** Sources whose capacity carries `workingSeatCeiling` and whose watch lists sessions in `states`. */
function sourcesWith({ ceiling, states }: { ceiling: unknown; states: readonly string[] }): unknown {
  return {
    capacity: { facts: { workingSeatCeiling: ceiling }, status: "read" },
    watch: { facts: { rows: states.map((state) => ({ state })) }, status: "read" },
  };
}

describe("seatFillOf", () => {
  it("opens with no fill and no problem on a capture that carries no seat ceiling", () => {
    expect(seatFillOf({ sources: { capacity: { facts: {}, status: "read" } } })).toStrictEqual({
      fill: null,
      kind: "open",
      problem: null,
    });
  });

  it("opens with no fill when the draft carries no capacity observation at all", () => {
    expect(seatFillOf({ sources: "not sources" })).toStrictEqual({ fill: null, kind: "open", problem: null });
  });

  it("decides unreadable on a seat ceiling that is not an object", () => {
    expect(seatFillOf({ sources: sourcesWith({ ceiling: 4, states: [] }) })).toStrictEqual({
      kind: "decided",
      verdict: {
        kind: "unreadable",
        why: "the draft's capacity observation carries a workingSeatCeiling that is neither a whole seat count nor a reason",
      },
    });
  });

  it("decides unreadable below a measured N when the draft carries no watch observation", () => {
    const seats = seatFillOf({
      sources: { capacity: { facts: { workingSeatCeiling: { kind: "measured", seats: 3 } }, status: "read" } },
    });

    expect(seats).toStrictEqual({
      kind: "decided",
      verdict: {
        kind: "unreadable",
        why: "the draft carries no watch observation, so how many seats work is unread",
      },
    });
  });

  it("opens with the reason on an unmeasurable ceiling", () => {
    const seats = seatFillOf({
      sources: sourcesWith({ ceiling: { kind: "unmeasurable", reason: "no burn" }, states: [] }),
    });

    expect(seats).toStrictEqual({ fill: null, kind: "open", problem: "no burn" });
  });

  it("opens with the fill below N, and decides clean at N", () => {
    const below = seatFillOf({
      sources: sourcesWith({ ceiling: { kind: "measured", seats: 3 }, states: ["working", "needs-input"] }),
    });
    const at = seatFillOf({
      sources: sourcesWith({ ceiling: { kind: "measured", seats: 1 }, states: ["working", "needs-input"] }),
    });

    expect(below).toStrictEqual({ fill: { ceiling: 3, working: 1 }, kind: "open", problem: null });
    expect(at).toStrictEqual({ kind: "decided", verdict: { kind: "clean" } });
  });
});

describe("owedScopeOf", () => {
  it("owes the first N − working rows and wants the machine named, below a measured N", () => {
    const scope = owedScopeOf({
      bindingCeilingId: "claude:plan-one",
      seats: { fill: { ceiling: 3, working: 1 }, problem: null },
      unseated: ["a", "b", "c"],
    });

    expect(scope).toStrictEqual({ ceilingId: "machine", rows: ["a", "b"] });
  });

  it("owes every row and wants the binding ceiling named, with no measured N", () => {
    const scope = owedScopeOf({
      bindingCeilingId: "claude:plan-one",
      seats: { fill: null, problem: null },
      unseated: ["a", "b", "c"],
    });

    expect(scope).toStrictEqual({ ceilingId: "claude:plan-one", rows: ["a", "b", "c"] });
  });
});

describe("refusalSeatFieldsOf", () => {
  it("carries the fill and N below a measured ceiling", () => {
    expect(refusalSeatFieldsOf({ seats: { fill: { ceiling: 5, working: 2 }, problem: null } })).toStrictEqual({
      ceilingMeasurementProblem: null,
      seatsOwed: 3,
      workingSeatCeiling: 5,
      workingSeats: 2,
    });
  });

  it("carries only the reason when N was not measured", () => {
    expect(refusalSeatFieldsOf({ seats: { fill: null, problem: "no burn" } })).toStrictEqual({
      ceilingMeasurementProblem: "no burn",
      seatsOwed: null,
      workingSeatCeiling: null,
      workingSeats: null,
    });
  });
});
