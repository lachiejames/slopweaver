/**
 * The whole-tree half of error-shape-threshold: a name imported from another module is followed through this
 * pool's own bindings to a fixed point, every shape is charged where it ENTERS an `err` call, and the walk stops
 * — producing nothing — at each piece of residue the gate's header names. Each pool here is a set of in-memory
 * files read by the real per-file half, so the facts are the ones the gate would build.
 */
import { describe, expect, it } from "vitest";
import { countsOf, MAX_PLAIN_SHAPES, overThreshold } from "../../../devLint/errorShapeThreshold.js";
import { scanErrorShapeFacts } from "../../../devLint/errorShapeThresholdFacts.js";
import { resolveErrorShapeFacts, type ShapeSite } from "../../../devLint/errorShapeThresholdResolve.js";

/** The `Result` constructors' import, appended so each file's line numbers stay the lines it was written on. */
const RESULT_IMPORT = '\nimport { err } from "#lib/result.js";\n';

/** Resolve a pool of `path → content` files, exactly as the gate does over the scanned tree. */
function resolvePool({ files }: { files: Readonly<Record<string, string>> }): readonly ShapeSite[] {
  const facts = Object.entries(files).flatMap(([path, content]) =>
    scanErrorShapeFacts({ content: content + RESULT_IMPORT, path }),
  );
  return resolveErrorShapeFacts({ facts });
}

/** The pool's sites as `<path>:<line> <shape>`. */
function sitesOf({ files }: { files: Readonly<Record<string, string>> }): readonly string[] {
  return resolvePool({ files }).map((site) => `${site.path}:${String(site.line)} ${site.shape}`);
}

describe("resolveErrorShapeFacts — names it follows across files", () => {
  it("follows a named import to the exporting module's const, charged at the importer's err", () => {
    const files = {
      "src/a/use.ts": 'import { USAGE } from "../b/usage.js";\nerr([USAGE]);\n',
      "src/b/usage.ts": 'export const USAGE = "usage: verb <id>";\n',
    };
    expect(sitesOf({ files })).toEqual(["src/a/use.ts:2 usage: verb <id>"]);
  });

  it("follows a renamed import, a default import of `export default NAME`, and a `#lib` specifier", () => {
    const files = {
      "src/a/use.ts": [
        'import { USAGE as U } from "../b/usage.js";',
        'import TRAILER from "../b/trailer.js";',
        'import { LIB_LINE } from "#lib/lines.js";',
        "err([U, TRAILER, LIB_LINE]);",
      ].join("\n"),
      "src/b/trailer.ts": 'const TRAILER = "nothing was recorded";\nexport default TRAILER;\n',
      "src/b/usage.ts": 'export const USAGE = "usage: verb";\n',
      "src/lib/lines.ts": 'export const LIB_LINE = "from the lib";\n',
    };
    expect(sitesOf({ files })).toEqual([
      "src/a/use.ts:4 usage: verb",
      "src/a/use.ts:4 nothing was recorded",
      "src/a/use.ts:4 from the lib",
    ]);
  });

  it("follows a default export written as an expression, through a re-export of `default`", () => {
    const files = {
      "src/a/use.ts": 'import { USAGE } from "../b/barrel.js";\nerr([USAGE]);\n',
      "src/b/barrel.ts": 'export { default as USAGE } from "./msg.js";\n',
      "src/b/msg.ts": 'export default "usage: " + "verb";\n',
    };
    expect(sitesOf({ files })).toEqual(["src/a/use.ts:2 usage: verb"]);
  });

  it("follows a named re-export and an `export { local as public }` to the declaring const", () => {
    const files = {
      "src/a/use.ts": 'import { PUBLIC } from "../b/index.js";\nerr([PUBLIC]);\n',
      "src/b/index.ts": 'export { PUBLIC } from "./inner.js";\n',
      "src/b/inner.ts": 'const LOCAL = "re-exported";\nexport { LOCAL as PUBLIC };\n',
    };
    expect(sitesOf({ files })).toEqual(["src/a/use.ts:2 re-exported"]);
  });

  it("follows an imported array of strings item by item", () => {
    const files = {
      "src/a/use.ts": 'import { LINES } from "../b/lines.js";\nerr(LINES);\n',
      "src/b/lines.ts": 'export const LINES = ["first", `second ${x}`, other];\n',
    };
    expect(sitesOf({ files })).toEqual(["src/a/use.ts:2 first", "src/a/use.ts:2 second {}"]);
  });

  it("ends an import cycle rather than looping", () => {
    const files = {
      "src/a/one.ts": 'import { TWO } from "./two.js";\nexport const ONE = TWO;\nerr([ONE]);\n',
      "src/a/two.ts": 'import { ONE } from "./one.js";\nexport const TWO = ONE;\n',
    };
    expect(sitesOf({ files })).toEqual([]);
  });
});

