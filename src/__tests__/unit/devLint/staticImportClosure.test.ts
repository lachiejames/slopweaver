/**
 * The static runtime import closure: each edge rule proved falsifiable on in-memory fixtures, so the
 * manifest-barrel closure test built on it cannot pass by walking too little.
 */
import { describe, expect, it } from "vitest";

import { runtimeSpecifiersOf, staticClosureOf } from "../../../devLint/staticImportClosure.js";

/** A fixture tree's reader: a missing path throws, so a wrong resolution fails the test loudly. */
function readerOf({ files }: { files: Readonly<Record<string, string>> }): (path: string) => string {
  return (path) => {
    const text = files[path];
    if (text === undefined) {
      throw new Error(`fixture has no ${path}`);
    }
    return text;
  };
}

describe("runtimeSpecifiersOf", () => {
  it("skips an import type and an import whose every element is inline type", () => {
    const content = ['import type { A } from "./a.js";', 'import { type B, type C } from "./b.js";'].join("\n");
    expect(runtimeSpecifiersOf({ content })).toEqual([]);
  });

  it("follows a mixed import, a default import, a namespace import and a side-effect import", () => {
    const content = [
      'import { type A, b } from "./mixed.js";',
      'import d from "./default.js";',
      'import * as ns from "./ns.js";',
      'import "./effect.js";',
    ].join("\n");
    expect(runtimeSpecifiersOf({ content })).toEqual(["./mixed.js", "./default.js", "./ns.js", "./effect.js"]);
  });

  it("skips a dynamic import(), which is the lazy loader by design", () => {
    const content = 'export const load = () => import("./heavy.js");';
    expect(runtimeSpecifiersOf({ content })).toEqual([]);
  });

  it("follows export-from and export-star, and skips export type and an all-type export list", () => {
    const content = [
      'export { x } from "./x.js";',
      'export * from "./star.js";',
      'export type { T } from "./t.js";',
      'export { type U } from "./u.js";',
    ].join("\n");
    expect(runtimeSpecifiersOf({ content })).toEqual(["./x.js", "./star.js"]);
  });

  it("follows an import-equals require, and skips an import type one", () => {
    const content = [
      'import client = require("./client.js");',
      'import type t = require("./t.js");',
      "import alias = Some.Namespace;",
    ].join("\n");
    expect(runtimeSpecifiersOf({ content })).toEqual(["./client.js"]);
  });

  it("ignores a specifier inside a string or a comment", () => {
    const content = ['// import { a } from "./comment.js";', "const s = 'import { b } from \"./string.js\"';"].join(
      "\n",
    );
    expect(runtimeSpecifiersOf({ content })).toEqual([]);
  });
});

describe("staticClosureOf", () => {
  it("walks relative and #lib/ edges, and reports packages and builtins as bare", () => {
    const files = {
      "src/cli/a.ts": 'import { b } from "./b.js";\nimport { p } from "#lib/parsers.js";',
      "src/cli/b.ts": 'import { z } from "zod";\nimport { join } from "node:path";',
      "src/lib/parsers.ts": "export const p = 1;",
    };
    const closure = staticClosureOf({ readText: readerOf({ files }), roots: ["src/cli/a.ts"] });
    expect(closure.files).toEqual(["src/cli/a.ts", "src/cli/b.ts", "src/lib/parsers.ts"]);
    expect(closure.bare).toEqual([
      { from: "src/cli/b.ts", specifier: "zod" },
      { from: "src/cli/b.ts", specifier: "node:path" },
    ]);
  });

  it("does not walk past a type-only or dynamic edge", () => {
    const files = {
      "src/root.ts": 'import type { T } from "./typed.js";\nexport const load = () => import("./lazy.js");',
    };
    const closure = staticClosureOf({ readText: readerOf({ files }), roots: ["src/root.ts"] });
    expect(closure.files).toEqual(["src/root.ts"]);
    expect(closure.bare).toEqual([]);
  });

  it("terminates on a cycle, reading each file once", () => {
    const files = {
      "src/a.ts": 'export { b } from "./b.js";',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = a;',
    };
    const closure = staticClosureOf({ readText: readerOf({ files }), roots: ["src/a.ts"] });
    expect(closure.files).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
