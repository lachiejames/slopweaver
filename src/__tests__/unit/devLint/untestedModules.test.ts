import { describe, expect, it } from "vitest";
import {
  BASELINE_FILE,
  exportsValue,
  importedPathsOf,
  parseBaselineJson,
  regressionsOf,
  resolveSpecifier,
  untestedOf,
  widenedOf,
} from "../../../devLint/untestedModules.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("importedPathsOf", () => {
  it("reads a static import, a re-export and a dynamic import", () => {
    const content = [
      'import { a } from "./a.js";',
      'export { b } from "../b/b.js";',
      'const c = await import("#lib/c.js");',
    ].join("\n");
    expect(importedPathsOf({ content, path: "x.ts" })).toEqual(["./a.js", "../b/b.js", "#lib/c.js"]);
  });

  it("does not count a specifier that only appears inside a string, a comment or a regular expression", () => {
    const content = [
      '// import { x } from "./ghost.js";',
      'const s = "./also-ghost.js";',
      'const re = /import\\("\\.\\/regex-ghost\\.js"\\)/;',
    ].join("\n");
    expect(importedPathsOf({ content, path: "x.ts" })).toEqual([]);
  });

  it("reads an import type as an edge, which is the stated looser criterion", () => {
    expect(importedPathsOf({ content: 'import type { T } from "./t.js";', path: "x.ts" })).toEqual(["./t.js"]);
  });

  it("reads a namespace re-export and a deferred import, as the syntax tree does", () => {
    const content = [
      'export * as a from "./x.js";',
      'export /* c */ * /* d */ as b from "./y.js";',
      'import defer * as ns from "./w.js";',
      'export * from "./kept.js";',
    ].join("\n");
    expect(importedPathsOf({ content, path: "x.ts" })).toEqual(["./x.js", "./y.js", "./w.js", "./kept.js"]);
  });

  it("parses a .tsx file as JSX, so an import after an element is still read", () => {
    const content = 'export const v = <div title="./ghost.js" />;\nconst lazy = () => import("./late.js");';
    expect(importedPathsOf({ content, path: "x.tsx" })).toEqual(["./late.js"]);
  });

  it("returns nothing for a file with no imports", () => {
    expect(importedPathsOf({ content: "export const x = 1;\n", path: "x.ts" })).toEqual([]);
  });
});

describe("resolveSpecifier", () => {
  it("resolves a relative specifier against the importing file's directory and maps .js to .ts", () => {
    expect(
      resolveSpecifier({ fromPath: "src/__tests__/unit/devLint/x.test.ts", specifier: "../../../devLint/x.js" }),
    ).toBe("src/devLint/x.ts");
  });

  it("resolves the #lib subpath import to src/lib", () => {
    expect(resolveSpecifier({ fromPath: "src/__tests__/unit/a.test.ts", specifier: "#lib/result.js" })).toBe(
      "src/lib/result.ts",
    );
  });

  it("adds .ts to an extensionless relative specifier", () => {
    expect(resolveSpecifier({ fromPath: "src/__tests__/a.test.ts", specifier: "./helper" })).toBe(
      "src/__tests__/helper.ts",
    );
  });

  it("keeps an explicit .ts specifier as written", () => {
    expect(resolveSpecifier({ fromPath: "src/__tests__/a.test.ts", specifier: "./helper.ts" })).toBe(
      "src/__tests__/helper.ts",
    );
  });

  it("returns undefined for a package specifier, which names nothing in this repository", () => {
    expect(resolveSpecifier({ fromPath: "src/__tests__/a.test.ts", specifier: "zod" })).toBeUndefined();
  });

  it("returns undefined for a node builtin", () => {
    expect(resolveSpecifier({ fromPath: "src/__tests__/a.test.ts", specifier: "node:fs" })).toBeUndefined();
  });
});

