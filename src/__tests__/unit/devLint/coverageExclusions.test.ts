/**
 * The pin on the coverage EXCLUDE list.
 *
 * Coverage has two dials, not one. Everyone watches the floor; the denominator is the quiet one. Adding an
 * exclusion RAISES the reported percentage while REDUCING what is examined, so it moves the number the
 * "right" way and reads in a diff as tidying up rather than as lowering a bar.
 *
 * Measured on this tree before this pin existed: adding a single line, `"src/cli/**"` (3,665 statements at
 * 59.4%), took statements from 74.7% to 81.07% and branches from 70.3% to 74.89% — and the floor gate
 * printed `clean`.
 *
 * This test cannot make an exclusion impossible; it is as editable as the list. It makes one impossible to
 * add QUIETLY, which is the whole claim: the list and this literal must change together, in one visible diff.
 * Adding a genuinely-untestable path is fine — update both, and let the diff show it.
 */

import { describe, expect, it } from "vitest";
import { COVERAGE_EXCLUDE } from "../../../devLint/coverageExclude.js";

describe("COVERAGE_EXCLUDE", () => {
  it("is exactly this list — change it here and in config/vitest/base.ts together, never silently", () => {
    expect([...COVERAGE_EXCLUDE]).toEqual([
      "src/__tests__/**",
      "src/**/*.entry.ts",
      "src/**/index.ts",
      "eval/**",
      "hooks/**",
      "stubs/**",
      "coverage/**",
      "dist/**",
      "**/*.config.ts",
    ]);
  });

  it("does not exclude any first-party source directory", () => {
    // The failure this guards: `src/cli/**`-shaped entries, which retire a whole subsystem from measurement.
    // The three `src/` entries above are narrow by construction — tests, entry shims, and barrel re-exports.
    const sourceDirExclusions = COVERAGE_EXCLUDE.filter((pattern) => /^src\/[a-z]+\/\*\*$/.test(pattern));
    expect(sourceDirExclusions).toEqual([]);
  });
});
