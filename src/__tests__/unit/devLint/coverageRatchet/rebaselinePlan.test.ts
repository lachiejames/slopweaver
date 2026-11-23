/*
 * `rebaselinePlan`: every floor rewritten one point under its measurement, never lowered, version 2, a large
 * directory floored, and a lowering refused by name.
 */
import { describe, expect, it } from "vitest";

import { MIN_DIRECTORY_STATEMENTS, rebaselinePlan } from "../../../../devLint/coverageFloor.js";
import { CoverageFloorErrors } from "../../../../devLint/coverageFloorErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { BIG, baseline, measurement, metrics } from "./harness.js";

describe("rebaselinePlan", () => {
  it("writes every metric one point under the measurement, never below the committed floor", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 82, f: 86, l: 85.5, s: 88 }),
    });
    expect(plan.isOk()).toBe(true);
    // lines: 85.5 - 1 = 84.5 is under the committed 85, so the floor holds at 85.
    expect(unwrap(plan).summary).toEqual({ branches: 81, functions: 85, lines: 85, statements: 87 });
  });

  it("writes version 2", () => {
    const plan = rebaselinePlan({
      baseline: { directories: {}, summary: metrics({ b: 80, f: 85, l: 85, s: 85 }), version: 1 },
      current: measurement({ b: 82, f: 86, l: 87, s: 88 }),
    });
    expect(unwrap(plan).version).toBe(2);
  });

  it("rounds the ratcheted floor to two decimals", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 1, f: 1, l: 1, s: 1 }),
      current: measurement({ b: 71.72, f: 73.83, l: 74.42, s: 74.39 }),
    });
    expect(unwrap(plan).summary).toEqual({ branches: 70.72, functions: 72.83, lines: 73.42, statements: 73.39 });
  });

  it("refuses to lower any metric, naming the offender", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({ b: 80, f: 85, l: 84, s: 85 }),
    });
    expect(plan.isErr()).toBe(true);
    expect(unwrapErr(plan).message).toBe("rebaseline refused — would lower: lines");
  });

  it("floors every directory at the size cut one point under its measurement", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({
        b: 80,
        directories: {
          "src/cli": { statementCount: BIG, statements: 57.81 },
          "src/tiny": { statementCount: MIN_DIRECTORY_STATEMENTS - 1, statements: 100 },
        },
        f: 85,
        l: 85,
        s: 85,
      }),
    });
    expect(unwrap(plan).directories).toEqual({ "src/cli": { statements: 56.81 } });
  });

  it("never lowers a directory floor already committed", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85, directories: { "src/cli": { statements: 57 } } }),
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 57.5 } },
      }),
    });
    expect(unwrap(plan).directories).toEqual({ "src/cli": { statements: 57 } });
  });

  it("refuses when a directory is under its floor, naming the directory", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85, directories: { "src/cli": { statements: 57 } } }),
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 56 } },
      }),
    });
    expect(plan.isErr()).toBe(true);
    expect(unwrapErr(plan)).toEqual(CoverageFloorErrors.rebaselineWouldLower({ subjects: ["src/cli statements"] }));
  });

  it("keeps the floor of a directory that shrank under the size cut, and drops one no longer measured", () => {
    const plan = rebaselinePlan({
      baseline: baseline({
        b: 80,
        directories: { "src/gone": { statements: 90 }, "src/shrunk": { statements: 70 } },
        f: 85,
        l: 85,
        s: 85,
      }),
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/shrunk": { statementCount: 5, statements: 80 } },
      }),
    });
    expect(unwrap(plan).directories).toEqual({ "src/shrunk": { statements: 70 } });
  });

  it("orders directory floors by name", () => {
    const plan = rebaselinePlan({
      baseline: baseline({ b: 80, f: 85, l: 85, s: 85 }),
      current: measurement({
        b: 80,
        directories: {
          "src/zeta": { statementCount: BIG, statements: 50 },
          "src/alpha": { statementCount: BIG, statements: 50 },
        },
        f: 85,
        l: 85,
        s: 85,
      }),
    });
    expect(Object.keys(unwrap(plan).directories)).toEqual(["src/alpha", "src/zeta"]);
  });
});
