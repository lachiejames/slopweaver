import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readTargetedTestInventory } from "../../../testLanes/targetedTestImports.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const TSCONFIG = JSON.stringify({
  compilerOptions: { module: "nodenext", moduleResolution: "nodenext", strict: true },
});

const IMPORTING_TEST = "src/__tests__/unit/lib/foo.test.ts";

const UNRELATED_TEST = "src/__tests__/unit/lib/bar.test.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A throwaway checkout holding `files`, each staged when `tracked`, so `git ls-files` lists it. */
function fixture({ files, tracked }: { files: Readonly<Record<string, string>>; tracked: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "targeted-inventory-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  if (tracked) {
    gitInTemp({ args: ["init", "-q"], cwd: root });
    gitInTemp({ args: ["add", "-A"], cwd: root });
  }
  return root;
}

/** The checkout every case starts from: one source file, one test importing it and one that does not. */
const BASE_FILES: Readonly<Record<string, string>> = {
  [IMPORTING_TEST]: 'import { foo } from "../../../lib/foo.js";\nfoo();\n',
  [UNRELATED_TEST]: 'import { describe } from "vitest";\ndescribe("bar", () => {});\n',
  "src/lib/foo.ts": "export function foo(): void {}\n",
  "tsconfig.json": TSCONFIG,
};

const CHANGED_SOURCE: readonly string[] = ["src/lib/foo.ts"];

describe("readTargetedTestInventory", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("lists every tracked unit test and resolves only the imports that may name a changed file", () => {
    const root = fixture({ files: BASE_FILES, tracked: true });
    const inventory = unwrap(readTargetedTestInventory({ changedPaths: CHANGED_SOURCE, root }));
    expect(inventory.testFiles).toEqual([UNRELATED_TEST, IMPORTING_TEST]);
    expect([...inventory.importsByTest]).toEqual([[IMPORTING_TEST, ["src/lib/foo.ts"]]]);
  });

  it("adds an untracked test the diff wrote, and drops a changed test no longer on disk", () => {
    const root = fixture({ files: BASE_FILES, tracked: true });
    writeFileSync(join(root, "src/__tests__/unit/lib/new.test.ts"), "export {};\n");
    const changedPaths = ["src/__tests__/unit/lib/new.test.ts", "src/__tests__/unit/lib/gone.test.ts"];
    const inventory = unwrap(readTargetedTestInventory({ changedPaths, root }));
    expect(inventory.testFiles).toEqual([UNRELATED_TEST, IMPORTING_TEST, "src/__tests__/unit/lib/new.test.ts"]);
    expect([...inventory.importsByTest]).toEqual([]);
  });

  it("refuses a checkout git cannot list, rather than reading an empty inventory", () => {
    const root = fixture({ files: BASE_FILES, tracked: false });
    const failure = unwrapErr(readTargetedTestInventory({ changedPaths: CHANGED_SOURCE, root }));
    expect(failure.code).toBe("TEST_LIST_UNREADABLE");
  });

  it("refuses a tsconfig inheriting through extends, naming the config", () => {
    const files = { ...BASE_FILES, "site/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json" }) };
    const root = fixture({ files, tracked: true });
    expect(unwrapErr(readTargetedTestInventory({ changedPaths: CHANGED_SOURCE, root }))).toEqual({
      code: "ALIAS_CONFIG_UNREADABLE",
      config: "site/tsconfig.json",
      message:
        "dev targeted-tests: cannot read the aliases site/tsconfig.json declares (it declares `extends`, which this " +
        "reader does not follow, so an inherited alias is unknown), so an aliased import is unknown",
    });
  });

  it("refuses a package.json that does not parse, rather than reading it as declaring no alias", () => {
    const root = fixture({ files: { ...BASE_FILES, "package.json": "{ not json" }, tracked: true });
    const failure = unwrapErr(readTargetedTestInventory({ changedPaths: CHANGED_SOURCE, root }));
    expect(failure.code).toBe("ALIAS_CONFIG_UNREADABLE");
    expect(failure.message).toContain("package.json");
  });

  it("refuses a test path it cannot read, naming that path", () => {
    const root = fixture({ files: BASE_FILES, tracked: true });
    mkdirSync(join(root, "src/__tests__/unit/lib/folder.test.ts"));
    const changedPaths = [...CHANGED_SOURCE, "src/__tests__/unit/lib/folder.test.ts"];
    const failure = unwrapErr(readTargetedTestInventory({ changedPaths, root }));
    expect(failure.code).toBe("TEST_FILE_UNREADABLE");
    expect(failure.message).toContain("src/__tests__/unit/lib/folder.test.ts");
  });

  it("refuses a root tsconfig that does not parse, naming it", () => {
    const root = fixture({ files: { ...BASE_FILES, "tsconfig.json": "{ not json" }, tracked: true });
    const failure = unwrapErr(readTargetedTestInventory({ changedPaths: CHANGED_SOURCE, root }));
    expect(failure.code).toBe("ALIAS_CONFIG_UNREADABLE");
    expect(failure.message).toContain("tsconfig.json");
  });
});
