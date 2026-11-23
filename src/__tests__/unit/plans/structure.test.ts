/**
 * `structuralProblems` — what the register refuses about its rows taken together and the keys beside them: it reports
 * a problem from each source at once, and nothing for a register every source accepts.
 */
import { describe, expect, it } from "vitest";

import { structuralProblems } from "../../../plans/structure.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const plan = (over: Partial<RegisteredPlan>): RegisteredPlan => ({
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  storeDir: "/c1",
  usageLimitPercent: 100,
  ...over,
});

describe("structuralProblems", () => {
  it("reports nothing for distinct rows, one unpaused pin and no history", () => {
    const plans = [plan({ pinned: true }), plan({ alias: "plan-two", storeDir: "/c2" })];

    expect(structuralProblems({ document: { rows: [], version: 1 }, plans })).toStrictEqual([]);
  });

  it("reports a row-set problem and a removal-history problem together", () => {
    const plans = [plan({ pinned: true, paused: { reason: "lapsed", sinceIso: "2026-11-01T00:00:00.000Z" } })];

    expect(structuralProblems({ document: { removed: {}, rows: [], version: 1 }, plans })).toStrictEqual([
      "the pinned claude plan `plan-one` is paused; a pinned seat has nowhere to boot, so pin another plan or " +
        "`slopweaver plans unpin` this one before pausing it",
      "the register's `removed`, when present, must be an array",
    ]);
  });
});
