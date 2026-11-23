/*
 * `coverageComparisonReport` — what the compare branch prints and exits with. A drop and an unfloored
 * directory are refused; a stale floor is reported on stdout and never sets the exit code; no list
 * suppresses another, and the clean line prints only when all three are empty.
 */
import { describe, expect, it } from "vitest";

import { coverageComparisonReport } from "../../../devLint/coverageComparisonReport.js";
import { BIG, baseline, measurement } from "./coverageRatchet/harness.js";

const FLOOR = baseline({ b: 80, f: 85, l: 85, s: 85 });

describe("coverageComparisonReport", () => {
  it("prints the clean line and exits 0 when nothing fell, lagged or went unfloored", () => {
    const report = coverageComparisonReport({ baseline: FLOOR, current: measurement({ b: 80, f: 85, l: 85, s: 85 }) });

    expect(report).toEqual({
      exitCode: 0,
      stderr: "",
      stdout:
        'coverage-ratchet: clean (floor {"branches":80,"functions":85,"lines":85,"statements":85}, 0 directory floor(s))\n',
    });
  });

  it("reports a stale floor on stdout, exits 0 and never prints the clean line", () => {
    const report = coverageComparisonReport({
      baseline: FLOOR,
      current: measurement({ b: 80, f: 85, l: 85, s: 87.01 }),
    });

    expect(report).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "coverage-ratchet: 1 floor(s) lag the measurement by more than the ratchet's headroom — reported, not red\n",
        "  statements: floor 85% lags measured 87.01% by more than 2 points\n",
        "  raise them with `yarn coverage:rebaseline` after a full unit run, and commit the floor\n",
      ].join(""),
    });
  });

  it("refuses a drop under coverage-ratchet and exits 1", () => {
    const report = coverageComparisonReport({
      baseline: FLOOR,
      current: measurement({ b: 79, f: 85, l: 85, s: 85 }),
    });

    expect(report.exitCode).toBe(1);
    expect(report.stdout).toBe("");
    expect(report.stderr).toContain("  branches: 79% < floor 80%\n");
    expect(report.stderr).toContain("coverage dropped below the committed floor");
    expect(report.stderr).toContain("1 floor(s) not met");
    expect(report.stderr).not.toContain("unfloored");
  });

  it("refuses a large directory with no floor under coverage-ratchet-unfloored and exits 1", () => {
    const report = coverageComparisonReport({
      baseline: FLOOR,
      current: measurement({
        b: 80,
        f: 85,
        l: 85,
        s: 85,
        directories: { "src/cli": { statementCount: BIG, statements: 60 } },
      }),
    });

    expect(report.exitCode).toBe(1);
    expect(report.stdout).toBe("");
    expect(report.stderr).toContain(`  src/cli: ${String(BIG)} statements at 60% and no floor\n`);
    expect(report.stderr).toContain("a directory large enough to carry its own coverage floor has none");
    expect(report.stderr).toContain("1 unfloored directory(ies)");
    expect(report.stderr).not.toContain("floor(s) not met");
  });

  it("prints all three when a drop, an unfloored directory and a stale floor arrive together", () => {
    const report = coverageComparisonReport({
      baseline: FLOOR,
      current: measurement({
        b: 79,
        f: 85,
        l: 85,
        s: 90,
        directories: { "src/cli": { statementCount: BIG, statements: 60 } },
      }),
    });

    expect(report.exitCode).toBe(1);
    expect(report.stdout).toContain("  statements: floor 85% lags measured 90% by more than 2 points\n");
    expect(report.stderr).toContain("  branches: 79% < floor 80%\n");
    expect(report.stderr).toContain("1 floor(s) not met");
    expect(report.stderr).toContain(`  src/cli: ${String(BIG)} statements at 60% and no floor\n`);
    expect(report.stderr).toContain("1 unfloored directory(ies)");
  });
});
