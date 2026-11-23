/*
 * `vitestMeasures`: which root-relative paths a real Vitest coverage run measures, dot files, URL suffixes,
 * the repository's exclusions and Vitest's forced ones included.
 */
import { describe, expect, it } from "vitest";

import { vitestMeasures } from "../../../../devLint/coverageCompleteness.js";
import { COVERAGE_EXCLUDE } from "../../../../devLint/coverageExclude.js";
import { measuredHere } from "./harness.js";

describe("vitestMeasures — Vitest's own coverage matcher", () => {
  it("measures a dot-prefixed file and directory, as `dot: true` does", () => {
    expect(measuredHere("src/.hidden.ts")).toBe(true);
    expect(measuredHere("src/.cache/a.ts")).toBe(true);
    expect(measuredHere("src/a/.index.ts")).toBe(true);
    expect(measuredHere("src/.__tests__/a.ts")).toBe(true);
  });

  it("cleans a `?` or `#` URL suffix off first, as Vitest's `cleanUrl` does", () => {
    // `src/q?mark.ts` is matched as `src/q`, so a complete report never names it.
    expect([measuredHere("src/q?mark.ts"), measuredHere("src/hash#mark.ts"), measuredHere("src/ok.ts")]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("excludes what the repository excludes, dot-prefixed or not", () => {
    expect(measuredHere("src/__tests__/.x.ts")).toBe(false);
    expect(measuredHere("src/pkg/index.ts")).toBe(false);
    expect(measuredHere("src/cli/run.entry.ts")).toBe(false);
  });

  it("excludes a path an exclusion matches only as a prefix, as `contains: true` does", () => {
    // A directory named like an excluded file hides what is under it from a real run.
    expect(measuredHere("src/pkg/index.ts/hidden.ts")).toBe(false);
    expect(measuredHere("src/__x00__dir/inside.ts")).toBe(false);
  });

  it("excludes Vitest's forced exclusions whatever the config says", () => {
    // `src/__x00__generated.ts` is left out of every real report, and asking for it reddened a whole one.
    expect(measuredHere("src/__x00__generated.ts")).toBe(false);
    expect(measuredHere("src/a/node_modules/dep/x.ts")).toBe(false);
    expect(measuredHere("src/virtual:mod.ts")).toBe(false);
  });

  it("anchors the repository's exclusions at the root, so a directory above it cannot match one", () => {
    expect(vitestMeasures({ exclude: COVERAGE_EXCLUDE, root: "/home/coverage" })("src/a.ts")).toBe(true);
    expect(measuredHere("src/ok.ts")).toBe(true);
  });
});
