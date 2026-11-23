/*
 * `compareCoverage` against the repo-wide floor: a drop on any metric fails, a lag past the stale headroom asks
 * for a rebaseline, and float noise at the boundary is neither.
 */
import { describe, expect, it } from "vitest";

import { compareCoverage } from "../../../../devLint/coverageFloor.js";
import { baseline, measurement } from "./harness.js";

describe("compareCoverage — the repo floor", () => {
  it("passes when every metric equals the floor", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 80, f: 85, l: 85, s: 85 }),
    });
    expect(verdict).toEqual({ drops: [], ok: true, stale: [], unfloored: [] });
  });

  it("passes when coverage is higher by exactly the stale headroom", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 82, f: 87, l: 87, s: 87 }),
    });
    expect(verdict.ok).toBe(true);
  });

  it("is stale when a metric is higher than the floor by more than the headroom", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 80, f: 85, l: 85, s: 87.01 }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.drops).toEqual([]);
    expect(verdict.stale.map((entry) => entry.message)).toEqual([
      "statements: floor 85% lags measured 87.01% by more than 2 points",
    ]);
  });

  it("is not stale on float noise at the headroom boundary", () => {
    // 87.1 - 85.1 is 1.9999999999999858 in doubles; 85.3 - 83.3 is 2.0000000000000142. Neither is a lag.
    const verdict = compareCoverage({
      baseline: baseline({ b: 85.1, f: 83.3, l: 85, s: 85 }),
      current: measurement({ b: 87.1, f: 85.3, l: 85, s: 85 }),
    });
    expect(verdict.ok).toBe(true);
  });

  it("fails when line coverage drops", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 80, f: 85, l: 84.99, s: 85 }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.drops).toEqual([{ message: "lines: 84.99% < floor 85%", subject: "lines" }]);
  });

  it("fails when branch coverage drops", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 79, f: 85, l: 85, s: 85 }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.drops.map((drop) => drop.message)).toEqual(["branches: 79% < floor 80%"]);
  });

  it("reports a drop on one metric and staleness on another in the same verdict", () => {
    const verdict = compareCoverage({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 79, f: 85, l: 85, s: 90 }),
    });
    expect(verdict.drops.map((drop) => drop.message)).toEqual(["branches: 79% < floor 80%"]);
    expect(verdict.stale.map((entry) => entry.message)).toEqual([
      "statements: floor 85% lags measured 90% by more than 2 points",
    ]);
  });
});
