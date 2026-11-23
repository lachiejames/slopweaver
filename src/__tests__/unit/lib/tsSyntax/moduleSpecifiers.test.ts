/**
 * `moduleSpecifiers`, the reader whose edge set two gates and the app-surface index depend on: it answers what the
 * syntax tree (`moduleSpecifiersOf`) reads, on every input. It replaced TS6's `preProcessFile` token scan, which
 * TypeScript 7 does not have; while both ran, that scan was this test's differential oracle. The table below is the
 * record it left: one input per way the two answer differently, each with the scan's answer as TS6 gave it and the
 * tree's answer this reader now gives — an intended change, never drift.
 */

import { describe, expect, it } from "vitest";
import { moduleSpecifiers } from "#lib/tsSyntax.js";
import { BACKSLASH, fromTree } from "./specifierHarness.js";

/** Inputs where TS6's token scan and the tree answer differently, each with both answers, the scan's as recorded. */
const DIVERGENT: readonly {
  readonly name: string;
  readonly fileName: string;
  readonly text: string;
  readonly scan: readonly string[];
  readonly tree: readonly string[];
}[] = [
  {
    fileName: "x.ts",
    name: "a word an AMD loader is called, beside a regex lookalike",
    scan: ["./x.css"],
    text: 'const note = "define";\nconst found = [...own.matchAll(/@import "\\.\\/x\\.css"/gu)];',
    tree: [],
  },
  {
    fileName: "x.tsx",
    name: "JSX text spelling a load",
    scan: ["./jsx-text.js"],
    text: 'export const v = <div>import("./jsx-text.js")</div>;',
    tree: [],
  },
  {
    fileName: "x.ts",
    name: "a load in a template nested in a substitution",
    scan: [],
    text: 'const a = `${`${require("./nested.js")}`}`;',
    tree: ["./nested.js"],
  },
  {
    fileName: "x.ts",
    name: "a module augmentation in a file only a require makes a module",
    scan: ["./z.js", "./c.js"],
    text: 'const a = require("./z.js");\ndeclare module "./c.js" {}',
    tree: ["./z.js"],
  },
  {
    fileName: "x.js",
    name: "an AMD define dependency",
    scan: ["./amd.js"],
    text: 'define(["./amd.js"], () => {});',
    tree: [],
  },
  {
    fileName: "x.ts",
    name: "export * as and import defer",
    scan: [],
    text: 'export * as grouped from "./grouped.js";\nimport defer * as lazy from "./defer.js";',
    tree: ["./grouped.js", "./defer.js"],
  },
  {
    fileName: "x.ts",
    name: "an optional-call require",
    scan: [],
    text: 'const r = require?.("./optional.js");',
    tree: ["./optional.js"],
  },
  {
    fileName: "x.ts",
    name: "a generic and an optional generic require",
    scan: [],
    text: 'const g = require<T>("./generic.js");\nconst o = require?.<T>("./optional-generic.js");',
    tree: ["./generic.js", "./optional-generic.js"],
  },
  {
    fileName: "x.ts",
    name: "a require spelled with a Unicode escape",
    scan: [],
    text: `const r = requir${BACKSLASH}u0065?.("./escaped.js");`,
    tree: ["./escaped.js"],
  },
  {
    fileName: "x.ts",
    name: "a method declaration spelled require",
    scan: ["./declared.js"],
    text: 'class C { require("./declared.js") {} }\nexport {};\n',
    tree: [],
  },
  {
    fileName: "x.ts",
    name: "a function declaration spelled require",
    scan: ["./fn.js"],
    text: 'function require("./fn.js") {}\nexport {};\n',
    tree: [],
  },
  {
    fileName: "x.ts",
    name: "an abstract member and an interface member spelled require",
    scan: ["./abstract.js", "./signature.js"],
    text: 'abstract class C { abstract require("./abstract.js"); }\ninterface I { require("./signature.js"); }\nexport {};',
    tree: [],
  },
];

