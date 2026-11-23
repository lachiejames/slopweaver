import { describe, expect, it } from "vitest";
import { namedImports, resolvedImportPath } from "../../../devLint/homeCallSites.js";
import { envHomeReadLines, scanEnvHomeReads } from "../../../devLint/homeEnvReads.js";
import {
  homeDefaultingExportNames,
  isScannablePathForHomeSafety,
  scanHomeSafety,
  unsafeHomeCalls,
} from "../../../devLint/homeSafety.js";

/**
 * The variable name the env-home-read half refuses, assembled rather than written whole.
 *
 * This suite is excluded from the gate's own scan by basename, so a literal would not fail it — but every
 * fixture below has to spell the thing being refused, and a file full of the exact string a sibling gate
 * greps for is a trap the next reader falls into. Assembling it keeps the fixtures honest about their shape
 * while leaving no copy of the literal in the tree.
 */
const HOME_VAR = `SLOPWEAVER${"_"}HOME`;

describe("homeDefaultingExportNames", () => {
  it("finds a function whose sole `home` parameter defaults through slopweaverHome()", () => {
    const content = "export function stateHomePaths({ home = slopweaverHome() }: { home?: string } = {}) {}";
    expect(homeDefaultingExportNames({ content })).toEqual(["stateHomePaths"]);
  });

  it("finds an arrow function assigned to an exported const, the same way", () => {
    const content = "export const secretFilePath = ({ home = slopweaverHome() }: { home?: string }) => home;";
    expect(homeDefaultingExportNames({ content })).toEqual(["secretFilePath"]);
  });

  it("does not flag `slopweaverHome`'s own declaration — the empty-parens trap a raw substring falls into", () => {
    const content = "export function slopweaverHome(): string { return process.env['X'] ?? '/default'; }";
    expect(homeDefaultingExportNames({ content })).toEqual([]);
  });

  it("does not flag a CLI-verb function that reaches slopweaverHome() with no `home` in its own signature", () => {
    // The exact shape `runGithubMerge({ argv, deps })` measured in mergeRun.ts: `home` is parsed OUT OF
    // `argv` inside the body, never a property of this function's own parameter.
    const content =
      "export function runGithubMerge({ argv, deps }: { argv: readonly string[]; deps: unknown }): number {\n" +
      "  const home = slopweaverHome();\n" +
      "  return 0;\n" +
      "}";
    expect(homeDefaultingExportNames({ content })).toEqual([]);
  });

  it("does not flag a function with a `home` parameter that never reaches slopweaverHome()", () => {
    const content = "export function withHome({ home }: { home: string }) { return home; }";
    expect(homeDefaultingExportNames({ content })).toEqual([]);
  });

  it("does not flag a non-exported function, even one shaped exactly like a home-defaulter", () => {
    const content = "function stateHomePaths({ home = slopweaverHome() }: { home?: string } = {}) {}";
    expect(homeDefaultingExportNames({ content })).toEqual([]);
  });
});

