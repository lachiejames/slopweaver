/**
 * The per-expression reader: what ONE expression reads as before any name crosses a file, the input the
 * whole-tree resolver is handed.
 */
import { describe, expect, it } from "vitest";
import {
  expressionFactOf,
  isConstList,
  type ShapeExpressionFact,
  unwrapTypeOnly,
} from "../../../devLint/errorShapeThresholdExpression.js";
import { ts, withSourceFile } from "../../../lib/tsSyntax.js";

/** The file's last top-level variable statement, read by `use`. */
function readLast<T>({ text, use }: { text: string; use: (statement: ts.VariableStatement) => T }): T {
  return withSourceFile({
    fileName: "src/x/a.ts",
    text,
    use: (sf) => {
      const statement = sf.statements.at(-1) as ts.VariableStatement;
      return use(statement);
    },
  });
}

/** What the last top-level `const`'s initializer reads as. */
function factOf({ text }: { text: string }): ShapeExpressionFact {
  return readLast({
    text,
    use: (statement) =>
      expressionFactOf({ node: statement.declarationList.declarations[0]!.initializer!, seen: new Set() }),
  });
}

describe("expressionFactOf", () => {
  it("normalises a template's holes and leaves a module-level name for the resolver", () => {
    expect(factOf({ text: "const a = `could not read ${path} at ${line}`;" })).toEqual({
      kind: "shape",
      shape: "could not read {} at {}",
    });
    expect(factOf({ text: "const a = USAGE;" })).toEqual({ kind: "name", name: "USAGE" });
  });

  it("keeps both arms of a conditional and every item of a list, dropping only an all-unresolved one", () => {
    expect(factOf({ text: 'const a = ok ? "yes" : [NAME, "no"];' })).toEqual({
      kind: "conditional",
      whenFalse: {
        items: [
          { kind: "name", name: "NAME" },
          { kind: "shape", shape: "no" },
        ],
        kind: "list",
      },
      whenTrue: { kind: "shape", shape: "yes" },
    });
    expect(factOf({ text: "const a = [x.message, `${y}`];" })).toEqual({ kind: "unresolved" });
  });

  it("reads a spread item as the expression it spreads, and a spread of a property read as unresolved", () => {
    expect(factOf({ text: 'const a = [...(bad ? ["refused"] : []), ...REST];' })).toEqual({
      items: [
        {
          kind: "conditional",
          whenFalse: { kind: "unresolved" },
          whenTrue: { items: [{ kind: "shape", shape: "refused" }], kind: "list" },
        },
        { kind: "name", name: "REST" },
      ],
      kind: "list",
    });
    expect(factOf({ text: "const a = [...parsed.error];" })).toEqual({ kind: "unresolved" });
  });
});

describe("unwrapTypeOnly and isConstList", () => {
  it("strips a type-only wrapper down to the literal and tells const from let", () => {
    const unwrapped = readLast({
      text: 'const a = ("text" as string)!;',
      use: (statement) => unwrapTypeOnly({ node: statement.declarationList.declarations[0]!.initializer! }).kind,
    });
    expect(unwrapped).toBe(ts.SyntaxKind.StringLiteral);
    expect(
      readLast({ text: "const a = 1;", use: (statement) => isConstList({ list: statement.declarationList }) }),
    ).toBe(true);
    expect(readLast({ text: "let a = 1;", use: (statement) => isConstList({ list: statement.declarationList }) })).toBe(
      false,
    );
  });
});
