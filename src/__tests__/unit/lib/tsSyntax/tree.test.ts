/**
 * The TypeScript syntax seam's tree half, on inline fixtures: the lending parse, and every helper that hides a name
 * TypeScript 7 renamed or dropped. The module-specifier readers are in the sibling files of this directory.
 */

import { describe, expect, it } from "vitest";
import { err, ok, unwrap } from "#lib/result.js";
import {
  bindingElementsOf,
  forEachChild,
  hasModifier,
  isAssignmentOperator,
  isCaseOrDefaultClause,
  isClassLikeDeclaration,
  isConstDeclaration,
  isFunctionLikeDeclaration,
  isMethodSignatureDeclaration,
  isParameterDeclaration,
  isPropertySignatureDeclaration,
  isStringLiteralLikeNode,
  isTypeAssertion,
  type LentAnswer,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";

/** Lend `use` every node of a parsed snippet, in pre-order, and answer what it answers. */
function withNodesOf<R>({
  text,
  fileName = "x.ts",
  use,
}: {
  text: string;
  fileName?: string;
  use: (nodes: readonly ts.Node[]) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({
    fileName,
    text,
    use: (source) => {
      const nodes: ts.Node[] = [];
      const visit: NodeVisitor = (node) => {
        nodes.push(node);
        forEachChild({ node, visit });
      };
      visit(source);
      return use(nodes);
    },
  });
}

/** The kinds of the nodes a guard accepts, in source order. */
function accepted({ text, guard }: { text: string; guard: (node: ts.Node) => boolean }): readonly ts.SyntaxKind[] {
  return withNodesOf({
    text,
    use: (nodes): readonly ts.SyntaxKind[] => nodes.filter((node) => guard(node)).map((node) => node.kind),
  });
}

describe("withSourceFile", () => {
  it("sets every parent, so a walker can climb from any node", () => {
    const statementParentIsFile = withSourceFile({
      fileName: "x.ts",
      text: "const a = f(b);",
      use: (source) => source.statements[0]!.parent === source,
    });
    const callParent = withNodesOf({
      text: "const a = f(b);",
      use: (nodes) => nodes.find((node) => ts.isCallExpression(node))!.parent.kind,
    });
    expect(callParent).toBe(ts.SyntaxKind.VariableDeclaration);
    expect(statementParentIsFile).toBe(true);
  });

  it("infers JSX from a .tsx name, reads .ts as no JSX, and honours an explicit kind", () => {
    const text = "const a = <b />;";
    const jsxIn = ({ fileName }: { fileName: string }): boolean =>
      withNodesOf({ fileName, text, use: (nodes) => nodes.some((node) => ts.isJsxSelfClosingElement(node)) });
    const forced = withSourceFile({
      fileName: "x.ts",
      scriptKind: ts.ScriptKind.TSX,
      text,
      use: (source) => [ts.isVariableStatement(source.statements[0]!), source.statements[0]!.getText(source)],
    });
    expect(jsxIn({ fileName: "x.tsx" })).toBe(true);
    expect(jsxIn({ fileName: "x.ts" })).toBe(false);
    expect(forced).toEqual([true, "const a = <b />;"]);
  });

  // The lean parse this case once compared the full one against went with the 7.1 move; it set a JSDoc mode
  // TypeScript 7.1 does not offer.
  // deleted-with-code: JSDocParsingMode
  it("builds a tree a forEachChild walk reads node for node, each statement's parent its file", () => {
    const text = '/** @type {import("./t.js").T} */\nconst a = f(<b />, "c");';
    const read = withSourceFile({
      fileName: "x.tsx",
      text,
      use: (source): { readonly count: number; readonly parented: boolean } => {
        let count = 0;
        const visit: NodeVisitor = (node) => {
          count += 1;
          forEachChild({ node, visit });
        };
        visit(source);
        return { count, parented: source.statements[0]!.parent === source };
      },
    });
    expect(read).toEqual({ count: 12, parented: true });
  });

  it("answers exactly what `use` answers", () => {
    expect(withSourceFile({ fileName: "x.ts", text: "a;", use: () => 7 })).toBe(7);
  });

  it("refuses at compile time a `use` answering a node anywhere in its answer, or a promise", () => {
    // Each `@ts-expect-error` is the witness: the typecheck fails if any of these shapes ever compiles. They sit in a
    // function that is typechecked and never CALLED, so the test itself never lets a lease escape.
    const at = { fileName: "x.ts", text: "a;" };
    const typecheckedNeverRun = (): void => {
      // @ts-expect-error the tree itself
      withSourceFile({ ...at, use: (source) => source });
      // @ts-expect-error a node in an array
      withSourceFile({ ...at, use: (source) => [source.statements[0]!] });
      // @ts-expect-error a node in a property
      withSourceFile({ ...at, use: (source) => ({ first: source.statements[0]! }) });
      // @ts-expect-error a node two levels down, in a Map's value
      withSourceFile({ ...at, use: (source) => ({ byKind: new Map([[source.kind, source.statements]]) }) });
      // @ts-expect-error a node five properties down, the deepest level it promises
      withSourceFile({ ...at, use: (source) => ({ a: { b: { c: { d: { e: source } } } } }) });
      // @ts-expect-error a promise, which reads the tree after it is released
      withSourceFile({ ...at, use: async (source) => source.statements.length });
      // @ts-expect-error a returned closure, which a type cannot see has captured the tree
      withSourceFile({ ...at, use: (source) => () => source.statements[0]!.getText(source) });
      // @ts-expect-error a closure in a property
      withSourceFile({ ...at, use: (source) => ({ readLater: () => source.text }) });
      // @ts-expect-error a node inside a Result's value
      withSourceFile({ ...at, use: (source) => ok(source.statements[0]!) });
      // @ts-expect-error a node inside a Result's error
      withSourceFile({ ...at, use: (source) => err(source) });
    };
    void typecheckedNeverRun;
    const plain = withSourceFile({
      ...at,
      use: (source) => ({ kinds: source.statements.map((statement) => statement.kind), text: source.text }),
    });
    expect(plain).toEqual({ kinds: [ts.SyntaxKind.ExpressionStatement], text: "a;" });
    const result = withSourceFile({ ...at, use: (source) => ok(source.statements.length) });
    expect(unwrap(result)).toBe(1);
  });
});

describe("forEachChild", () => {
  it("visits direct children in order and stops at the first truthy answer", () => {
    const [answer, seen] = withSourceFile({
      fileName: "x.ts",
      text: "a; b; c;",
      use: (source) => {
        const visited: string[] = [];
        const stopped = forEachChild({
          node: source,
          visit: (child) => {
            visited.push(child.getText(source));
            return child.getText(source) === "b;" ? "stopped" : undefined;
          },
        });
        return [stopped, visited] as const;
      },
    });
    expect(answer).toBe("stopped");
    expect(seen).toEqual(["a;", "b;"]);
  });

  it("answers undefined when no visit answers", () => {
    const answer = withSourceFile({
      fileName: "x.ts",
      text: "a;",
      use: (source) => forEachChild({ node: source, visit: () => undefined }),
    });
    expect(answer).toBe(undefined);
  });
});

describe("hasModifier", () => {
  it("reads a keyword modifier and ignores a decorator", () => {
    const verdicts = withSourceFile({
      fileName: "x.ts",
      text: "export const a = 1;\nconst b = 2;",
      use: ({ statements: [exported, plain] }) => [
        hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: exported! }),
        hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: plain! }),
        hasModifier({ kind: ts.SyntaxKind.DefaultKeyword, node: exported! }),
      ],
    });
    expect(verdicts).toEqual([true, false, false]);
  });

  it("answers false for a node that cannot carry modifiers at all", () => {
    const verdict = withSourceFile({
      fileName: "x.ts",
      text: "a;",
      use: (source) => hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: source.statements[0]! }),
    });
    expect(verdict).toBe(false);
  });
});

