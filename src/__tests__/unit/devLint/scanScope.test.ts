import { describe, expect, it } from "vitest";
import { gateSelfFiles, gateSelfPaths, isScannablePath, type ScanScope } from "../../../devLint/scanScope.js";

describe("gateSelfFiles", () => {
  it("builds the source/entry/test triad from a stem", () => {
    expect(gateSelfFiles({ stem: "maxFunctionLines" })).toEqual(
      new Set(["maxFunctionLines.ts", "maxFunctionLines.entry.ts", "maxFunctionLines.test.ts"]),
    );
  });
});

describe("isScannablePath", () => {
  const baseScope: ScanScope = { selfFiles: new Set(), trees: ["src/"] };

  it("accepts a .ts file under an in-scope tree", () => {
    expect(isScannablePath({ path: "src/foo.ts", scope: baseScope })).toBe(true);
  });

  it("rejects a path outside every declared tree", () => {
    expect(isScannablePath({ path: "docs/foo.ts", scope: baseScope })).toBe(false);
  });

  it("treats an empty tree list as every file", () => {
    expect(isScannablePath({ path: "docs/foo.ts", scope: { selfFiles: new Set(), trees: [] } })).toBe(true);
  });

  it("matches src/, eval/ and hooks/ when all three are declared", () => {
    const scope: ScanScope = { selfFiles: new Set(), trees: ["src/", "eval/", "hooks/"] };
    expect(isScannablePath({ path: "eval/routing.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse-admit.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "docs/plan.ts", scope })).toBe(false);
  });

  it("matches skills/ when declared, and not a tree that merely shares its prefix", () => {
    const scope: ScanScope = { extensions: [".md"], selfFiles: new Set(), trees: ["skills/"] };
    expect(isScannablePath({ path: "skills/github/SKILL.md", scope })).toBe(true);
    expect(isScannablePath({ path: "skills/github/reference/pull-requests.md", scope })).toBe(true);
    expect(isScannablePath({ path: "skills-other/x.md", scope })).toBe(false);
  });

  it("selects an extensionless file only when the scope opts in", () => {
    const optIn: ScanScope = { includeExtensionless: true, selfFiles: new Set(), trees: ["hooks/"] };
    expect(isScannablePath({ path: "hooks/run", scope: optIn })).toBe(true);
    expect(isScannablePath({ path: "hooks/run.md", scope: optIn })).toBe(false);
    expect(isScannablePath({ path: "hooks/run", scope: { selfFiles: new Set(), trees: ["hooks/"] } })).toBe(false);
  });

  it("rejects an extension outside the declared set", () => {
    expect(isScannablePath({ path: "src/foo.md", scope: baseScope })).toBe(false);
  });

  it("honours a non-default extension set", () => {
    const scope: ScanScope = { extensions: [".plist"], selfFiles: new Set(), trees: [] };
    expect(isScannablePath({ path: "hooks/job.plist", scope })).toBe(true);
    expect(isScannablePath({ path: "src/foo.ts", scope })).toBe(false);
  });

  it("excludes a self file by basename regardless of tree", () => {
    const scope: ScanScope = { selfFiles: new Set(["foo.ts"]), trees: ["src/"] };
    expect(isScannablePath({ path: "src/nested/foo.ts", scope })).toBe(false);
  });

  it("excludes a self file by exact path, and keeps a same-named file in another directory", () => {
    const scope: ScanScope = { selfFiles: gateSelfPaths({ stem: "foo" }), trees: ["src/", "desktop/"] };
    expect(isScannablePath({ path: "src/devLint/foo.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/foo.entry.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/foo.test.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "desktop/src/foo.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "src/nested/foo.ts", scope })).toBe(true);
  });

  it("excludeTests drops *.test.ts", () => {
    const scope: ScanScope = { excludeTests: true, selfFiles: new Set(), trees: ["src/"] };
    expect(isScannablePath({ path: "src/foo.test.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "src/foo.ts", scope })).toBe(true);
  });

  it("with no excludeTests, *.test.ts is in scope like any other .ts file", () => {
    expect(isScannablePath({ path: "src/foo.test.ts", scope: baseScope })).toBe(true);
  });

  it("excludeTestsDir drops any path containing __tests__/", () => {
    const scope: ScanScope = { excludeTestsDir: true, selfFiles: new Set(), trees: ["src/"] };
    expect(isScannablePath({ path: "src/__tests__/unit/foo.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "src/foo.ts", scope })).toBe(true);
  });

  it("onlyTests accepts only *.test.ts, ignoring the tree list", () => {
    const scope: ScanScope = { onlyTests: true, selfFiles: new Set(), trees: [] };
    expect(isScannablePath({ path: "src/foo.test.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "src/foo.ts", scope })).toBe(false);
  });

  it("onlyTestsDir accepts every .ts file under a __tests__/ directory, test file or not", () => {
    const scope: ScanScope = { onlyTestsDir: true, selfFiles: new Set(), trees: ["src/"] };
    expect(isScannablePath({ path: "src/__tests__/setup-polly.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/unit/foo.test.ts", scope })).toBe(true);
    expect(isScannablePath({ path: "src/homeDir.ts", scope })).toBe(false);
  });

  it("onlyTestsDir still respects the tree list and the self files", () => {
    const scope: ScanScope = { onlyTestsDir: true, selfFiles: new Set(["foo.ts"]), trees: ["src/"] };
    expect(isScannablePath({ path: "eval/__tests__/foo.ts", scope })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/foo.ts", scope })).toBe(false);
  });
});
