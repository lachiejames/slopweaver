/**
 * `wholeTreeJudges.ts`: what one program's own words mean to the whole-tree guard.
 */
import { describe, expect, it } from "vitest";

import { judgeSlopweaver, NOT_WHOLE_TREE, TSC_SCRIPT } from "../../../admit/wholeTreeJudges.js";

describe("judgeSlopweaver", () => {
  it("refuses the whole lint lap", () => {
    expect(judgeSlopweaver({ args: ["dev", "lint"] })).toEqual({
      kind: "whole-tree",
      what: "slopweaver dev lint (the whole lint lap, tsgolint included)",
    });
  });

  it.each([[["dev", "lint", "--only", "hygiene"]], [["dev", "lint", "--lane", "local"]], [["dev", "build"]], [[]]])(
    "allows `slopweaver %j`",
    (args) => {
      expect(judgeSlopweaver({ args })).toEqual(NOT_WHOLE_TREE);
    },
  );
});

describe("TSC_SCRIPT", () => {
  it.each([
    ["node_modules/typescript/lib/tsc.js", true],
    ["./node_modules/.bin/tsc", true],
    ["/x/typescript/bin/tsc", true],
    ["/x/typescript/lib/_tsc.js", true],
    ["src/tsc.ts", false],
    ["scripts/typecheck.js", false],
  ])("reads `%s` as the compiler: %s", (path, expected) => {
    expect(TSC_SCRIPT.test(path)).toBe(expected);
  });
});