describe("exportsValue", () => {
  it("counts an exported function", () => {
    expect(exportsValue({ content: "export function f(): void {}\n" })).toBe(true);
  });

  it("counts an exported const", () => {
    expect(exportsValue({ content: "export const X = 1;\n" })).toBe(true);
  });

  it("counts an exported class", () => {
    expect(exportsValue({ content: "export class C {}\n" })).toBe(true);
  });

  it("counts an exported enum", () => {
    expect(exportsValue({ content: "export enum E { A }\n" })).toBe(true);
  });

  it("counts a default export", () => {
    expect(exportsValue({ content: "const x = 1;\nexport default x;\n" })).toBe(true);
  });

  it("counts a value re-export", () => {
    expect(exportsValue({ content: 'export { a } from "./a.js";\n' })).toBe(true);
  });

  it("does not count a type-only re-export", () => {
    expect(exportsValue({ content: 'export type { T } from "./t.js";\n' })).toBe(false);
  });

  it("does not count a module of interfaces and type aliases", () => {
    expect(exportsValue({ content: "export interface I {\n  readonly a: string;\n}\nexport type T = I;\n" })).toBe(
      false,
    );
  });

  it("does not count an entry point whose whole body is a top-level invocation", () => {
    expect(exportsValue({ content: 'import { run } from "./run.js";\n\nprocess.exit(run());\n' })).toBe(false);
  });

  it("does not count a non-exported value", () => {
    expect(exportsValue({ content: "const x = 1;\nfunction f(): void {}\n" })).toBe(false);
  });

  it("does not count an empty module", () => {
    expect(exportsValue({ content: "" })).toBe(false);
  });
});

describe("untestedOf", () => {
  it("keeps only the value-exporting modules no test imports, in path order", () => {
    expect(
      untestedOf({
        importedByTests: new Set(["src/b.ts"]),
        valueExporting: ["src/c.ts", "src/a.ts", "src/b.ts"],
      }),
    ).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("is empty when every module is imported", () => {
    expect(untestedOf({ importedByTests: new Set(["src/a.ts"]), valueExporting: ["src/a.ts"] })).toEqual([]);
  });

  it("is empty when there are no modules at all", () => {
    expect(untestedOf({ importedByTests: new Set<string>(), valueExporting: [] })).toEqual([]);
  });
});

describe("BASELINE_FILE", () => {
  it("names the committed debt list the rebaseline verb writes", () => {
    expect(BASELINE_FILE).toBe(".baselines/untested-modules-baseline.json");
  });
});

describe("parseBaselineJson", () => {
  it("decodes a committed list", () => {
    expect(unwrap(parseBaselineJson({ text: '{"modules":["src/a.ts"]}' })).modules).toEqual(["src/a.ts"]);
  });

  it("decodes an empty list", () => {
    expect(unwrap(parseBaselineJson({ text: '{"modules":[]}' })).modules).toEqual([]);
  });

  it("names the file when the text is not JSON", () => {
    const result = parseBaselineJson({ text: "not json" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("untested-modules baseline: invalid JSON");
  });

  it("names the expected shape when the JSON is the wrong shape", () => {
    const result = parseBaselineJson({ text: "{}" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe(
      'untested-modules baseline: unexpected shape (expected { modules: ["path", …] })',
    );
  });
});

describe("regressionsOf", () => {
  it("names a module that is untested and absent from the committed list", () => {
    expect(regressionsOf({ baseline: { modules: ["src/a.ts"] }, current: ["src/a.ts", "src/b.ts"] })).toEqual([
      "src/b.ts",
    ]);
  });

  it("is empty when every untested module is already committed", () => {
    expect(regressionsOf({ baseline: { modules: ["src/a.ts", "src/b.ts"] }, current: ["src/a.ts"] })).toEqual([]);
  });

  it("is empty when nothing is untested", () => {
    expect(regressionsOf({ baseline: { modules: ["src/a.ts"] }, current: [] })).toEqual([]);
  });

  it("names everything when the committed list is empty", () => {
    expect(regressionsOf({ baseline: { modules: [] }, current: ["src/a.ts"] })).toEqual(["src/a.ts"]);
  });
});

describe("widenedOf", () => {
  it("refuses a rebaseline that would add a module the committed list does not carry", () => {
    expect(widenedOf({ baseline: { modules: ["src/a.ts"] }, current: ["src/a.ts", "src/b.ts"] })).toEqual(["src/b.ts"]);
  });

  it("permits a rebaseline that only removes modules", () => {
    expect(widenedOf({ baseline: { modules: ["src/a.ts", "src/b.ts"] }, current: ["src/a.ts"] })).toEqual([]);
  });
});