/** Inputs where the scan and the tree agree, with that one answer. */
const AGREED: readonly { readonly name: string; readonly text: string; readonly specifiers: readonly string[] }[] = [
  {
    name: "every static and literal-dynamic form both read, in source order, duplicates kept",
    specifiers: [
      "./a.js",
      "./side.js",
      "./t.js",
      "./ns.js",
      "./b.js",
      "./all.js",
      "./u.js",
      "./eq.js",
      "./dynamic.js",
      "./required.js",
      "./typed.js",
      "./a.js",
    ],
    text: [
      'import a from "./a.js";',
      'import "./side.js";',
      'import type { T } from "./t.js";',
      'import * as ns from "./ns.js";',
      'export { b } from "./b.js";',
      'export * from "./all.js";',
      'export type { U } from "./u.js";',
      'import eq = require("./eq.js");',
      'const d = await import("./dynamic.js");',
      'const r = require("./required.js");',
      'type M = typeof import("./typed.js");',
      'import again from "./a.js";',
    ].join("\n"),
  },
  {
    name: "a string, a comment, a computed load and a path directive",
    specifiers: [],
    text: [
      '// import x from "./comment.js";',
      "const s = \"import y from './string.js'\";",
      "const c = await import(name);",
      "const t = require(`./${name}.js`);",
      '/// <reference path="./triple.d.ts" />',
    ].join("\n"),
  },
  {
    name: "a decorator call, a private method spelled require, and a member call",
    specifiers: ["./decorated.js", "./member.js"],
    text: [
      '@require("./decorated.js") class D {}',
      'class P { #require(s: string) {} m() { this.#require("./private.js"); } }',
      'const m = module.require("./member.js");',
    ].join("\n"),
  },
  {
    name: "an augmentation after a static import, last whatever its place",
    specifiers: ["./later.js", "./dep.js"],
    text: 'export {};\ndeclare module "./dep.js" { export interface X {} }\nvoid import("./later.js");',
  },
];

describe("moduleSpecifiers", () => {
  it("answers the tree on every input where TS6's scan and the tree differ", () => {
    expect(DIVERGENT.length).toBeGreaterThan(0);
    const answers = DIVERGENT.map(({ name, fileName, text }) => [name, moduleSpecifiers({ fileName, text })]);
    expect(answers).toEqual(DIVERGENT.map(({ name, tree }) => [name, tree]));
  });

  // The live TS6 scan this case once re-ran went with the 7.1 move; the table keeps the answers it gave.
  // deleted-with-code: preProcessFile
  it("records a different TS6 answer on each of those inputs, so the table holds a real difference", () => {
    const trees = DIVERGENT.map(({ name, fileName, text }) => [name, fromTree({ fileName, text })]);
    expect(trees).toEqual(DIVERGENT.map(({ name, tree }) => [name, tree]));
    expect(DIVERGENT.filter(({ scan, tree }) => JSON.stringify(scan) === JSON.stringify(tree))).toEqual([]);
  });

  it("answers what the scan and the tree both answer where they agree", () => {
    expect(AGREED.length).toBeGreaterThan(0);
    const answers = AGREED.map(({ name, text }) => [
      name,
      moduleSpecifiers({ fileName: "x.ts", text }),
      fromTree({ text }),
    ]);
    expect(answers).toEqual(AGREED.map(({ name, specifiers }) => [name, specifiers, specifiers]));
  });

  it("reads a deferred import, a namespace re-export and a generic import among every other edge, as the tree does", () => {
    const text = [
      'import a from "./a.js";',
      'import defer * as lazy from "./defer.js";',
      'export * as grouped from "./grouped.js";',
      'export * from "./all.js";',
      'const g = import<T>("./generic.js");',
    ].join("\n");
    const everyEdge = ["./a.js", "./defer.js", "./grouped.js", "./all.js", "./generic.js"];
    expect(moduleSpecifiers({ fileName: "x.ts", text })).toEqual(everyEdge);
    expect(fromTree({ text })).toEqual(everyEdge);
  });

  it("judges a file a module by TypeScript's own test, so an augmentation counts only in a module", () => {
    const augment = '\ndeclare module "./c.js" {}';
    const texts = [
      'const a = require("./z.js");',
      'export {};\nvoid import("./d.js");',
      'const n = "./z.js";\nrequire(n);',
    ];
    const answers = texts.map((head) => {
      const text = `${head}${augment}`;
      return [moduleSpecifiers({ fileName: "x.ts", text }), fromTree({ text })];
    });
    expect(answers).toEqual([
      [["./z.js"], ["./z.js"]],
      [
        ["./d.js", "./c.js"],
        ["./d.js", "./c.js"],
      ],
      [[], []],
    ]);
  });
});
