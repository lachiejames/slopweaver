import { describe, expect, it } from "vitest";
import { lintSummaryLine } from "../../../../devLint/lintVerdict.js";

describe("lintSummaryLine", () => {
  it("times a passing gate, so the ceiling stays re-measurable from an ordinary lap", () => {
    expect(lintSummaryLine({ result: { elapsedMs: 3400, name: "prettier", ok: true } })).toBe("  ✓ prettier (3.4s)");
  });

  it("marks a failing gate without claiming it hung", () => {
    expect(lintSummaryLine({ result: { elapsedMs: 12_000, name: "oxlint", ok: false } })).toBe("  ✗ oxlint (12.0s)");
  });

  it("says a killed gate was killed, rather than leaving it indistinguishable from a real finding", () => {
    expect(lintSummaryLine({ result: { elapsedMs: 600_000, hung: true, name: "door-coverage", ok: false } })).toBe(
      "  ✗ door-coverage (600.0s) — HUNG, killed at the ceiling",
    );
  });

  it("omits the timing when there is none to report", () => {
    expect(lintSummaryLine({ result: { name: "knip", ok: true } })).toBe("  ✓ knip");
  });

  it("says a withheld gate was NOT run and why, rather than drawing it as a finding", () => {
    expect(lintSummaryLine({ result: { name: "oxlint", ok: false, withheld: "a lap holds this machine" } })).toBe(
      "  – oxlint — NOT RUN, withheld: a lap holds this machine",
    );
  });
});
