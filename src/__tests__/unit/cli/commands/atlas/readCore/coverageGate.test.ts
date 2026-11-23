/*
 * The coverage gate: a grounded atlas passes, a `not-fetched` exclusion and a deferred kind are refused and named, and
 * the refusal prints each row's remedy or says plainly that nothing was refused.
 */
import { describe, expect, it } from "vitest";

import {
  coverageGateRefuses,
  refusedCoverage,
  renderCoverageRefusal,
} from "../../../../../../cli/commands/atlas/coverageCore.js";
import { refusedSnapshot, snapshot } from "./harness.js";

describe("the coverage gate", () => {
  it("passes an atlas whose every exclusion is grounded and whose kinds are not deferred", () => {
    const refusal = refusedCoverage({ snapshot: snapshot() });
    expect(refusal.exclusions).toEqual([]);
    expect(refusal.deferred).toEqual([]);
    expect(coverageGateRefuses({ refusal })).toBe(false);
  });

  it("refuses a `not-fetched` exclusion and a deferred kind, and names both", () => {
    const refusal = refusedCoverage({ snapshot: refusedSnapshot() });
    expect(refusal.exclusions.length).toBe(1);
    expect(refusal.exclusions[0]?.because).toBe("modern account and zone Rulesets");
    expect(refusal.deferred).toEqual([
      { kind: "zone", reason: "17 of 32 declared page(s) reached", scope: "dashboard", surface: "dashboard" },
    ]);
    expect(coverageGateRefuses({ refusal })).toBe(true);
  });

  it("prints the remedy beside each refused row rather than only the complaint", () => {
    const lines = renderCoverageRefusal({ refusal: refusedCoverage({ snapshot: refusedSnapshot() }) });
    expect(lines).toContain("    would be closed by: the Rulesets reads");
    expect(lines).toContain("  deferred        zone  dashboard  dashboard");
  });

  it("says so explicitly when nothing is refused, so a clean gate is a line rather than a silence", () => {
    const lines = renderCoverageRefusal({ refusal: refusedCoverage({ snapshot: snapshot() }) });
    expect(lines).toEqual(["", "COVERAGE GATE  clean — every declared exclusion is grounded and no kind is deferred"]);
  });
});
