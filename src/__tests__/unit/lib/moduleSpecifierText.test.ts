/**
 * `readModuleSpecifiers`, the TypeScript-free reader behind `tsSyntax.moduleSpecifiers`: what it reads confidently,
 * exactly as the tree does, and each reason it answers uncertain so the seam parses that file instead.
 */

import { describe, expect, it } from "vitest";
import { readModuleSpecifiers } from "#lib/moduleSpecifierText.js";
import { fromTree } from "./tsSyntax/specifierHarness.js";

/** One input per reason the reader, or the lexer under it, leaves a file to the tree. */
const UNCERTAIN: readonly { readonly fileName: string; readonly text: string; readonly why: string }[] = [
  { fileName: "x.tsx", text: "export const v = <div />;", why: "possible JSX" },
  { fileName: "x.TSX", text: 'export const v = <div>require("./text.js")</div>;', why: "possible JSX" },
  { fileName: "x.Mjs", text: "export const v = <div />;", why: "possible JSX" },
  { fileName: "x.ts", text: "async function f() { return await /x/.test(s); }", why: "slash after await" },
  { fileName: "x.ts", text: 'const await = 1;\nawait! / require("missed") / 1;', why: "slash after !" },
  { fileName: "x.ts", text: 'let x: string\n/require("fake")/.test(s);', why: "slash after string" },
  { fileName: "x.ts", text: "type T = A[]\n/x/.test(s);", why: "slash after ]" },
  { fileName: "x.ts", text: "const q = a /* one\ntwo */ / 2;", why: "slash after a" },
  { fileName: "x.tsx", text: "let x: T\n<div />;", why: "possible JSX" },
  { fileName: "x.ts", text: "label: {} /x/.test(s);", why: "slash after }" },
  { fileName: "x.ts", text: 'type T = {}\n/require("fake")/.test(s);', why: "slash after }" },
  { fileName: "x.ts", text: "type U = A | { a: 1 }\n/x/.test(s);", why: "slash after }" },
  { fileName: "x.ts", text: "const q = {} / 2;", why: "slash after }" },
  { fileName: "x.ts", text: 'const f = function(){} / require("./div.js") / 1;', why: "slash after }" },
  { fileName: "x.ts", text: "const \\u0061 = 1;", why: "escaped identifier" },
  { fileName: "x.ts", text: "const a = 1 ¬ 2;", why: "character U+ac" },
  { fileName: "x.ts", text: 'const s = "open', why: "unterminated string" },
  { fileName: "x.ts", text: "const s = `open", why: "unterminated template" },
  { fileName: "x.ts", text: "/* open", why: "unterminated comment" },
  { fileName: "x.ts", text: "const r = /open", why: "unterminated regex" },
  { fileName: "x.ts", text: 'import x from "./\\u0078.js";', why: "escaped specifier" },
  { fileName: "x.ts", text: 'declare module "./c.js" {}', why: "declare module" },
  { fileName: "x.ts", text: 'const m = module.require("./member.js");', why: "member require" },
  { fileName: "x.ts", text: 'function require("./fn.js") {}', why: "require declaration" },
  { fileName: "x.ts", text: 'const o = { *require("./gen.js") {} };', why: "require declaration" },
  { fileName: "x.ts", text: 'const o = { require("./method.js") {} };', why: "require declaration shape" },
  { fileName: "x.ts", text: 'interface I { require("./sig.js"); }', why: "require member shape" },
  { fileName: "x.ts", text: 'const g = require<T>("./generic.js");', why: "generic require" },
  { fileName: "x.ts", text: 'const g = import<T>("./generic.js");', why: "generic import" },
  { fileName: "x.ts", text: '1require("./glued.js");', why: "identifier after number" },
  { fileName: "x.ts", text: "const n = 0x1fz;", why: "identifier after number" },
  { fileName: "x.ts", text: 'class C { import("./method.js") {} }', why: "import declaration shape" },
  { fileName: "x.ts", text: 'function import("./fn.js") {}', why: "import declaration" },
  { fileName: "x.ts", text: 'interface I { import("./sig.js"); }', why: "import member shape" },
  { fileName: "x.ts", text: 'import source s from "./src.wasm";', why: "import source" },
  { fileName: "x.ts", text: "outer: for (;;) { break outer\n/x/.test(s); }", why: "slash after outer" },
];

