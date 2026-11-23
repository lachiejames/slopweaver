/**
 * The doc-coverage ratchet.
 *
 * Two describe blocks, the same shape as `canon/staleReferences.test.ts`: the first exercises the PURE
 * sweep on inline fixtures (never touches disk); the second enumerates this repository's real inventory —
 * every CLI noun in the manifest, every top-level `src/` directory, every registered `dev lint` gate,
 * every hook and every `SLOPWEAVER_*` variable the shipped program reads — and asserts that at least one
 * document names each one.
 *
 * There is no allowlist. The gap was closed to zero by `docs/coverage/undocumented.md` and the pages it
 * links, so anything this test reports is genuinely new surface that arrived undocumented.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CoverageItem,
  formatUndocumented,
  hookNamesFrom,
  isCoverageDocPath,
  lintGateNamesFrom,
  referencePattern,
  slopweaverNamesFrom,
  srcDirectoriesFrom,
  undocumentedItems,
} from "../../../canon/docCoverage.js";
import { MANIFEST_MODULES } from "../../../cli/manifests/index.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";

describe("isCoverageDocPath", () => {
  it("counts README.md, which the stale-reference sweep does not read", () => {
    expect(isCoverageDocPath({ path: "README.md" })).toBe(true);
  });

  it("counts a nested docs page", () => {
    expect(isCoverageDocPath({ path: "docs/coverage/undocumented.md" })).toBe(true);
  });

  it("excludes the retired commands/ tree, which no longer exists", () => {
    expect(isCoverageDocPath({ path: "commands/store.md" })).toBe(false);
  });

  it("counts a skill doc", () => {
    expect(isCoverageDocPath({ path: "skills/store/SKILL.md" })).toBe(true);
  });

  it("counts a rule file", () => {
    expect(isCoverageDocPath({ path: ".claude/rules/testing.md" })).toBe(true);
  });

  it("excludes source", () => {
    expect(isCoverageDocPath({ path: "src/canon/docCoverage.ts" })).toBe(false);
  });

  it("excludes a non-SKILL.md file inside a skill directory", () => {
    expect(isCoverageDocPath({ path: "skills/store/notes.md" })).toBe(false);
  });
});

describe("referencePattern", () => {
  it("matches a noun written as a bare invocation", () => {
    const pattern = referencePattern({ item: { kind: "cli-noun", name: "atlas" } });
    expect(pattern.test("run `slopweaver atlas slack` to see it")).toBe(true);
  });

  it("matches a noun written after a bundled launcher path", () => {
    const pattern = referencePattern({ item: { kind: "cli-noun", name: "facts" } });
    expect(pattern.test('"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" facts $ARGUMENTS')).toBe(true);
  });

  it("never matches a noun used as an ordinary English word", () => {
    const pattern = referencePattern({ item: { kind: "cli-noun", name: "route" } });
    expect(pattern.test("the door is the only route out of the process")).toBe(false);
  });

  it("matches a source directory only as a path", () => {
    const pattern = referencePattern({ item: { kind: "src-directory", name: "judgement" } });
    expect(pattern.test("`src/judgement/ownerDirective.ts` holds the overlay")).toBe(true);
    expect(pattern.test("this is a matter of judgement, not a heuristic")).toBe(false);
  });

  it("matches a hook only as a hooks/-rooted path", () => {
    const pattern = referencePattern({ item: { kind: "hook", name: "pretooluse-admit.ts" } });
    expect(pattern.test("`hooks/pretooluse-admit.ts` classifies the command")).toBe(true);
    expect(pattern.test("pretooluse-admit.ts is the file")).toBe(false);
  });

  it("matches a gate name as a whole word", () => {
    const pattern = referencePattern({ item: { kind: "lint-gate", name: "no-headless" } });
    expect(pattern.test("the `no-headless` gate has no allowlist")).toBe(true);
    expect(pattern.test("the no-headlessness of the design")).toBe(false);
  });

  it("matches a SLOPWEAVER_ name as a whole word", () => {
    const pattern = referencePattern({ item: { kind: "slopweaver-name", name: "SLOPWEAVER_ALLOW_RAW" } });
    expect(pattern.test("set `SLOPWEAVER_ALLOW_RAW=1` in the process environment")).toBe(true);
    expect(pattern.test("SLOPWEAVER_ALLOW_RAWER is a different variable")).toBe(false);
  });
});

describe("undocumentedItems", () => {
  const items: readonly CoverageItem[] = [
    { kind: "cli-noun", name: "atlas" },
    { kind: "cli-noun", name: "cloudflare" },
  ];

  it("reports an item no document names", () => {
    expect(undocumentedItems({ docs: ["`slopweaver atlas slack` reads local state"], items })).toEqual([
      { kind: "cli-noun", name: "cloudflare" },
    ]);
  });

  it("accepts a name that appears in any one document, not every document", () => {
    const docs = ["nothing relevant here", "`slopweaver atlas slack`", "`slopweaver cloudflare sync`"];
    expect(undocumentedItems({ docs, items })).toEqual([]);
  });

  it("reports everything when the corpus is empty", () => {
    expect(undocumentedItems({ docs: [], items })).toEqual(items);
  });
});

describe("lintGateNamesFrom", () => {
  it("reads every registered check name, deduplicated and sorted", () => {
    const source = [
      '{ args: ["--check", "."], cmd: bin({ name: "prettier" }), name: "prettier" },',
      '{ args: ["src/devLint/noHeadless.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-headless" },',
    ].join("\n");
    expect(lintGateNamesFrom({ sources: [source] })).toEqual(["no-headless", "prettier", "tsx"]);
  });

  it("unions names across a registry split over more than one file", () => {
    const runner = '{ args: ["--check", "."], cmd: bin({ name: "prettier" }), name: "prettier" },';
    const groups =
      '{ args: ["src/devLint/untestedModules.entry.ts"], cmd: bin({ name: "tsx" }), name: "untested-modules" },';
    expect(lintGateNamesFrom({ sources: [runner, groups] })).toEqual(["prettier", "tsx", "untested-modules"]);
  });

  it("reads nothing from no sources at all", () => {
    expect(lintGateNamesFrom({ sources: [] })).toEqual([]);
  });
});

describe("slopweaverNamesFrom", () => {
  it("reads a name written as a string literal", () => {
    const sources = ['export const HOOK_KILL_SWITCH = "SLOPWEAVER_NO_RUN_GATE";'];
    expect(slopweaverNamesFrom({ sources })).toEqual(["SLOPWEAVER_NO_RUN_GATE"]);
  });

  it("never reads a name that only appears in prose", () => {
    const sources = ["/** There is no `SLOPWEAVER_ALLOW_REMOTE_AHEAD`-style override for this. */"];
    expect(slopweaverNamesFrom({ sources })).toEqual([]);
  });

  it("deduplicates across files and sorts", () => {
    const sources = ['"SLOPWEAVER_HOME"', '"SLOPWEAVER_HOME"', '"SLOPWEAVER_ALLOW_RAW"'];
    expect(slopweaverNamesFrom({ sources })).toEqual(["SLOPWEAVER_ALLOW_RAW", "SLOPWEAVER_HOME"]);
  });
});