describe("isConstDeclaration", () => {
  it("is true for const and await using, false for let, var and using", () => {
    const text = "const a = 1; let b = 2; var c = 3; async function f() { await using d = e; using g = h; }";
    const verdicts = withNodesOf({
      text,
      use: (nodes) =>
        nodes
          .filter((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node))
          .map((declaration) => [declaration.name.getText(), isConstDeclaration({ declaration })]),
    });
    expect(verdicts).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
      ["d", true],
      ["g", false],
    ]);
  });
});

describe("isAssignmentOperator", () => {
  it("is true for each of the sixteen assignment operators and false for every comparison or logical look-alike", () => {
    const assignments = "a = b; a += b; a -= b; a *= b; a **= b; a /= b; a %= b; a <<= b; a >>= b; a >>>= b;";
    const compounds = "a &= b; a |= b; a ^= b; a ||= b; a &&= b; a ??= b;";
    const lookAlikes = "a == b; a === b; a != b; a !== b; a <= b; a >= b; a + b; a || b; a && b; a ?? b; a in b;";
    const verdicts = withNodesOf({
      text: `${assignments} ${compounds} ${lookAlikes}`,
      use: (nodes) =>
        nodes
          .filter((node): node is ts.BinaryExpression => ts.isBinaryExpression(node))
          .map((node) => [node.operatorToken.getText(), isAssignmentOperator({ kind: node.operatorToken.kind })]),
    });
    expect(verdicts).toEqual([
      ["=", true],
      ["+=", true],
      ["-=", true],
      ["*=", true],
      ["**=", true],
      ["/=", true],
      ["%=", true],
      ["<<=", true],
      [">>=", true],
      [">>>=", true],
      ["&=", true],
      ["|=", true],
      ["^=", true],
      ["||=", true],
      ["&&=", true],
      ["??=", true],
      ["==", false],
      ["===", false],
      ["!=", false],
      ["!==", false],
      ["<=", false],
      [">=", false],
      ["+", false],
      ["||", false],
      ["&&", false],
      ["??", false],
      ["in", false],
    ]);
  });
});

