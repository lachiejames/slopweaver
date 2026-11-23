/**
 * The idle-capacity gate's capture half — what a tick's capacity capture settles before any row is read, and
 * the ceiling a row's reason must name when it settles nothing. Every case asserts the whole answer.
 */
import { describe, expect, it } from "vitest";

import { admittedCeilingOf } from "../../../supervisor/idleCapacityCeilings.js";

/** The one route through `claude:plan-one`, bound by that plan at 20% headroom. */
const ROUTE = {
  driver: "claude",
  headroom: 0.2,
  limitingCeilingId: "claude:plan-one",
  planCeilingId: "claude:plan-one",
};

/** The machine ceiling, open at load 3.77 of a hold of 22. */
const MACHINE = {
  headroom: 0.83,
  id: "machine",
  kind: "machine",
  reason: null,
  status: "open",
  windows: [{ available: 22, resetAtIso: null, used: 3.77, window: "load1" }],
};

/** A plan ceiling with this headroom and status. */
function plan({ headroom, status, reason }: { headroom: number; status: string; reason: string | null }): object {
  return {
    headroom,
    id: "claude:plan-one",
    kind: "claude",
    reason,
    status,
    windows: [{ available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 80, window: "seven-day" }],
  };
}

/** A ceilings reading whose plan has headroom, so the route binds on it. */
const OPEN_CEILINGS = {
  ceilings: [MACHINE, plan({ headroom: 0.2, reason: null, status: "open" })],
  lowest: "claude:plan-one",
  observedAtIso: "2026-09-28T09:00:00.000Z",
  problems: [],
  routes: [ROUTE],
  selectedRoute: ROUTE,
};

/** A ceilings reading whose one plan is measured spent. */
const SPENT_CEILINGS = {
  ceilings: [MACHINE, plan({ headroom: 0, reason: "seven_day refused", status: "refusing" })],
  lowest: null,
  observedAtIso: "2026-09-28T09:00:00.000Z",
  problems: [],
  routes: [],
  selectedRoute: null,
};

/** A draft's sources: these capacity facts, and a gauge naming this next all-models plan. */
function sourcesWith({
  capacityFacts,
  nextAllModels,
}: {
  capacityFacts: Record<string, unknown>;
  nextAllModels: string | null;
}): Record<string, unknown> {
  return {
    capacity: { facts: { holdSubjects: [], load1: 3.77, ...capacityFacts }, status: "read" },
    gauge: { facts: { nextAllModels }, status: "read" },
  };
}

describe("admittedCeilingOf", () => {
  describe("a capture from before ceilings existed", () => {
    it("is open with no binding when the machine is free and the gauge names a plan", () => {
      const sources = sourcesWith({ capacityFacts: { hold: false }, nextAllModels: "plan-four" });
      expect(admittedCeilingOf({ held: false, sources })).toEqual({
        bindingCeilingId: null,
        ceilings: null,
        kind: "open",
      });
    });

    it("is clean when the machine held", () => {
      const sources = sourcesWith({ capacityFacts: { hold: true }, nextAllModels: "plan-four" });
      expect(admittedCeilingOf({ held: true, sources })).toEqual({ kind: "decided", verdict: { kind: "clean" } });
    });

    it("is clean when the gauge was read and names no plan — Ceiling A, measured", () => {
      const sources = sourcesWith({ capacityFacts: { hold: false }, nextAllModels: null });
      expect(admittedCeilingOf({ held: false, sources })).toEqual({ kind: "decided", verdict: { kind: "clean" } });
    });
  });

  describe("a capture carrying ceilings", () => {
    it("is open, bound by the lowest unused ceiling on the route, whatever the gauge says", () => {
      const sources = sourcesWith({ capacityFacts: { ceilings: OPEN_CEILINGS, hold: false }, nextAllModels: null });
      const admitted = admittedCeilingOf({ held: false, sources });
      expect(admitted.kind).toBe("open");
      expect((admitted as { bindingCeilingId: string | null }).bindingCeilingId).toBe("claude:plan-one");
      expect((admitted as { ceilings: { lowest: string | null } }).ceilings.lowest).toBe("claude:plan-one");
    });

    it("is clean when every plan was measured spent", () => {
      const sources = sourcesWith({
        capacityFacts: { ceilings: SPENT_CEILINGS, hold: false },
        nextAllModels: "plan-four",
      });
      expect(admittedCeilingOf({ held: false, sources })).toEqual({ kind: "decided", verdict: { kind: "clean" } });
    });

    it("is unreadable when the legacy hold contradicts an open machine ceiling", () => {
      const sources = sourcesWith({ capacityFacts: { ceilings: OPEN_CEILINGS, hold: true }, nextAllModels: "p" });
      expect(admittedCeilingOf({ held: true, sources })).toEqual({
        kind: "decided",
        verdict: {
          kind: "unreadable",
          why: "the draft's capacity observation says the machine is held where its ceilings say it is not, or the reverse",
        },
      });
    });

    it("is unreadable when the ceilings do not parse, even on a held tick", () => {
      const sources = sourcesWith({ capacityFacts: { ceilings: { lowest: 7 }, hold: true }, nextAllModels: "p" });
      const admitted = admittedCeilingOf({ held: true, sources });
      expect(admitted.kind).toBe("decided");
      expect((admitted as { verdict: { kind: string } }).verdict.kind).toBe("unreadable");
      expect((admitted as { verdict: { why: string } }).verdict.why).toContain(
        "the draft's capacity observation carries ceilings that do not parse",
      );
    });
  });
});
