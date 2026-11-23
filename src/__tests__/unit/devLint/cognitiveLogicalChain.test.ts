import { describe, expect, it } from "vitest";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { countAndRuns, flattenLogical, isLogicalOperator } from "../../../devLint/cognitiveLogicalChain.js";

/** Flatten the sole expression statement of `text`, returning the operator chain and leaf texts. */
function flattenOf({ text }: { text: string }): { chain: readonly string[]; leaves: readonly string[] } {
  return withSourceFile({
    fileName: "fixture.ts",
    text,
    use: (sf) => {
      const statement = sf.statements[0] as ts.ExpressionStatement;
      const { chain, leaves } = flattenLogical({ node: statement.expression });
      return { chain, leaves: leaves.map((leaf) => leaf.getText(sf)) };
    },
  });
}

describe("isLogicalOperator", () => {
  it("accepts && || ?? and refuses +", () => {
    expect(isLogicalOperator({ kind: ts.SyntaxKind.AmpersandAmpersandToken })).toBe(true);
    expect(isLogicalOperator({ kind: ts.SyntaxKind.BarBarToken })).toBe(true);
    expect(isLogicalOperator({ kind: ts.SyntaxKind.QuestionQuestionToken })).toBe(true);
    expect(isLogicalOperator({ kind: ts.SyntaxKind.PlusToken })).toBe(false);
  });
});

describe("flattenLogical", () => {
  it("reads operators and leaves left to right", () => {
    expect(flattenOf({ text: "a && b || c ?? d;" })).toEqual({
      chain: ["&&", "||", "??"],
      leaves: ["a", "b", "c", "d"],
    });
  });

  it("treats a non-logical expression as one leaf", () => {
    expect(flattenOf({ text: "a + b;" })).toEqual({ chain: [], leaves: ["a + b"] });
  });
});

describe("countAndRuns", () => {
  it("charges one per run of &&", () => {
    expect(countAndRuns({ chain: ["&&", "&&", "||", "&&"] })).toBe(2);
  });

  it("never charges || or ??", () => {
    expect(countAndRuns({ chain: ["||", "??"] })).toBe(0);
  });
});
