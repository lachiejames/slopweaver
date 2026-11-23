/**
 * `running-checkout-root` — the gate that keeps `repoRootOf`/`currentBranchOf` inside the gate directories,
 * where a module-anchored repository lookup is correct, and out of every runtime verb, where it throws under
 * a marketplace plugin install. Both halves of the gate are pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";
import { findModuleAnchoredLookups, inScope } from "../../../devLint/runningCheckoutRoot.js";

// register-class: module-anchored-repo-lookup-in-a-runtime-verb (docs/recurring-failure-register/bindings.md)

describe("findModuleAnchoredLookups", () => {
  it("flags a repoRootOf call", () => {
    const hits = findModuleAnchoredLookups({
      content: "const root = repoRootOf({ importMetaUrl: import.meta.url });",
      path: "src/live/turn/posterAnswer.ts",
    });

    expect(hits.map((hit) => hit.line)).toEqual([1]);
    expect(hits.map((hit) => hit.path)).toEqual(["src/live/turn/posterAnswer.ts"]);
  });

  it("flags a currentBranchOf call", () => {
    const hits = findModuleAnchoredLookups({
      content: 'const branch = currentBranchOf({ importMetaUrl: import.meta.url }) ?? "detached";',
      path: "src/live/turn/askSessionPlan.ts",
    });

    expect(hits.map((hit) => hit.line)).toEqual([1]);
  });

  it("reports the line number of a hit that is not the first line", () => {
    const hits = findModuleAnchoredLookups({
      content: ["import { repoRootFromDirectory } from './gitRepo.js';", "", "repoRootOf({});"].join("\n"),
      path: "src/cli/commands/turn/brief.ts",
    });

    expect(hits.map((hit) => hit.line)).toEqual([3]);
  });

  it("flags a mention in a comment, because a stale comment is how the class taught itself back in", () => {
    const hits = findModuleAnchoredLookups({
      content: " * `.git` at all, so {@link repoRootOf} throws there.",
      path: "src/reflect/brief.ts",
    });

    expect(hits.map((hit) => hit.line)).toEqual([1]);
  });

  it("does not flag the sanctioned replacements", () => {
    const content = ["runningCheckoutRoot();", 'runningCheckoutBranch() ?? "detached";'].join("\n");

    expect(findModuleAnchoredLookups({ content, path: "src/live/turn/posterAnswer.ts" })).toEqual([]);
  });

  it("does not flag a longer identifier that merely contains one of the names", () => {
    const content = "const x = myRepoRootOfThing();\nconst y = currentBranchOfTheirs();";

    expect(findModuleAnchoredLookups({ content, path: "src/live/turn/posterAnswer.ts" })).toEqual([]);
  });

  it("returns nothing for a file naming neither", () => {
    expect(findModuleAnchoredLookups({ content: "export const x = 1;", path: "src/lib/x.ts" })).toEqual([]);
  });
});

/**
 * The scope decision is the half that fails SILENTLY when it is wrong: a gate that excludes `src/live/`
 * reports clean over the exact file the incident happened in, and nothing anywhere says so.
 */
describe("inScope", () => {
  it.each([
    "src/live/turn/posterAnswer.ts",
    "src/live/turn/askSessionPlan.ts",
    "src/cli/commands/turn/brief.ts",
    "src/reflect/brief.ts",
    "src/cmux/pluginDir.ts",
    "hooks/pretooluse.ts",
  ])("scans %s", (path) => {
    expect(inScope({ path })).toBe(true);
  });

  it.each(["src/devLint/scanScope.ts", "src/hygiene/scan.ts", "src/lib/gitRepo.ts"])(
    "leaves %s alone, because a module anchor is correct there",
    (path) => {
      expect(inScope({ path })).toBe(false);
    },
  );

  it("leaves the test tree alone, where naming both families is the test", () => {
    expect(inScope({ path: "src/__tests__/subprocess/lib/gitRepo.test.ts" })).toBe(false);
  });

  it("ignores a non-TypeScript file", () => {
    expect(inScope({ path: "docs/architecture.md" })).toBe(false);
  });
});
