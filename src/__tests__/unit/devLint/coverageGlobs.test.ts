/**
 * The pin on coverage-glob ANCHORING — the other way to shrink the denominator.
 *
 * `coverageExclusions.test.ts` pins what the list SAYS. This pins where it says it. Vitest matches these
 * patterns with picomatch `contains: true` against each file's absolute path, so an unanchored entry is
 * satisfied by any directory in the path — including directories the repo does not own.
 *
 * Measured on this tree before anchoring existed: `eval/**` (meant for the top-level `eval/` directory) also
 * matched `src/retrieval/**` and `src/eval/**`, retiring 24 first-party source files (592 statements) from
 * the measured denominator in every checkout, CI included — and the floor gate printed `clean`. A checkout
 * whose own leaf directory ends in `coverage` lost the report entirely: 0 of 0 statements.
 *
 * The two properties below are what stop that returning: every anchored pattern is rooted, and rooting it
 * changes nothing about which repo-relative path it names.
 */

import { describe, expect, it } from "vitest";
import { COVERAGE_EXCLUDE } from "../../../devLint/coverageExclude.js";
import { anchorCoverageGlobs } from "../../../devLint/coverageGlobs.js";

describe("anchorCoverageGlobs", () => {
  it("prefixes every pattern with the root, in order", () => {
    expect([...anchorCoverageGlobs({ patterns: ["src/**/*.ts", "eval/**"], root: "/repo" })]).toEqual([
      "/repo/src/**/*.ts",
      "/repo/eval/**",
    ]);
  });

  it("tolerates the trailing slash that fileURLToPath(new URL('.', …)) produces", () => {
    expect([...anchorCoverageGlobs({ patterns: ["coverage/**"], root: "/a/b/" })]).toEqual(["/a/b/coverage/**"]);
  });

  it("passes an already-absolute pattern through untouched", () => {
    expect([...anchorCoverageGlobs({ patterns: ["/tmp/x/**"], root: "/repo" })]).toEqual(["/tmp/x/**"]);
  });

  it("returns nothing for no patterns", () => {
    expect([...anchorCoverageGlobs({ patterns: [], root: "/repo" })]).toEqual([]);
  });

  it("anchors the whole real exclude list, so no parent directory can satisfy an entry", () => {
    // The failure this guards: a checkout at `…/integration-lane-coverage`, where the unanchored
    // `coverage/**` matched every source file and both lanes reported 0/0.
    const root = "/checkouts/integration-lane-coverage";
    const anchored = anchorCoverageGlobs({ patterns: COVERAGE_EXCLUDE, root });
    expect(anchored.map((pattern) => pattern.slice(0, root.length + 1))).toEqual(
      COVERAGE_EXCLUDE.map(() => `${root}/`),
    );
  });

  it("keeps the repo-relative tail of every entry exactly as the list wrote it", () => {
    const anchored = anchorCoverageGlobs({ patterns: COVERAGE_EXCLUDE, root: "/repo" });
    expect(anchored.map((pattern) => pattern.replace("/repo/", ""))).toEqual([...COVERAGE_EXCLUDE]);
  });
});
