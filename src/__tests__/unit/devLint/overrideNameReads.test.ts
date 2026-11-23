/* `overrideNamesByLine` — override names found as syntax, on the line their own token starts. */
import { describe, expect, it } from "vitest";
import { overrideNamesByLine } from "../../../devLint/overrideNameReads.js";

describe("overrideNamesByLine", () => {
  it("finds a quoted override name, an env index and a bare process.env property, one line each", () => {
    const content = [
      'const A = "ACME_ALLOW_EVERYONE";',
      "const b = env[`ACME_POLICY_OVERRIDE`];",
      "const c = process.env.ALLOW_FABLE_OVERRIDE;",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_EVERYONE"]],
      [2, ["ACME_POLICY_OVERRIDE"]],
      [3, ["ALLOW_FABLE_OVERRIDE"]],
    ]);
  });

  it("reports a wrapped process.env access on the line its name starts", () => {
    const content = ["const open = process.env", "  .ACME_POLICY_OVERRIDE;"].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([[2, ["ACME_POLICY_OVERRIDE"]]]);
  });

  it("finds a key read off ANY receiver — parenthesised, aliased — or destructured, plain or renamed", () => {
    const content = [
      "const a = (process.env).ACME_POLICY_OVERRIDE;",
      "const b = env.ACME_ALLOW_ALIAS;",
      "const { ACME_ALLOW_PLAIN } = process.env;",
      "const { ACME_ALLOW_RENAMED: open } = process.env;",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_POLICY_OVERRIDE"]],
      [2, ["ACME_ALLOW_ALIAS"]],
      [3, ["ACME_ALLOW_PLAIN"]],
      [4, ["ACME_ALLOW_RENAMED"]],
    ]);
  });

  it("finds a key in every other key position — assignment destructuring, object, shorthand, type and class members", () => {
    const content = [
      "({ ACME_ALLOW_ASSIGNED: open } = process.env);",
      'spawn({ env: { ACME_ALLOW_CHILD: "1" } });',
      "const o = { ACME_ALLOW_SHORT };",
      "type Env = { ACME_ALLOW_TYPED?: string };",
      "class C { ACME_ALLOW_FIELD = 1; }",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_ASSIGNED"]],
      [2, ["ACME_ALLOW_CHILD"]],
      [3, ["ACME_ALLOW_SHORT"]],
      [4, ["ACME_ALLOW_TYPED"]],
      [5, ["ACME_ALLOW_FIELD"]],
    ]);
  });

  it("finds a member key of every kind — a method, an accessor, a method signature and an enum member", () => {
    const content = [
      'const o = { ACME_ALLOW_METHOD() { return "1"; } };',
      "class C { get ACME_ALLOW_GETTER() { return 1; } }",
      "interface I { ACME_ALLOW_SIGNED(): string }",
      "enum E { ACME_ALLOW_MEMBER }",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_METHOD"]],
      [2, ["ACME_ALLOW_GETTER"]],
      [3, ["ACME_ALLOW_SIGNED"]],
      [4, ["ACME_ALLOW_MEMBER"]],
    ]);
  });

  it("finds a constructor parameter property under each modifier, which declares a class member", () => {
    const content = [
      "class A { constructor(public ACME_ALLOW_PUBLIC: string) {} }",
      "class B { constructor(private readonly ACME_ALLOW_PRIVATE: string) {} }",
      "class C { constructor(protected ACME_ALLOW_PROTECTED: string) {} }",
      "class D { constructor(readonly ACME_ALLOW_READONLY: string) {} }",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_PUBLIC"]],
      [2, ["ACME_ALLOW_PRIVATE"]],
      [3, ["ACME_ALLOW_PROTECTED"]],
      [4, ["ACME_ALLOW_READONLY"]],
    ]);
  });

  it("finds a JSX attribute key and a type query's member", () => {
    const content = ['const v = <Widget ACME_ALLOW_JSX="1" />;', "type T = typeof env.ACME_ALLOW_QUERIED;"].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.tsx" })]).toEqual([
      [1, ["ACME_ALLOW_JSX"]],
      [2, ["ACME_ALLOW_QUERIED"]],
    ]);
  });

  it("catches a key position no reader names, and never a use of a local", () => {
    const content = [
      'import data from "./data.json" with { ACME_ALLOW_ATTRIBUTE: "1" };',
      "const ACME_ALLOW_LOCAL = 1;",
      "use(ACME_ALLOW_LOCAL);",
      "use(ACME_ALLOW_GLOBAL);",
      'import { ACME_ALLOW_IMPORTED } from "./x.js";',
      "use(ACME_ALLOW_IMPORTED);",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_ATTRIBUTE"]],
      [4, ["ACME_ALLOW_GLOBAL"]],
    ]);
  });

  it("lets neither a tuple label nor a statement label mask a reference", () => {
    const content = ["type T = [ACME_ALLOW_GHOST: string];", "consume(ACME_ALLOW_GHOST);"].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_GHOST"]],
      [2, ["ACME_ALLOW_GHOST"]],
    ]);
  });

  it("leaves a local binding's own name out, in an array pattern too", () => {
    const content = [
      "const [ACME_ALLOW_FIRST] = values;",
      "function f(ACME_ALLOW_PARAM: string) {}",
      "const { ...ACME_ALLOW_REST } = source;",
      "let ACME_ALLOW_SPREAD; ({ ...ACME_ALLOW_SPREAD } = source);",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([]);
  });

  it("dedupes a name spelled twice on one line, and keeps two names on one line in source order", () => {
    const content = 'const x = [process.env.ACME_ALLOW_X, "ACME_ALLOW_X", "ACME_ALLOW_Y"];';

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([[1, ["ACME_ALLOW_X", "ACME_ALLOW_Y"]]]);
  });

  it("folds a + chain of literals, parenthesised or wrapped, on the line the chain starts, and each sub-chain too", () => {
    const content = [
      'const a = process.env["ACME_POLICY_" + "OVERRIDE"];',
      'const b = env[("ACME_" + `ALLOW`) + "_FOLDED"];',
      'const c = process.env["ACME_ALLOW_" +',
      '  "WRAPPED"];',
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_POLICY_OVERRIDE"]],
      [2, ["ACME_ALLOW_FOLDED", "ACME_ALLOW"]],
      [3, ["ACME_ALLOW_WRAPPED"]],
    ]);
  });

  it("reads a literal-only sub-chain whose enclosing chain is not a name", () => {
    const content = 'const x = ("ACME_A" + "LLOW_GHOST") + "-suffix";';

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([[1, ["ACME_ALLOW_GHOST"]]]);
  });

  it("does not fold a chain carrying a value — a name, or a template with a hole — the stated blind spot", () => {
    const content = [
      'const a = process.env[PREFIX + "_ALLOW_GHOST"];',
      "const b = process.env[`ACME_ALLOW_${suffix}`];",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([]);
  });

  it("folds a number into a chain by JavaScript's own +, each sub-chain by the same rule", () => {
    const content = [
      'const a = process.env["ACME_ALLOW_" + 1];',
      'const b = process.env["ACME_ALLOW_" + 1 + 2];',
      'const c = process.env[1 + 2 + "ACME_ALLOW_SUM"];',
      'const d = process.env["ACME_ALLOW_" + 7n];',
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_1"]],
      [2, ["ACME_ALLOW_12", "ACME_ALLOW_1"]],
      [3, ["ACME_ALLOW_SUM"]],
      [4, ["ACME_ALLOW_7"]],
    ]);
  });

  it("still reads a whole literal inside a folded chain whose whole value is not a name", () => {
    const content = 'const x = "ACME_ALLOW_GHOST" + "-suffix";';

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([[1, ["ACME_ALLOW_GHOST"]]]);
  });

  it("folds a template whose every hole is a literal, and a literal chain inside a hole too", () => {
    const content = [
      'const a = process.env[`ACME_${"ALLOW"}_TEMPLATE`];',
      "const b = process.env[`ACME_ALLOW_${2}`];",
      'const c = process.env[`${"ACME_" + `ALLOW`}_NESTED`];',
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([
      [1, ["ACME_ALLOW_TEMPLATE"]],
      [2, ["ACME_ALLOW_2"]],
      [3, ["ACME_ALLOW_NESTED", "ACME_ALLOW"]],
    ]);
  });

  it("finds nothing in a comment, an ordinary setting, or a name that is not a whole literal", () => {
    const content = [
      '// "ACME_ALLOW_EVERYONE"',
      'const home = process.env["SLOPWEAVER_HOME"];',
      'const line = "set ACME_ALLOW_EVERYONE=1 to open it";',
      "const ACME_ALLOW_LOCAL = 1;",
    ].join("\n");

    expect([...overrideNamesByLine({ content, path: "src/a.ts" })]).toEqual([]);
  });
});
