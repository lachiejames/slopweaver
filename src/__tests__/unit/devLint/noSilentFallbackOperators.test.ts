import { describe, expect, it } from "vitest";
import { type ts, withSourceFile } from "#lib/tsSyntax.js";
import { operatorOf } from "../../../devLint/noSilentFallbackOperators.js";

/** The classification of the initializer of the first `const` in `text`, which must be a binary expression. */
function classify({ text }: { text: string }): string | undefined {
  return withSourceFile({
    fileName: "fixture.ts",
    text,
    use: (sf) => {
      const statement = sf.statements[0] as ts.VariableStatement;
      const node = statement.declarationList.declarations[0]!.initializer as ts.BinaryExpression;
      return operatorOf({ node });
    },
  });
}

describe("operatorOf", () => {
  it("labels a nullish coalesce whatever its right operand", () => {
    expect(classify({ text: "const a = x ?? y;" })).toBe("??");
  });

  it("labels || only when its right operand is a value literal", () => {
    expect(classify({ text: 'const a = x || "-";' })).toBe("||-literal");
    expect(classify({ text: "const a = x || -1;" })).toBe("||-literal");
    expect(classify({ text: 'const a = x || ("-" as const);' })).toBe("||-literal");
    expect(classify({ text: "const a = x || y;" })).toBeUndefined();
  });

  it("leaves other operators alone", () => {
    expect(classify({ text: "const a = x && y;" })).toBeUndefined();
  });
});
