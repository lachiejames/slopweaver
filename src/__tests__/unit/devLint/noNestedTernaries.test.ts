/**
 * The no-nested-ternaries gate's own tests: it must catch a ternary nested in either branch, chained or
 * parenthesised, and must NOT catch a single ternary or two unrelated ternaries on the same line.
 */
import { describe, expect, it } from "vitest";
import { isScannablePath, scanNoNestedTernaries } from "../../../devLint/noNestedTernaries.js";

/** Scan one snippet as if it were a source file. */
function hits({ content }: { content: string }): readonly string[] {
  return scanNoNestedTernaries({ content, path: "src/x.ts" }).map((hit) => `${String(hit.line)}`);
}

describe("scanNoNestedTernaries — the shapes it must catch", () => {
  it("catches a nested ternary in the whenFalse branch, chained with no parens", () => {
    expect(hits({ content: "const x = a ? 1 : b ? 2 : 3;\n" })).toEqual(["1"]);
  });

  it("catches a nested ternary in the whenFalse branch, parenthesised", () => {
    expect(hits({ content: "const x = a ? 1 : (b ? 2 : 3);\n" })).toEqual(["1"]);
  });

  it("catches a nested ternary in the whenTrue branch", () => {
    expect(hits({ content: "const x = a ? (b ? 1 : 2) : 3;\n" })).toEqual(["1"]);
  });

  it("catches both offending outer nodes in a three-deep chain", () => {
    expect(hits({ content: "const x = a ? 1 : b ? 2 : c ? 3 : 4;\n" })).toEqual(["1", "1"]);
  });

  it("reports the outer conditional's own line, not the inner one", () => {
    expect(hits({ content: "const x = a\n  ? 1\n  : b\n    ? 2\n    : 3;\n" })).toEqual(["1"]);
  });
});

describe("scanNoNestedTernaries — the shapes it must NOT catch", () => {
  it("allows a single ternary", () => {
    expect(hits({ content: "const x = a ? 1 : 2;\n" })).toEqual([]);
  });

  it("allows two unrelated ternaries on the same line, neither nested in the other", () => {
    expect(hits({ content: "const x = a ? 1 : 2;\nconst y = b ? 3 : 4;\n" })).toEqual([]);
  });

  it("allows a ternary in the condition of an unrelated ternary — that's the test, not a branch", () => {
    expect(hits({ content: "const x = (a ? 1 : 2) === 1 ? 3 : 4;\n" })).toEqual([]);
  });

  it("allows a lone ternary sitting beside an unrelated function", () => {
    expect(hits({ content: "const x = a ? 1 : 2;\nfunction f(): number {\n  return 1;\n}\n" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/cli/commands/github/core.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/y.ts" })).toBe(true);
  });

  it("does not scan its own source, which quotes the banned shape in its documentation", () => {
    expect(isScannablePath({ path: "src/devLint/noNestedTernaries.ts" })).toBe(false);
  });

  it("does not scan outside the source trees", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});
