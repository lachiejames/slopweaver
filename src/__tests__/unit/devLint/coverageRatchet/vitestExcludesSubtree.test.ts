/*
 * `vitestExcludesSubtree`: the walk prunes a directory only when Vitest excludes every path under it.
 */
import { describe, expect, it } from "vitest";

import { vitestExcludesSubtree } from "../../../../devLint/coverageCompleteness.js";
import { COVERAGE_EXCLUDE } from "../../../../devLint/coverageExclude.js";
import { ROOT } from "./harness.js";

describe("vitestExcludesSubtree", () => {
  const prunedHere = vitestExcludesSubtree({ exclude: COVERAGE_EXCLUDE, root: ROOT });

  it("prunes a directory every path under which Vitest excludes", () => {
    expect(prunedHere("src/__tests__")).toBe(true);
    expect(prunedHere("src/pkg/index.ts")).toBe(true);
    expect(prunedHere("src/__x00__dir")).toBe(true);
    expect(prunedHere("src/a/node_modules")).toBe(true);
  });

  it("walks a directory that holds measured files", () => {
    expect(prunedHere("src/pkg")).toBe(false);
    expect(prunedHere("src/.cache")).toBe(false);
  });
});
