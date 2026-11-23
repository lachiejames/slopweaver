/*
 * The per-directory floor: `compareCoverage` holds a floored directory and refuses a large unfloored one, and
 * `unmeasuredFloors`, `unreportedSourceFiles` and `directoriesWithSources` name what a partial report left out.
 */
import { describe, expect, it } from "vitest";

import { directoriesWithSources, unreportedSourceFiles } from "../../../../devLint/coverageCompleteness.js";
import { compareCoverage, MIN_DIRECTORY_STATEMENTS, unmeasuredFloors } from "../../../../devLint/coverageFloor.js";
import { BIG, baseline, measuredHere, measurement } from "./harness.js";

describe("compareCoverage — the per-directory floor", () => {
  const FLOORED = baseline({ b: 80, f: 85, l: 85, s: 85, directories: { "src/cli": { statements: 56.81 } } });

  it("passes a directory at its floor", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 56.81 } },
      }),
    });
    expect(verdict.ok).toBe(true);
  });

  it("fails a directory under its floor while the repo total holds", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 56.8 } },
      }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.drops).toEqual([
      { message: "src/cli statements: 56.8% < floor 56.81%", subject: "src/cli statements" },
    ]);
  });

  it("refuses a directory at the size cut with no floor as unfloored", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        directories: {
          "src/cli": { statementCount: BIG, statements: 60 },
          "src/new": { statementCount: MIN_DIRECTORY_STATEMENTS, statements: 12.5 },
        },
        f: 85,
        l: 85,
        s: 85,
      }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.drops).toEqual([]);
    expect(verdict.unfloored).toEqual([
      {
        message: `src/new: ${String(MIN_DIRECTORY_STATEMENTS)} statements at 12.5% and no floor`,
        subject: "src/new",
      },
    ]);
  });

  it("ignores a directory one statement under the size cut with no floor", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        directories: {
          "src/cli": { statementCount: BIG, statements: 60 },
          "src/tiny": { statementCount: MIN_DIRECTORY_STATEMENTS - 1, statements: 0 },
        },
        f: 85,
        l: 85,
        s: 85,
      }),
    });
    expect(verdict.ok).toBe(true);
  });

  it("still holds a floored directory that has shrunk under the size cut", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: 10, statements: 50 } },
      }),
    });
    expect(verdict.drops.map((drop) => drop.message)).toEqual(["src/cli statements: 50% < floor 56.81%"]);
  });

  it("does not fail a floored directory that is no longer measured at all", () => {
    const verdict = compareCoverage({ baseline: FLOORED, current: measurement({ b: 80, f: 85, l: 85, s: 85 }) });
    expect(verdict.ok).toBe(true);
  });

  it("names a floored directory still on disk that the report left out, which is a partial report", () => {
    const shortfalls = unmeasuredFloors({
      baseline: FLOORED,
      current: measurement({ b: 80, f: 85, l: 85, s: 85 }),
      onDisk: new Set(["src/cli"]),
    });
    expect(shortfalls).toEqual([
      {
        message: "src/cli statements: floored at 56.81% and still on disk, but the report measured nothing under it",
        subject: "src/cli statements",
      },
    ]);
  });

  it("lets a floored directory that is gone from disk go unmeasured, since its floor went with it", () => {
    expect(
      unmeasuredFloors({ baseline: FLOORED, current: measurement({ b: 80, f: 85, l: 85, s: 85 }), onDisk: new Set() }),
    ).toEqual([]);
  });

  it("names nothing when the floored directory on disk was measured", () => {
    const current = measurement({
      b: 80,
      f: 85,
      l: 85,
      s: 85,
      directories: { "src/cli": { statementCount: 10, statements: 50 } },
    });
    expect(unmeasuredFloors({ baseline: FLOORED, current, onDisk: new Set(["src/cli"]) })).toEqual([]);
  });

  it("names a source file the report left out inside a directory it still measured", () => {
    // Counterexample: one measured file marked the whole directory measured.
    expect(
      unreportedSourceFiles({
        measured: measuredHere,
        reported: ["src/a/covered.ts"],
        sources: ["src/a/omitted.ts", "src/a/covered.ts"],
      }),
    ).toEqual(["src/a/omitted.ts"]);
  });

  it("does not ask the report for a file coverage excludes", () => {
    expect(
      unreportedSourceFiles({
        measured: measuredHere,
        reported: [],
        sources: ["src/__tests__/unit/x.test.ts", "src/cli/index.ts", "src/cli/run.entry.ts"],
      }),
    ).toEqual([]);
  });

  it("reads a directory as on disk only when it holds a source file coverage measures", () => {
    const buckets = directoriesWithSources({
      measured: measuredHere,
      sources: ["src/a.ts", "src/cli/run.ts", "src/only/index.ts", "src/__tests__/unit/x.test.ts"],
    });
    expect([...buckets]).toEqual(["src", "src/cli"]);
  });

  it("names nothing when the report names every included source file", () => {
    expect(
      unreportedSourceFiles({
        measured: measuredHere,
        reported: ["src/a.ts", "src/b/c.ts"],
        sources: ["src/b/c.ts", "src/a.ts"],
      }),
    ).toEqual([]);
  });

  it("does not stale-check a directory — only the repo totals demand a rebaseline", () => {
    const verdict = compareCoverage({
      baseline: FLOORED,
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 99 } },
      }),
    });
    expect(verdict.ok).toBe(true);
  });
});
