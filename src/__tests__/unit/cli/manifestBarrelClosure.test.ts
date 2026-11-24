/**
 * The manifest barrel is METADATA ONLY, and this is what keeps it that way.
 *
 * Every invocation imports `src/cli/nounGroups.ts`, so whatever its static runtime closure reaches is paid
 * by every verb — `--help` included. MEASURED on the parent of the change that closed it:
 * `dist-cli/cli/main.js` loaded 1,613 modules, 1,579 of them through `nounGroups.js`, because manifests
 * imported usage strings out of the command modules they describe. With the usage strings moved into leaves,
 * the same count is 399 and 196, and `nounGroups.js` loads no npm package (repro: build with
 * `slopweaver dev build`, then count the `file:` URLs a `node:module` `registerHooks` load hook sees while
 * importing `dist-cli/cli/main.js`). A manifest's `lazy(() => import(…))` is the load that must stay deferred;
 * an eager `import` beside it silently undoes that.
 *
 * The criterion, over C = the static runtime closure of `src/cli/nounGroups.ts`:
 *
 * - **No packages.** C names no npm package and no `node:` builtin.
 * - **No command code.** Every file in C under `src/cli/` is a manifest, the root, a usage leaf (basename
 *   `usage.ts` or ending `Usage.ts`), or one of {@link DECLARED_CLI_LEAVES}.
 * - **Shared leaves are pinned.** C's files outside `src/cli/`, less the atlas registrations and the integration
 *   manifests, EQUAL
 *   {@link DECLARED_SHARED_LEAVES} — so adding or removing one is a reviewed edit here, never a drift.
 *
 * Two witnesses keep the walk honest: C holds the barrel and a known leaf, and a real command module's own
 * closure DOES report packages, so the no-packages check is shown able to fail on this tree.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { staticClosureOf } from "../../../devLint/staticImportClosure.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The walk's root: what `main.ts` imports on every invocation. */
const ROOT = "src/cli/nounGroups.ts";

/**
 * `src/cli/` modules reached that are neither a manifest nor a `*Usage.ts` leaf, each a leaf in fact:
 * `manifest.ts` is the `lazy` wrap (type-only imports), `nounAliases.ts` is one literal map and two pure
 * lookups, and the automation and refresh modules hold nothing but literals under names that predate the
 * usage-leaf convention.
 */
const DECLARED_CLI_LEAVES: ReadonlySet<string> = new Set([
  "src/cli/commands/automation/core.ts",
  "src/cli/commands/refresh/flags.ts",
  "src/cli/manifest.ts",
  "src/cli/nounAliases.ts",
]);

/** Every module outside `src/cli/` the metadata graph may reach, atlas registrations aside. Sorted. */
const DECLARED_SHARED_LEAVES: readonly string[] = [
  "src/accessReview/levels.ts",
  "src/admit/inventedVisual.ts",
  "src/atlas/kit/verbs.ts",
  "src/atlas/registry.ts",
  "src/datadog/investigate/spec.ts",
  "src/integrations/corpusSources.ts",
  "src/integrations/policyRows.ts",
  "src/integrations/registry.ts",
  "src/lib/parsers.ts",
  "src/live/github/jobLog.ts",
  "src/live/github/testFailurePaths.ts",
  "src/live/listen/supervise/rearm.ts",
  "src/live/turn/liveStatusCap.ts",
  "src/outbound/github/adminMergeCommand.ts",
  "src/outbound/github/holdLedgerLimits.ts",
  "src/outbound/github/mergeHold.ts",
  "src/outbound/proposal/register/events.ts",
  "src/pdf/limits.ts",
  "src/review/readCadence.ts",
];

/** One atlas platform's registration — type-only imports, so a leaf by construction. */
const ATLAS_REGISTRATION = /^src\/atlas\/[^/]+\/registration\.ts$/;

/** One integration's manifest — strings, its atlas registration and thunks (`unit/integrations/manifestLaziness.test.ts`). */
const INTEGRATION_MANIFEST = /^src\/integrations\/[^/]+\/integration\.ts$/;

/** Read one repo-relative file from the real tree. */
function readRepoText({ path }: { path: string }): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

/** Whether a `src/cli/` module is one the metadata graph may load. */
function isAllowedCliModule({ path }: { path: string }): boolean {
  const name = basename(path);
  return (
    path.startsWith("src/cli/manifests/") ||
    path === ROOT ||
    name === "usage.ts" ||
    name.endsWith("Usage.ts") ||
    DECLARED_CLI_LEAVES.has(path)
  );
}

const closure = staticClosureOf({ readText: (path) => readRepoText({ path }), roots: [ROOT] });

describe("the manifest barrel's static runtime closure", () => {
  it("reaches the barrel and a known usage leaf (the walk is not empty)", () => {
    expect(closure.files.length).toBeGreaterThan(0);
    expect(closure.files).toContain("src/cli/manifests/index.ts");
    expect(closure.files).toContain("src/cli/commands/listen/listenUsage.ts");
  });

  it("can fail: a real command module's closure does name packages", () => {
    const command = staticClosureOf({
      readText: (path) => readRepoText({ path }),
      roots: ["src/cli/commands/listen/recover.ts"],
    });
    expect(command.bare.length).toBeGreaterThan(0);
  });

  it("names no npm package and no node: builtin", () => {
    expect(closure.bare).toEqual([]);
  });

  it("loads no command implementation under src/cli/", () => {
    const offenders = closure.files.filter((path) => path.startsWith("src/cli/") && !isAllowedCliModule({ path }));
    expect(offenders).toEqual([]);
  });

  it("reaches exactly the declared shared leaves outside src/cli/", () => {
    const shared = closure.files.filter(
      (path) => !path.startsWith("src/cli/") && !ATLAS_REGISTRATION.test(path) && !INTEGRATION_MANIFEST.test(path),
    );
    expect(shared).toEqual(DECLARED_SHARED_LEAVES);
  });
});
