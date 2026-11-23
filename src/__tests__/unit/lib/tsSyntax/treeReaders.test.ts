/**
 * The tree-side specifier readers of the syntax seam — `moduleSpecifiersOf`, the JSDoc and types-directive readers,
 * and the inputs on which `moduleSpecifiers` and the tree answer alike.
 */

import { describe, expect, it } from "vitest";
import { jsDocImportSpecifiersOf, moduleSpecifiers, typeReferenceSpecifiersOf, withSourceFile } from "#lib/tsSyntax.js";
import { fromTree, NEXT_LINE, ZERO_WIDTH_SPACE } from "./specifierHarness.js";

describe("jsDocImportSpecifiersOf and typeReferenceSpecifiersOf", () => {
  it("reads an import type and an @import tag from every JSDoc block, the last one before a declaration or not", () => {
    const text = [
      '/** @import { A } from "./tag.js" */',
      '/** @param {import("./param.js").P} s */',
      "function f(s) {}",
      '/** @type {Array<import("./nested.js").N>} */',
      "let n;",
      "/** @type {import(name).X} */",
      "let computed;",
      '/** @import { Z } from "./trailing.js" */',
    ].join("\n");
    const specifiers = withSourceFile({
      fileName: "x.js",
      text,
      use: (sourceFile) => jsDocImportSpecifiersOf({ sourceFile }).toSorted(),
    });
    expect(specifiers).toEqual(["./nested.js", "./param.js", "./tag.js", "./trailing.js"]);
  });

  it("reads a types directive, on a lean tree too, and never a path one", () => {
    const text = '/// <reference types="node" />\n/// <reference path="./x.d.ts" />\nexport const v = 1;';
    const specifiers = withSourceFile({
      fileName: "x.ts",
      text,
      use: (sourceFile) => typeReferenceSpecifiersOf({ sourceFile }),
    });
    expect(specifiers).toEqual(["node"]);
  });
});

describe("moduleSpecifiersOf, and the inputs both readers answer alike", () => {
  it("reads export * as and import defer through a comment or a whitespace \\s does not match", () => {
    const commented = 'export * /* c */ as block from "./block.js";\nexport * // c\n  as line from "./line.js";';
    expect(fromTree({ text: commented })).toEqual(["./block.js", "./line.js"]);
    const spaced = `const r = require${NEXT_LINE}?.("./nel.js");\nexport *${ZERO_WIDTH_SPACE}as zw from "./zw.js";`;
    expect(fromTree({ text: spaced })).toEqual(["./nel.js", "./zw.js"]);
  });

  it("reads require as a method, a constructor or a generic call", () => {
    const text = [
      'const r = module.require("./method.js");',
      'const n = new require("./ctor.js");',
      'const g = require<T>("./generic.js");',
      'const c = require /* c */ ?.("./commented.js");',
    ].join("\n");
    expect(fromTree({ text })).toEqual(["./method.js", "./ctor.js", "./generic.js", "./commented.js"]);
  });

  it("reads no load through an HTML-like comment on either path, since TypeScript's scanner skips none", () => {
    const texts = ['const x = require\n--> c\n?.("./close.js");\n', 'const x = require <!-- c\n?.("./open.js");\n'];
    const answers = texts.flatMap((text) =>
      ["x.js", "x.ts"].map((fileName) => [moduleSpecifiers({ fileName, text }), fromTree({ fileName, text })]),
    );
    expect(answers).toEqual(
      texts.flatMap(() => [
        [[], []],
        [[], []],
      ]),
    );
  });

  it("reads a call to a locally declared require, and never a declaration spelled require", () => {
    const call = 'function require(_id: string): void {}\nrequire("./local.js");\n';
    expect(moduleSpecifiers({ fileName: "x.ts", text: call })).toEqual(["./local.js"]);
    expect(fromTree({ text: call })).toEqual(["./local.js"]);
    const declared = 'class C { require("./declared.js") {} }\nexport {};\n';
    expect(moduleSpecifiers({ fileName: "x.ts", text: declared })).toEqual([]);
    expect(fromTree({ text: declared })).toEqual([]);
    const declaredFunction = 'function require("./fn.js") {}\nexport {};\n';
    expect(moduleSpecifiers({ fileName: "x.ts", text: declaredFunction })).toEqual([]);
    expect(fromTree({ text: declaredFunction })).toEqual([]);
  });

  it("reads a regular expression and a prefix operator that open a template substitution", () => {
    const text = 'const x = `${/require("fake")/.source}`;\nconst y = `${!a}${/require("b")/}`;\nrequire("real");\n';
    expect(moduleSpecifiers({ fileName: "x.ts", text })).toEqual(["real"]);
    expect(fromTree({ text })).toEqual(["real"]);
  });

  it("walks a tree deeper than the call stack allows a recursive walk", () => {
    // The escaped identifier hands the file to the tree; the 3,000-term sum overflowed the recursive walk.
    const text = `const \\u0061 = 1;\n${Array.from({ length: 3000 }, () => "a").join("+")};\nrequire("./deep.js");\n`;
    expect(moduleSpecifiers({ fileName: "x.ts", text })).toEqual(["./deep.js"]);
    expect(fromTree({ text })).toEqual(["./deep.js"]);
  });

  it("reads a substitution-free template specifier", () => {
    const text = "const d = await import(`./dynamic.js`);\nconst r = require(`./required.js`);";
    expect(moduleSpecifiers({ fileName: "x.ts", text })).toEqual(["./dynamic.js", "./required.js"]);
  });

  it("reads the literal a load's argument starts with", () => {
    const text = [
      'void import("./as.js" as string);',
      'const a = require("./plus.js" + suffix);',
      'void import(("./paren.js"));',
      "void import(`./held${x}.js`);",
    ].join("\n");
    expect(moduleSpecifiers({ fileName: "x.ts", text })).toEqual(["./as.js", "./plus.js"]);
  });

  it("reads a module augmentation inside a module and never an ambient module in a script", () => {
    const augmentation = 'export {};\ndeclare module "./dep.js" { export interface X {} }\nvoid import("./later.js");';
    const ambient = 'declare module "*.css";';
    expect(moduleSpecifiers({ fileName: "augment.ts", text: augmentation })).toEqual(["./later.js", "./dep.js"]);
    expect(moduleSpecifiers({ fileName: "css.d.ts", text: ambient })).toEqual([]);
  });

  it("reads a .tsx file as JSX", () => {
    const text = 'import { C } from "./c.js";\nexport const v = <C prop="./not-an-import.js" />;';
    expect(moduleSpecifiers({ fileName: "x.tsx", text })).toEqual(["./c.js"]);
  });
});
