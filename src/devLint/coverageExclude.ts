/**
 * What coverage does NOT count — the denominator, and therefore the second dial on the coverage gate.
 *
 * Everyone watches the floor. This is the quiet one: adding an entry here RAISES the reported percentage
 * while REDUCING what is examined, so it moves the number the "right" way and reads in a diff as
 * housekeeping rather than as lowering a bar.
 *
 * Measured on this tree before this list was pinned: adding one line, `"src/cli/**"` (3,665 statements at
 * 59.4%), took statements from 74.7% to 81.07% and branches from 70.3% to 74.89% — and the floor gate
 * printed `clean`.
 *
 * It lives under `src/` rather than beside the Vitest config it feeds because `tsconfig.json` sets
 * `rootDir: src`, so a unit test cannot import anything above it — and a list nothing can import is a list
 * nothing can pin. `config/vitest/base.ts` imports it from here.
 *
 * Pinned by `coverageExclusions.test.ts`. That does not make an exclusion impossible — the test is as
 * editable as the list — it makes one impossible to add QUIETLY: both must change together, in one diff.
 */

/**
 * The source files coverage measures, before {@link COVERAGE_EXCLUDE}. One constant because two readers need
 * it: Vitest, to decide what to report, and the coverage ratchet, to refuse a report that left one out.
 */
export const COVERAGE_INCLUDE = "src/**/*.ts";

/** Paths excluded from coverage measurement. Pinned by a unit test; change both together, never silently. */
export const COVERAGE_EXCLUDE: readonly string[] = [
  "src/__tests__/**",
  "src/**/*.entry.ts",
  "src/**/index.ts",
  "eval/**",
  "hooks/**",
  "stubs/**",
  "coverage/**",
  "dist/**",
  "**/*.config.ts",
];
