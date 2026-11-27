import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  changedModuleStems,
  deriveTargetedTests,
  isUnitTestPath,
  mirroredUnitDirectory,
  moduleAliasesOf,
  REGISTRY_SWEEP_FILES,
  specifierMatchesAlias,
  specifierMayName,
  stemChangingAliases,
  TargetedTestsErrors,
  targetedProjects,
  targetedTestSteps,
  tsconfigExtends,
} from "../../../testLanes/targetedTests.js";

/** A checkout's unit inventory holding exactly the fixed sweep and one test in each sweep directory. */
const SWEEP_ONLY: readonly string[] = [
  ...REGISTRY_SWEEP_FILES,
  "src/__tests__/unit/canon/staleReferences.test.ts",
  "src/__tests__/unit/docs/docLinks.test.ts",
];
const SWEEP_ROWS = SWEEP_ONLY.toSorted().map((path) => ({ path, reasons: ["registry-sweep"] }));

describe("isUnitTestPath", () => {
  it("accepts a test under each of the three unit roots and refuses anything else", () => {
    expect(
      [
        "src/__tests__/unit/a/b.test.ts",
        "site/__tests__/unit/q.test.ts",
        "desktop/__tests__/unit/d.test.ts",
        "src/__tests__/subprocess/a.test.ts",
        "src/__tests__/unit/a/helper.ts",
        "src/a/b.test.ts",
      ].map((path) => isUnitTestPath({ path })),
    ).toEqual([true, true, true, false, false, false]);
  });
});