describe("unsafeHomeCalls", () => {
  const homeDefaultingExports = new Map([["src/stateHome.ts", new Set(["stateHomePaths"])]]);

  it("flags a call with zero arguments", () => {
    const content = 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths();';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([
      "stateHomePaths",
    ]);
  });

  it("flags a call whose sole object argument has no `home` property", () => {
    const content = 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths({ other: 1 });';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([
      "stateHomePaths",
    ]);
  });

  it("does not flag a call that passes `home`, shorthand", () => {
    const content =
      'import { stateHomePaths } from "../stateHome.js";\nconst home = "/tmp/x";\nstateHomePaths({ home });';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("does not flag a call that passes `home` in full form", () => {
    const content = 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths({ home: "/tmp/x" });';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("does not flag a call whose sole argument is a spread — unknowable, so it is left alone", () => {
    const content = 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths({ ...opts });';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("does not flag a call whose sole argument is a plain variable — unknowable, so it is left alone", () => {
    const content = 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths(opts);';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("does not flag a call to an import that does not resolve to a known home-defaulting export", () => {
    const content = 'import { otherThing } from "../stateHome.js";\notherThing();';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("does not flag a call to a same-named function imported from an UNRELATED file", () => {
    const content = 'import { stateHomePaths } from "../somewhere/else.js";\nstateHomePaths();';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("respects an import alias, checking the ORIGINAL exported name against the risky set", () => {
    const content = 'import { stateHomePaths as sp } from "../stateHome.js";\nsp();';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual(["sp"]);
  });

  it("is exempted by a `home-safety-exempt` comment directly above the call", () => {
    const content =
      'import { stateHomePaths } from "../stateHome.js";\n' +
      "// home-safety-exempt: deliberately proves the default, with every I/O edge faked\n" +
      "stateHomePaths();";
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/sub/x.test.ts" })).toEqual([]);
  });

  it("resolves the relative import against the IMPORTING file's own directory, not the repo root", () => {
    const content = 'import { stateHomePaths } from "../../stateHome.js";\nstateHomePaths();';
    expect(unsafeHomeCalls({ content, homeDefaultingExports, importerPath: "src/__tests__/unit/x.test.ts" })).toEqual([
      "stateHomePaths",
    ]);
  });
});

describe("scanHomeSafety", () => {
  const homeDefaultingExports = new Map([["src/stateHome.ts", new Set(["stateHomePaths"])]]);

  it("reports one hit per unsafe test file, and nothing for a safe one", () => {
    const testFiles = [
      { content: 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths();', path: "src/sub/a.test.ts" },
      {
        content: 'import { stateHomePaths } from "../stateHome.js";\nstateHomePaths({ home: "/tmp/x" });',
        path: "src/sub/b.test.ts",
      },
    ];
    expect(scanHomeSafety({ homeDefaultingExports, testFiles })).toEqual([
      { calls: ["stateHomePaths"], path: "src/sub/a.test.ts" },
    ]);
  });

  it("reports zero hits when nothing calls a home-defaulting export unsafely", () => {
    const testFiles = [{ content: "export const x = 1;", path: "src/a.test.ts" }];
    expect(scanHomeSafety({ homeDefaultingExports, testFiles })).toEqual([]);
  });
});

describe("envHomeReadLines", () => {
  it("flags an element-access read at module scope — setup-polly.ts's exact shape", () => {
    const content = `const HOME = process.env["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([1]);
  });

  it("flags the dotted spelling too", () => {
    const content = `const HOME = process.env.${HOME_VAR};\n`;
    expect(envHomeReadLines({ content })).toEqual([1]);
  });

  it("reports the line the read sits on, not the line the file starts at", () => {
    const content = `const a = 1;\nconst b = 2;\nconst home = process.env["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([3]);
  });

  it("does not flag an assignment — that is the ambient-home sandbox's own mechanism", () => {
    const content = `process.env["${HOME_VAR}"] = sandbox;\n`;
    expect(envHomeReadLines({ content })).toEqual([]);
  });

  it("does not flag a delete — a test restoring an unset variable", () => {
    const content = `delete process.env["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([]);
  });

  it("does not flag a read of some other environment variable", () => {
    const content = 'const mode = process.env["POLLY_MODE"];\n';
    expect(envHomeReadLines({ content })).toEqual([]);
  });

  it("does not flag the same key read off something that is not process.env", () => {
    const content = `const home = config["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([]);
  });

  it("honours an exemption marker on the statement above, not merely on the expression", () => {
    const content = `// home-safety-exempt: saves and restores the variable this suite tests\nconst original = process.env["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([]);
  });

  it("flags a read whose marker sits on an unrelated earlier statement", () => {
    const content = `// home-safety-exempt: not this one\nconst a = 1;\nconst home = process.env["${HOME_VAR}"];\n`;
    expect(envHomeReadLines({ content })).toEqual([3]);
  });

  it("flags every read in a file, in source order", () => {
    const content = `const a = process.env["${HOME_VAR}"];\nconst b = process.env.${HOME_VAR};\n`;
    expect(envHomeReadLines({ content })).toEqual([1, 2]);
  });
});

describe("scanEnvHomeReads", () => {
  it("reports one hit per offending file, carrying its lines", () => {
    const treeFiles = [
      { content: `const HOME = process.env["${HOME_VAR}"];\n`, path: "src/__tests__/setup-polly.ts" },
      { content: "export const x = 1;\n", path: "src/__tests__/clean.ts" },
    ];
    expect(scanEnvHomeReads({ treeFiles })).toEqual([{ lines: [1], path: "src/__tests__/setup-polly.ts" }]);
  });

  it("reports nothing for a tree that never reads the variable", () => {
    const treeFiles = [{ content: "export const x = 1;\n", path: "src/__tests__/clean.ts" }];
    expect(scanEnvHomeReads({ treeFiles })).toEqual([]);
  });
});

describe("isScannablePathForHomeSafety", () => {
  it("scans a non-test source file under src/", () => {
    expect(isScannablePathForHomeSafety({ path: "src/stateHome.ts" })).toBe(true);
  });

  it("scans a test file under src/", () => {
    expect(isScannablePathForHomeSafety({ path: "src/__tests__/unit/stateHome.test.ts" })).toBe(true);
  });

  it("excludes this gate's own source, entry point and test", () => {
    expect(isScannablePathForHomeSafety({ path: "src/devLint/homeSafety.ts" })).toBe(false);
    expect(isScannablePathForHomeSafety({ path: "src/devLint/homeSafety.entry.ts" })).toBe(false);
  });

  it("excludes the call-site reader split out of the gate, exactly as it excludes the gate itself", () => {
    expect(isScannablePathForHomeSafety({ path: "src/devLint/homeSafety.ts" })).toBe(false);
    expect(isScannablePathForHomeSafety({ path: "src/devLint/homeCallSites.ts" })).toBe(false);
  });

  it("still scans a file elsewhere that shares the split-out reader's name — it is excluded by path, not basename", () => {
    expect(isScannablePathForHomeSafety({ path: "src/feature/homeCallSites.ts" })).toBe(true);
  });

  it("excludes a non-TypeScript file", () => {
    expect(isScannablePathForHomeSafety({ path: "docs/security.md" })).toBe(false);
  });

  it("scans a test-tree file that is neither source nor a test file — the gap the env half closes", () => {
    expect(isScannablePathForHomeSafety({ path: "src/__tests__/setup-polly.ts" })).toBe(true);
  });
});

describe("namedImports", () => {
  it("keeps each in-repo value binding with its exported name, dropping an inline type specifier and a package", () => {
    const content = [
      `import { type StateHome, stateHomePaths as paths } from "../stateHome.js";`,
      `import { unwrap } from "#lib/result.js";`,
      `import { readFileSync } from "node:fs";`,
    ].join("\n");
    expect(namedImports({ content })).toEqual([
      { imported: "stateHomePaths", local: "paths", specifier: "../stateHome.js" },
      { imported: "unwrap", local: "unwrap", specifier: "#lib/result.js" },
    ]);
  });
});

describe("resolvedImportPath", () => {
  it("resolves a relative specifier against the importing file's directory", () => {
    expect(resolvedImportPath({ importerPath: "src/__tests__/unit/a.test.ts", specifier: "../../stateHome.js" })).toBe(
      "src/stateHome.ts",
    );
  });

  it("resolves a subpath import through the declared root, not the importer's directory", () => {
    expect(resolvedImportPath({ importerPath: "src/__tests__/unit/a.test.ts", specifier: "#lib/result.js" })).toBe(
      "src/lib/result.ts",
    );
  });

  it("declines a specifier that is not .js-suffixed or that escapes the repository", () => {
    expect(resolvedImportPath({ importerPath: "src/a.test.ts", specifier: "./b" })).toBe(undefined);
    expect(resolvedImportPath({ importerPath: "src/a.test.ts", specifier: "../../outside.js" })).toBe(undefined);
  });
});