describe("srcDirectoriesFrom", () => {
  it("reads the top level only, and drops the test tree", () => {
    const paths = [
      "src/canon/docCoverage.ts",
      "src/corpus/github/errors.ts",
      "src/__tests__/unit/docs/coverage.test.ts",
      "src/stateHome.ts",
      "docs/README.md",
    ];
    expect(srcDirectoriesFrom({ paths })).toEqual(["canon", "corpus"]);
  });
});

describe("hookNamesFrom", () => {
  it("reads the hook executables and drops their shared library", () => {
    const paths = [
      "hooks/hooks.json",
      "hooks/handover-run.sh",
      "hooks/pretooluse-admit.ts",
      "hooks/lib/resolve-root.sh",
    ];
    expect(hookNamesFrom({ paths })).toEqual(["handover-run.sh", "hooks.json", "pretooluse-admit.ts"]);
  });
});

describe("formatUndocumented", () => {
  it("is empty when nothing is unnamed", () => {
    expect(formatUndocumented({ items: [] })).toBe("");
  });

  it("groups the unnamed items by kind, one line each", () => {
    const items: readonly CoverageItem[] = [
      { kind: "cli-noun", name: "atlas" },
      { kind: "cli-noun", name: "vanta" },
      { kind: "hook", name: "pretooluse-admit.ts" },
    ];
    expect(formatUndocumented({ items })).toBe("cli-noun: atlas vanta\nhook: pretooluse-admit.ts");
  });
});

describe("the real inventory", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");
  const tracked = workingTreeFilesOf({ root });
  const read = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");

  const declaringSources = tracked
    .filter((path) => /^(src|hooks|eval)\/.*\.ts$/.test(path) && !path.startsWith("src/__tests__/"))
    .map((path) => read({ path }));

  const inventory: readonly CoverageItem[] = [
    ...[...new Set(MANIFEST_MODULES.map((module) => module.noun))]
      .toSorted()
      .map((name): CoverageItem => ({ kind: "cli-noun", name })),
    ...srcDirectoriesFrom({ paths: tracked }).map((name): CoverageItem => ({ kind: "src-directory", name })),
    ...lintGateNamesFrom({
      sources: [read({ path: "src/devLint/devLint.ts" }), read({ path: "src/devLint/gateGroups.ts" })],
    }).map((name): CoverageItem => ({
      kind: "lint-gate",
      name,
    })),
    ...hookNamesFrom({ paths: tracked }).map((name): CoverageItem => ({ kind: "hook", name })),
    ...slopweaverNamesFrom({ sources: declaringSources }).map((name): CoverageItem => ({
      kind: "slopweaver-name",
      name,
    })),
  ];

  it("enumerates every kind, so an empty result can never read as full coverage", () => {
    const kinds = new Set(inventory.map((item) => item.kind));
    expect([...kinds].toSorted()).toEqual(["cli-noun", "hook", "lint-gate", "slopweaver-name", "src-directory"]);
  });

  it("names every item in at least one document", () => {
    const docs = tracked.filter((path) => isCoverageDocPath({ path })).map((path) => read({ path }));
    expect(docs.length > 0).toBe(true);
    expect(formatUndocumented({ items: undocumentedItems({ docs, items: inventory }) })).toBe("");
  });
});