describe("mirroredUnitDirectory", () => {
  it("maps a source file in each project to its unit directory", () => {
    expect(mirroredUnitDirectory({ path: "src/cli/commands/dev/lint.ts" })).toBe(
      "src/__tests__/unit/cli/commands/dev/",
    );
    expect(mirroredUnitDirectory({ path: "site/lib/queueCard.tsx" })).toBe("site/__tests__/unit/lib/");
    expect(mirroredUnitDirectory({ path: "desktop/lib/window.ts" })).toBe("desktop/__tests__/unit/lib/");
  });

  it("mirrors a non-test helper inside a unit directory to that directory", () => {
    expect(mirroredUnitDirectory({ path: "src/__tests__/unit/cli/helpTruth/devAndProof.ts" })).toBe(
      "src/__tests__/unit/cli/helpTruth/",
    );
  });

  it("mirrors nothing for a project-root file, a unit-root helper, another test tree, or a non-TypeScript file", () => {
    expect(
      [
        "src/index.ts",
        "src/__tests__/unit/helper.ts",
        "src/__tests__/subprocess/x/fake.ts",
        "docs/toolchain.md",
        "src/cli/README.md",
        "scripts/x.ts",
      ].map((path) => mirroredUnitDirectory({ path })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("targetedProjects", () => {
  it("owes site for any site path and desktop only for desktop/src", () => {
    expect(targetedProjects({ changedPaths: ["site/app/page.tsx", "desktop/src/main.ts"] })).toEqual([
      "site",
      "desktop",
    ]);
    expect(targetedProjects({ changedPaths: ["desktop/__tests__/unit/a.test.ts", "src/a.ts"] })).toEqual([]);
  });
});

describe("deriveTargetedTests", () => {
  it("selects exactly the registry sweep for a diff that reaches nothing else", () => {
    const selection = unwrap(
      deriveTargetedTests({ changedPaths: ["README.md"], importsByTest: new Map(), testFiles: SWEEP_ONLY }),
    );
    expect(selection).toEqual({ projects: [], tests: SWEEP_ROWS });
  });

  it("selects a changed test, a direct importer and the mirrored directory, each with its reason", () => {
    const testFiles = [
      ...SWEEP_ONLY,
      "src/__tests__/unit/lib/date.test.ts",
      "src/__tests__/unit/lib/nested/deep.test.ts",
      "src/__tests__/unit/libx/other.test.ts",
      "src/__tests__/unit/cli/usesDate.test.ts",
      "src/__tests__/unit/cli/unrelated.test.ts",
      "src/__tests__/unit/handover/changed.test.ts",
    ];
    const selection = unwrap(
      deriveTargetedTests({
        changedPaths: ["src/lib/date.ts", "src/__tests__/unit/handover/changed.test.ts"],
        importsByTest: new Map([
          ["src/__tests__/unit/cli/usesDate.test.ts", ["src/lib/date.ts"]],
          ["src/__tests__/unit/cli/unrelated.test.ts", ["src/lib/result.ts"]],
        ]),
        testFiles,
      }),
    );
    expect(selection.tests.filter(({ reasons }) => !reasons.includes("registry-sweep"))).toEqual([
      { path: "src/__tests__/unit/cli/usesDate.test.ts", reasons: ["direct-import"] },
      { path: "src/__tests__/unit/handover/changed.test.ts", reasons: ["changed-test"] },
      { path: "src/__tests__/unit/lib/date.test.ts", reasons: ["mirrored-directory"] },
      { path: "src/__tests__/unit/lib/nested/deep.test.ts", reasons: ["mirrored-directory"] },
    ]);
  });

  it("lists a test reached by several rules once, its reasons in a fixed order", () => {
    const selection = unwrap(
      deriveTargetedTests({
        changedPaths: ["src/cli/helpTruthTable.ts", "src/__tests__/unit/cli/helpTruth.test.ts"],
        importsByTest: new Map([["src/__tests__/unit/cli/helpTruth.test.ts", ["src/cli/helpTruthTable.ts"]]]),
        testFiles: SWEEP_ONLY,
      }),
    );
    expect(selection.tests.find(({ path }) => path === "src/__tests__/unit/cli/helpTruth.test.ts")).toEqual({
      path: "src/__tests__/unit/cli/helpTruth.test.ts",
      reasons: ["changed-test", "direct-import", "mirrored-directory", "registry-sweep"],
    });
  });

  it("does not select a test that reaches a changed file only through another module", () => {
    const selection = unwrap(
      deriveTargetedTests({
        changedPaths: ["src/lib/leaf.ts"],
        importsByTest: new Map([["src/__tests__/unit/handover/far.test.ts", ["src/handover/middle.ts"]]]),
        testFiles: [...SWEEP_ONLY, "src/__tests__/unit/handover/far.test.ts"],
      }),
    );
    expect(selection.tests.map(({ path }) => path)).toEqual(SWEEP_ROWS.map(({ path }) => path));
  });

  it("never selects a changed test that is no longer present", () => {
    const selection = unwrap(
      deriveTargetedTests({
        changedPaths: ["src/__tests__/unit/gone.test.ts"],
        importsByTest: new Map(),
        testFiles: SWEEP_ONLY,
      }),
    );
    expect(selection.tests).toEqual(SWEEP_ROWS);
  });

  it("refuses when a named sweep file is absent rather than running a smaller sweep", () => {
    const testFiles = SWEEP_ONLY.filter((path) => path !== "src/__tests__/unit/cli/helpTruth.test.ts");
    expect(unwrapErr(deriveTargetedTests({ changedPaths: [], importsByTest: new Map(), testFiles }))).toEqual(
      TargetedTestsErrors.missingSweepTarget({ target: "src/__tests__/unit/cli/helpTruth.test.ts" }),
    );
  });

  it("refuses when a sweep directory holds no test", () => {
    const testFiles = SWEEP_ONLY.filter((path) => !path.startsWith("src/__tests__/unit/docs/"));
    expect(unwrapErr(deriveTargetedTests({ changedPaths: [], importsByTest: new Map(), testFiles })).target).toBe(
      "src/__tests__/unit/docs/",
    );
  });
});

describe("targetedTestSteps", () => {
  it("runs each owed project's tsc before one vitest over every selected file", () => {
    const steps = targetedTestSteps({
      selection: { projects: ["site"], tests: [{ path: "site/__tests__/unit/q.test.ts", reasons: ["changed-test"] }] },
    });
    expect(steps).toEqual([
      {
        argv: ["site/node_modules/.bin/tsc", "--noEmit", "--incremental", "false", "-p", "site/tsconfig.json"],
        label: "site tsc --noEmit",
      },
      {
        argv: [
          "node_modules/.bin/vitest",
          "run",
          "--config",
          "config/vitest/unit.ts",
          "--coverage=false",
          "site/__tests__/unit/q.test.ts",
        ],
        label: "vitest over 1 unit test file(s)",
      },
    ]);
  });
});

describe("changedModuleStems and specifierMayName", () => {
  it("names each changed source's stem, and an index file's directory too, never a test's", () => {
    expect(
      [
        ...changedModuleStems({
          changedPaths: ["src/lib/date.ts", "site/lib/card/index.tsx", "src/__tests__/unit/a.test.ts", "docs/x.md"],
        }),
      ].toSorted(),
    ).toEqual(["card", "date", "index"]);
  });

  it("matches no specifier when no stem changed", () => {
    expect(specifierMayName({ specifier: "../lib/date.js", stems: new Set() })).toBe(false);
  });

  it("matches a specifier's last segment with or without its extension", () => {
    const stems = new Set(["date", "card"]);
    expect(
      ["../../lib/date.js", "#lib/date.js", "@/lib/card", "./dateish.js", "vitest"].map((specifier) =>
        specifierMayName({ specifier, stems }),
      ),
    ).toEqual([true, true, true, false, false]);
  });
});

describe("moduleAliasesOf", () => {
  it("reads a tsconfig's compilerOptions.paths", () => {
    expect(
      moduleAliasesOf({
        kind: "tsconfig",
        value: {
          compilerOptions: { paths: { "@/*": ["./*"], typescript: ["./node_modules/typescript/lib/index.d.ts"] } },
        },
      }),
    ).toEqual([
      { pattern: "@/*", targets: ["./*"] },
      { pattern: "typescript", targets: ["./node_modules/typescript/lib/index.d.ts"] },
    ]);
  });

  it("reads every string leaf of a package.json imports entry, conditions included", () => {
    expect(
      moduleAliasesOf({
        kind: "package",
        value: { imports: { "#lib/*": "./src/lib/*", "#x": { default: "./x.js", types: ["./x.d.ts"] } } },
      }),
    ).toEqual([
      { pattern: "#lib/*", targets: ["./src/lib/*"] },
      { pattern: "#x", targets: ["./x.js", "./x.d.ts"] },
    ]);
  });

  it("declares nothing for a config without the field", () => {
    expect(moduleAliasesOf({ kind: "tsconfig", value: { compilerOptions: {} } })).toEqual([]);
    expect(moduleAliasesOf({ kind: "package", value: { name: "x" } })).toEqual([]);
  });
});

describe("tsconfigExtends", () => {
  it("reports an extends of either shape and nothing without one", () => {
    expect(
      [
        { compilerOptions: {}, extends: "./tsconfig.base.json" },
        { extends: ["./a.json", "./b.json"] },
        { compilerOptions: { paths: {} } },
        "not an object",
      ].map((value) => tsconfigExtends({ value })),
    ).toEqual([true, true, false, false]);
  });
});

describe("stemChangingAliases and specifierMatchesAlias", () => {
  it("drops only a trailing wildcard whose every target keeps the stem", () => {
    expect(
      stemChangingAliases({
        aliases: [
          { pattern: "#lib/*", targets: ["./src/lib/*"] },
          { pattern: "@/*", targets: ["./*", "./*.ts"] },
          { pattern: "@/shortcut", targets: ["./lib/foo.ts"] },
          { pattern: "~/*", targets: ["./lib/*/index.ts"] },
          { pattern: "*-x", targets: ["./*"] },
          { pattern: "@none/*", targets: [] },
        ],
      }),
    ).toEqual([
      { exact: true, prefix: "@/shortcut" },
      { exact: false, prefix: "~/" },
      { exact: false, prefix: "" },
      { exact: false, prefix: "@none/" },
    ]);
  });

  it("matches an exact alias only by itself and a wildcard by its prefix", () => {
    const aliases = [
      { exact: true, prefix: "@/shortcut" },
      { exact: false, prefix: "~/" },
    ];
    expect(
      ["@/shortcut", "@/shortcut/more", "~/card", "../lib/foo.js"].map((specifier) =>
        specifierMatchesAlias({ aliases, specifier }),
      ),
    ).toEqual([true, false, true, false]);
  });
});
