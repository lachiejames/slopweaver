/**
 * The `typescript-import-seam` gate on inline fixtures: every import form and code extension it must catch, the text
 * it must never read as an import, and the two allowlists.
 */
import { describe, expect, it } from "vitest";
import {
  isScannablePath,
  scanTypescriptImportSeam,
  TS_COMPILER_CONSUMERS,
  TYPESCRIPT_SEAM_FILES,
} from "../../../devLint/typescriptImportSeam.js";

/** The specifiers one fixture is refused for, in source order. */
function refused({ path, content }: { path: string; content: string }): readonly string[] {
  return scanTypescriptImportSeam({ content, path }).map((hit) => hit.specifier);
}

describe("scanTypescriptImportSeam", () => {
  it("refuses every import form that names the package or a subpath", () => {
    const content = [
      'import ts from "typescript";',
      'import type { Node } from "typescript/ast";',
      'export { API } from "typescript/sync";',
      'import eq = require("typescript/lib/tsserverlibrary");',
      'const lazy = await import("typescript/a");',
      'const r = require("typescript/b");',
      'type T = typeof import("typescript/c");',
      'const load = createRequire(import.meta.url); load("typescript/d");',
      'void import(("typescript/e"));',
      'import escaped from "type\\u0073cript/g";',
      'void import("type\\\nscript/h");',
      'const p = require((("typescript/f")));',
      'const cased = require("TypeScript/Cased");',
    ].join("\n");
    expect(refused({ content, path: "src/x.ts" })).toEqual([
      "typescript",
      "typescript/ast",
      "typescript/sync",
      "typescript/lib/tsserverlibrary",
      "typescript/a",
      "typescript/b",
      "typescript/c",
      "typescript/g",
      "typescript/h",
      "TypeScript/Cased",
      "typescript/d",
      "typescript/e",
      "typescript/f",
    ]);
  });

  it("refuses require reached as module.require, module['require'] or new, and no other method call", () => {
    const content = [
      'const m = module.require("typescript/m");',
      'const n = new require("typescript/n");',
      'const found = text.includes("typescript");',
      'const bracketed = module["require"]("typescript/bracketed");',
      'const templated = module[`require`]("typescript/templated");',
      'const keyed = module[("require")]("typescript/keyed");',
      'const other = loader["load"]("typescript");',
      'const computed = module[name]("typescript");',
      'const wrapped = (module.require as NodeRequire)("typescript/wrapped");',
    ].join("\n");
    expect(refused({ content, path: "src/x.cts" })).toEqual([
      "typescript/m",
      "typescript/n",
      "typescript/bracketed",
      "typescript/templated",
      "typescript/keyed",
      "typescript/wrapped",
    ]);
  });

  it("reads a renamed loader's literal through every wrapper that compiles to nothing", () => {
    const content = [
      "const load = createRequire(import.meta.url);",
      'load("typescript/as" as string);',
      'load("typescript/satisfies" satisfies string);',
      'load(("typescript/bang")!);',
      'load(<string>"typescript/angle");',
      '(load as NodeRequire)("typescript/callee");',
      'const built = new load("typescript/new");',
    ].join("\n");
    expect(refused({ content, path: "src/x.ts" })).toEqual([
      "typescript/as",
      "typescript/satisfies",
      "typescript/bang",
      "typescript/angle",
      "typescript/callee",
      "typescript/new",
    ]);
  });

  it("reads no specifier assembled at run time or spread into the call, its named blind spot", () => {
    const content = [
      'const name = "typescript";',
      "const a = require(name);",
      'const b = require("type" + "script");',
      'const c = require(...(["typescript"] as const));',
      'const d = module.require.call(module, "typescript");',
      'const e = require.apply(null, ["typescript"]);',
      'const f = Reflect.apply(require, null, ["typescript"]);',
    ].join("\n");
    expect(refused({ content, path: "src/x.ts" })).toEqual([]);
    const jsDocType = '/** @type {import("typescript").Node} */\nlet node;';
    expect(refused({ content: jsDocType, path: "src/x.ts" })).toEqual([]);
    expect(refused({ content: 'define(["typescript"], () => {});', path: "src/x.js" })).toEqual([]);
  });

  it("refuses a type dependency a JavaScript file's JSDoc names, and a types directive in any file", () => {
    const jsDoc = [
      '/** @type {import("typescript").Node} */',
      "let node;",
      '/** @import { SourceFile } from "typescript/lib/tsserverlibrary" */',
      '/** @param {Array<import("typescript").Symbol>} s */',
      "function f(s) {}",
      '/** @type {import("./other.js").T} */',
      "let other;",
    ].join("\n");
    const directive = '/// <reference types="typescript" />\nexport const v = 1;';
    expect([
      refused({ content: jsDoc, path: "src/x.js" }),
      refused({ content: jsDoc, path: "src/x.mjs" }),
      refused({ content: directive, path: "src/x.ts" }),
      refused({ content: '/// <reference types="node" />\nexport const v = 1;', path: "src/x.ts" }),
    ]).toEqual([
      ["typescript", "typescript/lib/tsserverlibrary"],
      ["typescript", "typescript/lib/tsserverlibrary"],
      ["typescript"],
      [],
    ]);
  });

  it("reads every code extension, JSX included", () => {
    const paths = ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"];
    const verdicts = paths.map((path) =>
      refused({ content: 'import ts from "typescript";\nexport const v = <div />;', path: `site/${path}` }),
    );
    expect(verdicts).toEqual(paths.map(() => ["typescript"]));
  });

  it("never reads a comment, string, template or look-alike package as an import", () => {
    const content = [
      '// import ts from "typescript";',
      "const s = \"import ts from 'typescript'\";",
      "const t = `typescript`;",
      'import other from "typescript-eslint";',
      'import own from "./typescript.js";',
      'const named = text.includes("typescript") || text.startsWith("typescript/");',
      '(text.includes)("typescript"); ((set["has"]))("typescript");',
    ].join("\n");
    expect(refused({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("exempts the four seam files and names each reach with its reason", () => {
    expect([...TYPESCRIPT_SEAM_FILES]).toEqual([
      "src/lib/tsCompiler.ts",
      "src/lib/tsLazy.ts",
      "src/lib/tsProject.ts",
      "src/lib/tsSyntax.ts",
    ]);
    const exempt = [...TYPESCRIPT_SEAM_FILES].map((path) => refused({ content: 'import ts from "typescript";', path }));
    expect(exempt).toEqual([[], [], [], []]);
    expect(scanTypescriptImportSeam({ content: 'import ts from "typescript";', path: "src/x.ts" })).toEqual([
      { path: "src/x.ts", reason: "typescript-package", specifier: "typescript" },
    ]);
  });

  it("refuses a SyntaxKind range marker outside the seam, in every access shape", () => {
    const content = [
      "const a = kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;",
      'const b = SyntaxKind["FirstCompoundAssignment"];',
      "const c = (ts.SyntaxKind).LastToken;",
      "const d = ts.SyntaxKind.FirstAssignment;",
    ].join("\n");
    expect(scanTypescriptImportSeam({ content, path: "src/devLint/walker.ts" })).toEqual([
      { path: "src/devLint/walker.ts", reason: "syntax-kind-range", specifier: "SyntaxKind.FirstAssignment" },
      { path: "src/devLint/walker.ts", reason: "syntax-kind-range", specifier: "SyntaxKind.LastAssignment" },
      { path: "src/devLint/walker.ts", reason: "syntax-kind-range", specifier: "SyntaxKind.FirstCompoundAssignment" },
      { path: "src/devLint/walker.ts", reason: "syntax-kind-range", specifier: "SyntaxKind.LastToken" },
    ]);
    expect(refused({ content, path: "src/lib/tsSyntax.ts" })).toEqual([]);
  });

  it("refuses a range marker named in a type position, and no other qualified name", () => {
    const content = [
      "type A = ts.SyntaxKind.FirstAssignment;",
      "type B = SyntaxKind.LastToken | typeof ts.SyntaxKind.FirstNode;",
      'let c: import("typescript").SyntaxKind.FirstKeyword;',
      "type D = ts.SyntaxKind.EqualsToken | Other.FirstThing | ts.Firstly.LastSomething;",
    ].join("\n");
    expect(refused({ content, path: "src/devLint/walker.ts" })).toEqual([
      "typescript",
      "SyntaxKind.FirstAssignment",
      "SyntaxKind.LastToken",
      "SyntaxKind.FirstNode",
      "SyntaxKind.FirstKeyword",
    ]);
    expect(refused({ content, path: "src/lib/tsSyntax.ts" })).toEqual([]);
  });

  it("refuses a range marker destructured off SyntaxKind, directly, nested, renamed, by a literal computed key, wrapped or bare, or as a parameter default", () => {
    const content = [
      "const { FirstAssignment, LastAssignment: last } = ts.SyntaxKind;",
      "const { SyntaxKind: { LastToken } } = ts;",
      'const { "FirstNode": node } = (SyntaxKind as typeof SyntaxKind);',
      "function f({ FirstKeyword } = ts.SyntaxKind) {}",
      'const { ["LastKeyword"]: kw } = ts.SyntaxKind;',
      'const { [("FirstLiteralToken" as const)]: lit } = ts.SyntaxKind;',
    ].join("\n");
    expect(refused({ content, path: "src/devLint/walker.ts" })).toEqual([
      "SyntaxKind.FirstAssignment",
      "SyntaxKind.LastAssignment",
      "SyntaxKind.LastToken",
      "SyntaxKind.FirstNode",
      "SyntaxKind.FirstKeyword",
      "SyntaxKind.LastKeyword",
      "SyntaxKind.FirstLiteralToken",
    ]);
  });

  it("reads no destructured member that is not a range marker, nor one off another object, nor a rest binding, nor its named blind spot", () => {
    const content = [
      "const { EqualsToken, Firstly } = ts.SyntaxKind;",
      "const { EqualsToken: eq, ...FirstLocal } = ts.SyntaxKind;",
      "const { FirstPlace } = Order;",
      "const { Other: { FirstToken } } = ts;",
      "const { [name]: computed, [FirstLocal]: alsoComputed } = ts.SyntaxKind;",
      "const K = ts.SyntaxKind; const k = K.FirstAssignment;",
      "({ FirstAssignment } = ts.SyntaxKind);",
    ].join("\n");
    expect(refused({ content, path: "src/devLint/walker.ts" })).toEqual([]);
  });

  it("reads no range marker into a member that merely starts First or Last, or one owned by another enum", () => {
    const content = [
      "const a = ts.SyntaxKind.EqualsToken;",
      "const b = Order.FirstPlace;",
      "const c = person.LastName;",
      "const d = ts.SyntaxKind.Firstly;",
      "const e = SyntaxKind.first;",
    ].join("\n");
    expect(refused({ content, path: "src/devLint/walker.ts" })).toEqual([]);
  });

  it("refuses the compiler seam outside named-object-params, by alias or relative path", () => {
    expect(TS_COMPILER_CONSUMERS.size).toBeGreaterThan(0);
    const content = 'import { ts } from "#lib/tsCompiler.js";\nimport { ts as b } from "../lib/tsCompiler.js";';
    expect(scanTypescriptImportSeam({ content, path: "src/devLint/other.ts" })).toEqual([
      { path: "src/devLint/other.ts", reason: "ts-compiler", specifier: "#lib/tsCompiler.js" },
      { path: "src/devLint/other.ts", reason: "ts-compiler", specifier: "../lib/tsCompiler.js" },
    ]);
    const sibling = 'import { ts } from "./tsCompiler.js";\nimport { ts as b } from "./tsCompiler";';
    expect(scanTypescriptImportSeam({ content: sibling, path: "src/lib/other.ts" })).toEqual([
      { path: "src/lib/other.ts", reason: "ts-compiler", specifier: "./tsCompiler.js" },
      { path: "src/lib/other.ts", reason: "ts-compiler", specifier: "./tsCompiler" },
    ]);
    const wrongCase = 'import { ts } from "../lib/tscompiler.js";\nimport { ts as b } from "../LIB/tsCompiler.JS";';
    expect(scanTypescriptImportSeam({ content: wrongCase, path: "src/devLint/other.ts" })).toEqual([
      { path: "src/devLint/other.ts", reason: "ts-compiler", specifier: "../lib/tscompiler.js" },
      { path: "src/devLint/other.ts", reason: "ts-compiler", specifier: "../LIB/tsCompiler.JS" },
    ]);
    const lookAlike = 'import { a } from "./lib/tsCompiler.js";\nimport { b } from "../../lib/tsCompiler.js";';
    expect(scanTypescriptImportSeam({ content: lookAlike, path: "site/x.ts" })).toEqual([]);
    expect(scanTypescriptImportSeam({ content: lookAlike, path: "src/devLint/other.ts" })).toEqual([]);
    const allowed = [...TS_COMPILER_CONSUMERS].map((path) => refused({ content, path }));
    expect(allowed).toEqual([...TS_COMPILER_CONSUMERS].map(() => []));
  });

  it("refuses a tree built past withSourceFile, bare, as a member or wrapped, once per file", () => {
    const content = [
      'import { ts } from "#lib/tsSyntax.js";',
      'const a = ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest, true);',
      'const b = (ts["createSourceFile"])!("b.ts", text, ts.ScriptTarget.Latest);',
      'const c = createSourceFile("c.ts", text);',
    ].join("\n");
    expect(scanTypescriptImportSeam({ content, path: "src/devLint/walker.ts" })).toEqual([
      { path: "src/devLint/walker.ts", reason: "unleased-parse", specifier: "createSourceFile" },
    ]);
  });

  it("reads no leased parse, mention or held builder as an unleased one, and exempts the seam and compiler consumers", () => {
    const leased = [
      'import { withSourceFile } from "#lib/tsSyntax.js";',
      'const n = withSourceFile({ fileName: "a.ts", text, use: (source) => source.statements.length });',
      '// ts.createSourceFile("x.ts", text) would build an unleased tree',
      'const s = "ts.createSourceFile(name, text)";',
      "const held = ts.createSourceFile;",
    ].join("\n");
    expect(refused({ content: leased, path: "src/devLint/walker.ts" })).toEqual([]);
    const built = 'const a = ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest, true);';
    const exempt = [...TYPESCRIPT_SEAM_FILES, ...TS_COMPILER_CONSUMERS];
    expect(exempt.length).toBeGreaterThan(0);
    expect(exempt.map((path) => refused({ content: built, path }))).toEqual(exempt.map(() => []));
  });

  it("reports one hit per distinct specifier", () => {
    const content = 'import a from "typescript";\nimport type b from "typescript";';
    expect(refused({ content, path: "src/x.ts" })).toEqual(["typescript"]);
  });
});

describe("isScannablePath", () => {
  it("takes code modules and leaves everything else", () => {
    const verdicts = ["a.ts", "a.d.ts", "a.cjs", "a.json", "a.md", "a.ts.snap"].map((path) =>
      isScannablePath({ path }),
    );
    expect(verdicts).toEqual([true, true, true, false, false, false]);
  });
});
