/**
 * The sync-child-timeout gate's resolver modules, read directly: what a `timeout` value evaluates to as its own
 * file decides it, which declaration a name reaches, and which launcher a call is. The gate's own test drives
 * them through whole snippets; this one names the exact value at each step, so a wrong evaluation is visible as
 * the wrong number rather than only as a pass or a refusal.
 */

import { describe, expect, it } from "vitest";
import { type LentAnswer, ts, withSourceFile } from "#lib/tsSyntax.js";

import { decidedHere, memberNodeOf } from "../../../devLint/syncChildTimeoutLiteral.js";
import { declarationOf } from "../../../devLint/syncChildTimeoutScope.js";
import { callIsBounded, launcherOf } from "../../../devLint/syncChildTimeoutSyntax.js";
import { staticValueOf } from "../../../devLint/syncChildTimeoutValue.js";

/**
 * Parse a snippet whose LAST statement is `const probe = <expression>;` and hand that expression to `use`, which
 * must answer plain data: the tree is released when it returns.
 */
function withProbe<R>({
  content,
  use,
}: {
  content: string;
  use: (expression: ts.Expression) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({
    fileName: "probe.ts",
    text: content,
    scriptKind: ts.ScriptKind.TS,
    use: (sf) => {
      const last = sf.statements.at(-1) as ts.VariableStatement;
      return use(last.declarationList.declarations[0]!.initializer!);
    },
  });
}

/** Evaluate the probe expression with nothing followed yet. */
function valueOf({ content }: { content: string }): ReturnType<typeof staticValueOf> {
  return withProbe({ content, use: (node) => staticValueOf({ node, seen: new Set() }) });
}

describe("staticValueOf: a value its own file decides", () => {
  it("evaluates arithmetic, every modelled operator included", () => {
    expect(valueOf({ content: "const probe = 2 * 60_000;" })).toBe(120_000);
    expect(valueOf({ content: "const probe = 1 % 1;" })).toBe(0);
    expect(valueOf({ content: "const probe = 2 ** 3 - -1;" })).toBe(9);
  });

  it("follows a same-file const chain and a property of a same-file object", () => {
    expect(valueOf({ content: "const A = 3;\nconst B = A * 1_000;\nconst probe = B;" })).toBe(3_000);
    expect(valueOf({ content: "const L = { git: 5 };\nconst probe = L.git;" })).toBe(5);
  });

  it("reads a later spread's explicit undefined as the last word, and a missing key as undefined", () => {
    expect(valueOf({ content: "const L = { git: 5, ...{ git: undefined } };\nconst probe = L.git;" })).toBe(undefined);
    expect(valueOf({ content: "const L = { other: 5 };\nconst probe = L.git;" })).toBe(undefined);
  });

  it("reads a destructured const's own key, its default, and a property chain through nested literals", () => {
    expect(valueOf({ content: "const { t } = { t: 4 };\nconst probe = t;" })).toBe(4);
    expect(valueOf({ content: "const { git: ms = 5 } = { git: undefined };\nconst probe = ms;" })).toBe(5);
    expect(valueOf({ content: "const C = { a: { b: 6 } };\nconst probe = C.a.b;" })).toBe(6);
    expect(valueOf({ content: "const C = { a: { b: 6 } };\nconst { a } = C;\nconst probe = a.b;" })).toBe(6);
  });

  it("is opaque for a nested or rest element over a literal here, and dynamic over one decided elsewhere", () => {
    expect(valueOf({ content: "const { a: { b } } = { a: { b: 6 } };\nconst probe = b;" })).toBe("opaque");
    expect(valueOf({ content: "const [first] = [6];\nconst probe = first;" })).toBe("opaque");
    expect(valueOf({ content: 'import { C } from "./x.js";\nconst { a: { b } } = C;\nconst probe = b;' })).toBe(
      "dynamic",
    );
    expect(valueOf({ content: "const C = load();\nconst probe = C.a.b;" })).toBe("dynamic");
  });

  it("answers a short-circuit with the side JavaScript would", () => {
    expect(valueOf({ content: "const probe = 0 || 7;" })).toBe(7);
    expect(valueOf({ content: "const probe = 5 && 0;" })).toBe(0);
    expect(valueOf({ content: "const probe = undefined ?? 9;" })).toBe(9);
  });

  it("is opaque for a same-file shape it does not read as a number", () => {
    expect(valueOf({ content: 'const probe = "5000";' })).toBe("opaque");
    expect(valueOf({ content: "const probe = 1 << 2;" })).toBe("opaque");
    expect(valueOf({ content: "const probe = [5][0];" })).toBe("opaque");
  });

  it("is dynamic for an import, a parameter's product and a call, the trusted blind spot", () => {
    expect(valueOf({ content: 'import { MS } from "./x.js";\nconst probe = MS;' })).toBe("dynamic");
    expect(valueOf({ content: "const probe = compute();" })).toBe("dynamic");
    expect(valueOf({ content: 'import { MS } from "./x.js";\nconst probe = MS * 0;' })).toBe(0);
  });
});

describe("memberNodeOf and decidedHere: the object walk under the evaluator", () => {
  it("reaches the expression a property chain names, and says absent for a key no member names", () => {
    withProbe({
      content: "const C = { a: { b: 6 } };\nconst probe = C.a;",
      use: (object) => {
        const reached = memberNodeOf({ name: "b", object, seen: new Set() }) as { readonly node: ts.Expression };
        expect(reached.node.getText()).toBe("6");
        expect(memberNodeOf({ name: "z", object, seen: new Set() })).toBe("absent");
      },
    });
  });

  it("calls a literal spelled here decided here, and one rooted in an import or a call decided elsewhere", () => {
    const decided = ({ content }: { content: string }): boolean =>
      withProbe({ content, use: (object) => decidedHere({ object, seen: new Set<ts.Node>() }) });
    expect(decided({ content: "const L = [1];\nconst probe = L;" })).toBe(true);
    expect(decided({ content: 'import { L } from "./x.js";\nconst probe = L;' })).toBe(false);
    expect(decided({ content: "const probe = load().limits;" })).toBe(false);
  });
});

describe("declarationOf and launcherOf", () => {
  it("resolves a name to the nearest declaration, an inner binding shadowing the import", () => {
    const content =
      'import { spawnSync } from "node:child_process";\nfunction f(spawnSync: string) {\n  return spawnSync;\n}\n';
    withSourceFile({
      fileName: "probe.ts",
      text: content,
      scriptKind: ts.ScriptKind.TS,
      use: (sf) => {
        const fn = sf.statements[1] as ts.FunctionDeclaration;
        const returned = (fn.body!.statements[0] as ts.ReturnStatement).expression!;
        expect(declarationOf({ from: returned, text: "spawnSync" })).toEqual({ kind: "other" });
        expect(declarationOf({ from: fn, text: "spawnSync" })).toEqual({
          imported: "spawnSync",
          kind: "import",
          module: "node:child_process",
        });
      },
    });
  });

  it("names the launcher a call reaches and whether its options bound it", () => {
    const content =
      'import { execFileSync as run } from "node:child_process";\nconst probe = run("tool", [], { timeout: 1 % 1 });';
    withProbe({
      content,
      use: (expression) => {
        const call = expression as ts.CallExpression;
        expect(launcherOf({ call })).toBe("execFileSync");
        expect(callIsBounded({ call })).toBe(false);
      },
    });
  });
});