describe("readModuleSpecifiers", () => {
  it("reads every form it is confident of, in source order, duplicates kept, exactly as the tree does", () => {
    const text = [
      'import a from "./a.js";',
      'import "./side.js";',
      'import type { T } from "./t.js";',
      'import defer * as lazy from "./defer.js";',
      'export /* c */ * /* d */ as grouped from "./grouped.js";',
      'export type * as typed from "./typed-star.js";',
      'export type { U } from "./u.js";',
      'import eq = require("./eq.js");',
      "const d = await import(`./dynamic.js`);",
      'const r = require?.("./optional.js");',
      'const n = new require("./ctor.js");',
      'const t = `${`${require("./nested.js")}`}`;',
      'type M = typeof import("./typed.js");',
      '@require("./decorated.js") class D {}',
      'import again from "./a.js";',
    ].join("\n");
    const specifiers = [
      "./a.js",
      "./side.js",
      "./t.js",
      "./defer.js",
      "./grouped.js",
      "./typed-star.js",
      "./u.js",
      "./eq.js",
      "./dynamic.js",
      "./optional.js",
      "./ctor.js",
      "./nested.js",
      "./typed.js",
      "./decorated.js",
      "./a.js",
    ];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("reads no load spelled where none runs", () => {
    const text = [
      '// import x from "./comment.js";',
      "const s = \"import y from './string.js'\";",
      'const r = /require\\("\\.\\/regex\\.js"\\)/u;',
      'class P { #require(s: string) {} m() { this.#require("./private.js"); } }',
      'define(["./amd.js"], () => {});',
      "const o = { require: 1, import: 2 };",
      "const c = await import(name);",
      "const t = require(`./${name}.js`);",
      'const πrequire = (s: string) => s; πrequire("./not-require.js");',
      "import.meta.url;",
    ].join("\n");
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers: [] });
    expect(fromTree({ text })).toEqual([]);
  });

  it("lexes past a byte-order mark, a hashbang, separators, regex classes and flags, and a closing tag in a string", () => {
    const text = [
      "\uFEFF#!/usr/bin/env node",
      "const n = 1_000n + 0x1f + 1e-5 + 0b101n + 0o17 + .5e3 + 1.;",
      'const m = 1..toString() + 2 .toFixed(require("./after-number.js"));',
      "const r = /[/]x/v;",
      'const s = "</script>";',
      "const k = { a: 1 } satisfies Record<string, number>;",
      "class A { accessor x = 1; }",
      'await using h = open(require("./after.js"));',
    ].join("\n");
    const specifiers = ["./after-number.js", "./after.js"];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("names the one reason it cannot settle each file, so the seam parses it", () => {
    expect(UNCERTAIN.length).toBeGreaterThan(0);
    const answers = UNCERTAIN.map(({ fileName, text }) => [text, readModuleSpecifiers({ fileName, text })]);
    expect(answers).toEqual(UNCERTAIN.map(({ text, why }) => [text, { kind: "uncertain", why }]));
  });

  it("keeps a line or paragraph separator inside a string, and ends a line comment at one, as TypeScript does", () => {
    const text = [
      'import "a\u2028b";',
      'require("a\u2029b");',
      'import "a\vb";',
      "// c\u2028require('./after-line-comment.js');",
    ].join("\n");
    const specifiers = ["a\u2028b", "a\u2029b", "a\vb", "./after-line-comment.js"];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("reads a template specifier's CRLF and lone CR as LF, as the tree's text does", () => {
    const text = "void import(`a\r\nb`);\nrequire(`c\rd`);\n";
    const specifiers = ["a\nb", "c\nd"];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("reads a file that ends in an identifier, with no line break after it", () => {
    const texts = ['import a from "./a.js";\nexport default a', "a", "this.#b"];
    expect(texts.map((text) => readModuleSpecifiers({ fileName: "x.ts", text }))).toEqual([
      { kind: "read", specifiers: ["./a.js"] },
      { kind: "read", specifiers: [] },
      { kind: "read", specifiers: [] },
    ]);
  });

  it("opens a regex after a keyword that ends a statement, and divides after a keyword used as a property name", () => {
    const text = [
      "debugger",
      '/require("after-debugger")/;',
      'for (;;) { break\n/require("after-break")/; }',
      'for (;;) { continue\n/require("after-continue")/; }',
      'export default /require("after-default")/;',
      'class E extends /require("after-extends")/.constructor {}',
      'const q = o.return / 2; require("member-return") / 1;',
      'const p = o?.delete / 2; require("member-delete") / 1;',
      'const b = o.break / 2; require("member-break") / 1;',
      'o.if(x) / 2; require("member-if") / 1;',
      'o?.while(x) / 2; require("member-while") / 1;',
    ].join("\n");
    const specifiers = ["member-return", "member-delete", "member-break", "member-if", "member-while"];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("reads an import call inside a type or object body that is an operand or a list element, not a member", () => {
    const text = [
      'type T = { a: typeof import("./typed.js"); b: 1 };',
      'const o = { load: () => Promise.all([import("./p.js"), import("./q.js")]) };',
    ].join("\n");
    const specifiers = ["./typed.js", "./p.js", "./q.js"];
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({ kind: "read", specifiers });
    expect(fromTree({ text })).toEqual(specifiers);
  });

  it("reads a require in a function body inside a class, which is a call and not a member", () => {
    const text = 'class C { m() { require("./in-method.js"); } }\nconst o = { a: require("./in-object.js") };';
    expect(readModuleSpecifiers({ fileName: "x.ts", text })).toEqual({
      kind: "read",
      specifiers: ["./in-method.js", "./in-object.js"],
    });
  });
});