describe("bindingElementsOf", () => {
  it("leaves an array pattern's holes out and keeps every element that binds", () => {
    const names = withNodesOf({
      text: "const [, a, , b] = c; const { d, e: f } = g;",
      use: (nodes) =>
        nodes
          .filter(
            (node): node is ts.BindingPattern => ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node),
          )
          .map((pattern) => bindingElementsOf({ pattern }).map((element) => element.name.getText())),
    });
    expect(names).toEqual([
      ["a", "b"],
      ["d", "f"],
    ]);
  });
});

describe("the guards TypeScript 7 renamed", () => {
  it("each accepts exactly its TS6 counterpart's nodes", () => {
    const text = [
      "class A { m(p: string) {} }",
      "const B = class {};",
      "interface I { s(): void; q: string }",
      'const t = "s" + `u`;',
      "const v = <number>w;",
      "switch (x) { case 1: break; default: break; }",
      "const f = () => 1;",
    ].join("\n");
    const kind = ts.SyntaxKind;
    expect(accepted({ guard: isClassLikeDeclaration, text })).toEqual([kind.ClassDeclaration, kind.ClassExpression]);
    expect(accepted({ guard: isFunctionLikeDeclaration, text })).toEqual([
      kind.MethodDeclaration,
      kind.MethodSignature,
      kind.ArrowFunction,
    ]);
    expect(accepted({ guard: isMethodSignatureDeclaration, text })).toEqual([kind.MethodSignature]);
    expect(accepted({ guard: isParameterDeclaration, text })).toEqual([kind.Parameter]);
    expect(accepted({ guard: isPropertySignatureDeclaration, text })).toEqual([kind.PropertySignature]);
    expect(accepted({ guard: isStringLiteralLikeNode, text })).toEqual([
      kind.StringLiteral,
      kind.NoSubstitutionTemplateLiteral,
    ]);
    expect(accepted({ guard: isTypeAssertion, text })).toEqual([kind.TypeAssertionExpression]);
    expect(accepted({ guard: isCaseOrDefaultClause, text })).toEqual([kind.CaseClause, kind.DefaultClause]);
  });
});
