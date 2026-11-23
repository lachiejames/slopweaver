/**
 * Every integration manifest stays cheap to import, and this is the only thing that says so.
 *
 * `src/integrations/registry.ts` imports every manifest eagerly, and the atlas registry and the atlas names are
 * derived from it on every invocation. One static `import { createDatadogClient } from "../../datadog/client.js"`
 * in a manifest would put Datadog's SDK on the cheapest verb in the build, and NOTHING would fail — so the witness
 * is each manifest's static runtime closure, walked on the syntax tree by `staticClosureOf` (the same walker
 * `unit/cli/manifestBarrelClosure.test.ts` uses), so an import's spelling or indentation cannot hide it.
 *
 * A manifest's eager closure is itself plus, at most, an atlas registration — which `unit/atlas/registrationLaziness.test.ts`
 * holds to type-only imports at the top — and names no package. Every feature implementation is reached inside an
 * `import()` thunk, which the walk does not follow by design.
 *
 * Its residue, stated: a registration's own BODY is not judged here. Code written straight into a
 * `src/atlas/<dir>/registration.ts` runs on import and this test lets that file through by path; what a registration
 * may contain is the atlas tree's contract (`.claude/rules/area-atlas.md`), held by that other test's import rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { staticClosureOf } from "../../../devLint/staticImportClosure.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** One atlas platform's registration — the one module a manifest may load eagerly. */
const ATLAS_REGISTRATION = /^src\/atlas\/[^/]+\/registration\.ts$/;

/** The files that sit at the top of `src/integrations/` and are not an integration. */
const TOP_LEVEL_FILES: ReadonlySet<string> = new Set([
  "connections.ts",
  "corpusProjections.ts",
  "corpusSources.ts",
  "manifest.ts",
  "policyRows.ts",
  "registry.ts",
  "routing.ts",
]);

/** Every manifest's repo-relative path, enumerated from disk by name, so a symlinked entry is still checked. */
function manifestPaths(): readonly string[] {
  return readdirSync(join(repoRoot, "src/integrations"))
    .filter((name) => !TOP_LEVEL_FILES.has(name))
    .map((name) => `src/integrations/${name}/integration.ts`);
}

/** Read one repo-relative file from the real tree. */
function readRepoText({ path }: { path: string }): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

/** What a manifest's eager closure reaches beyond itself and its atlas registration, plus any package it names. */
function eagerOverreach({ root, readText }: { root: string; readText: (path: string) => string }): {
  bare: readonly string[];
  files: readonly string[];
} {
  const closure = staticClosureOf({ readText, roots: [root] });
  return {
    bare: closure.bare.map(({ from, specifier }) => `${from}: ${specifier}`),
    files: closure.files.filter((path) => path !== root && !ATLAS_REGISTRATION.test(path)),
  };
}

describe("an integration manifest loads no implementation eagerly", () => {
  const paths = manifestPaths();

  it("there are manifests to check", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)("%s", (root) => {
    expect(eagerOverreach({ readText: (path) => readRepoText({ path }), root })).toEqual({ bare: [], files: [] });
  });

  it.each(["src/integrations/corpusSources.ts", "src/integrations/corpusProjections.ts"])(
    "%s loads only the registry, its manifests and their atlas registrations",
    (root) => {
      const closure = staticClosureOf({ readText: (path) => readRepoText({ path }), roots: [root] });
      expect(closure.files).toContain("src/integrations/registry.ts");
      expect(closure.bare).toEqual([]);
      expect(
        closure.files.filter(
          (path) =>
            path !== root &&
            path !== "src/integrations/registry.ts" &&
            !/^src\/integrations\/[^/]+\/integration\.ts$/.test(path) &&
            !ATLAS_REGISTRATION.test(path),
        ),
      ).toEqual([]);
    },
  );

  it("hooks/pretooluse.ts does not load the integration registry, so a tool call pays for no manifest", () => {
    const closure = staticClosureOf({ readText: (path) => readRepoText({ path }), roots: ["hooks/pretooluse.ts"] });
    expect(closure.files).toContain("src/admit/browserVerdictVocabulary.ts");
    expect(closure.files.filter((path) => path.startsWith("src/integrations/"))).toEqual([]);
  });

  it.each(["src/integrations/connections.ts", "src/integrations/routing.ts", "src/integrations/policyRows.ts"])(
    "%s is a pure projector that loads nothing eagerly",
    (root) => {
      const closure = staticClosureOf({ readText: (path) => readRepoText({ path }), roots: [root] });
      expect({ bare: closure.bare, files: closure.files.filter((path) => path !== root) }).toEqual({
        bare: [],
        files: [],
      });
    },
  );

  it("the walk sees an atlas registration through a manifest that declares one", () => {
    const closure = staticClosureOf({
      readText: (path) => readRepoText({ path }),
      roots: ["src/integrations/knock/integration.ts"],
    });
    expect(closure.files).toContain("src/atlas/knock/registration.ts");
  });

  it("can fail: an indented static import of an implementation module is caught", () => {
    const root = "src/integrations/datadog/integration.ts";
    const planted = ` import { createDatadogClient } from "../../datadog/client.js";\n${readRepoText({ path: root })}`;
    const overreach = eagerOverreach({
      readText: (path) => (path === root ? planted : readRepoText({ path })),
      root,
    });
    expect(overreach.files).toContain("src/datadog/client.ts");
  });

  it("can fail: an import-equals require of an implementation module is caught", () => {
    const root = "src/integrations/datadog/integration.ts";
    const planted = `${readRepoText({ path: root })}\nimport client = require("../../datadog/client.js");\n`;
    const overreach = eagerOverreach({
      readText: (path) => (path === root ? planted : readRepoText({ path })),
      root,
    });
    expect(overreach.files).toContain("src/datadog/client.ts");
  });
});