describe("resolveErrorShapeFacts — the residue, stated", () => {
  it("does not follow `export *`, a specifier without `.js`, a package, or a target outside the pool", () => {
    const files = {
      "src/a/use.ts": [
        'import { STAR } from "../b/index.js";',
        'import { NOEXT } from "../b/usage";',
        'import { PKG } from "some-package";',
        'import { GONE } from "../c/absent.js";',
        "err([STAR, NOEXT, PKG, GONE]);",
      ].join("\n"),
      "src/b/index.ts": 'export * from "./usage.js";\n',
      "src/b/usage.ts": 'export const STAR = "star";\nexport const NOEXT = "noext";\n',
    };
    expect(sitesOf({ files })).toEqual([]);
  });

  it("does not follow a namespace import's property, nor a type-only import", () => {
    const files = {
      "src/a/use.ts":
        'import * as u from "../b/usage.js";\nimport type { T } from "../b/usage.js";\nerr([u.USAGE, T]);\n',
      "src/b/usage.ts": 'export const USAGE = "usage";\nexport const T = "t";\n',
    };
    expect(sitesOf({ files })).toEqual([]);
  });

  it("does not follow an import that climbs out of the repository", () => {
    const files = { "src/use.ts": 'import { OUT } from "../../outside.js";\nerr([OUT]);\n' };
    expect(sitesOf({ files })).toEqual([]);
  });
});

describe("charging a shape where it is used", () => {
  it("charges one exported string to each directory whose err it enters, and none to where it was declared", () => {
    const files = {
      "src/a/use.ts": 'import { SHARED } from "../shared/lines.js";\nerr([SHARED]);\n',
      "src/b/use.ts": 'import { SHARED } from "../shared/lines.js";\nerr([SHARED]);\n',
      "src/shared/lines.ts": 'export const SHARED = "shared trailer";\n',
    };
    expect(countsOf({ sites: resolvePool({ files }) })).toEqual([
      { count: 1, path: "src/a" },
      { count: 1, path: "src/b" },
    ]);
  });

  it("refuses a fifth distinct shape reached only through names — the blind spot the first cut had", () => {
    const files = {
      "src/v/a.ts": 'import { ONE, TWO } from "./usage.js";\nerr([ONE]);\nerr([TWO]);\n',
      "src/v/b.ts": 'import { THREE, FOUR, FIVE } from "./usage.js";\nerr([THREE, FOUR]);\nerr(cond ? [FIVE] : []);\n',
      "src/v/usage.ts": [
        'export const ONE = "one";',
        'export const TWO = "two";',
        'export const THREE = "three";',
        'export const FOUR = "four";',
        'export const FIVE = "five";',
      ].join("\n"),
    };
    const counts = countsOf({ sites: resolvePool({ files }) });
    expect(counts).toEqual([{ count: 5, path: "src/v" }]);
    expect(overThreshold({ counts, max: MAX_PLAIN_SHAPES })).toEqual([{ count: 5, path: "src/v" }]);
  });
});
