/**
 * The health atlas, checked against itself — the two-describe shape `codebaseAtlas.test.ts` established:
 * the first blocks drive the pure fold on inline fixtures, the last reads THIS repository off disk.
 *
 * The on-disk block is the one that catches drift nobody would otherwise see. Two claims in particular are
 * load-bearing and silently breakable: that the two test signals mean different things (a fold that
 * accidentally computed one from the other would agree with itself forever), and that a ranked opportunity
 * always carries the command that recomputes it — and a row whose
 * `command` went empty would still render as a perfectly plausible list.
 */
import { describe, expect, it } from "vitest";

import { codebaseHealth } from "../../../canon/codebaseHealth.js";
import { folderFanoutOf, type HealthModule, OWNER_CODE_LINE_BAR, repeatedNamesOf } from "../../../canon/codeShape.js";
import { type DebtList, type GateCensus, mirroredSourceOf, rulesByTree } from "../../../canon/treeHealth.js";

/** A census fixture; the fold only reads `fileLineCap`, and the three counts pass through untouched. */
const CENSUS: GateCensus = { declared: 58, fileLineCap: 560, localLane: 5, registered: 64 };

/**
 * A module fixture with every counter at zero unless overridden.
 *
 * @param over the fields this case cares about
 * @returns the module row
 */
const mod = (over: Partial<HealthModule> & { path: string }): HealthModule => ({
  codeLines: 10,
  exempt: false,
  libAliasImports: 0,
  libRelativeImports: 0,
  recorded: true,
  ...over,
});

describe("mirroredSourceOf", () => {
  it("maps a unit-lane test back to the source path it mirrors", () => {
    expect(mirroredSourceOf({ path: "src/__tests__/unit/cli/commands/catalog/run.test.ts" })).toBe(
      "src/cli/commands/catalog/run.ts",
    );
  });

  it("refuses an integration-lane test, which the unit mirror does not govern", () => {
    expect(mirroredSourceOf({ path: "src/__tests__/integration/store/query.test.ts" })).toBeUndefined();
  });

  it("refuses a helper in the unit tree that is not a test file", () => {
    expect(mirroredSourceOf({ path: "src/__tests__/unit/fakes/clock.ts" })).toBeUndefined();
  });
});

describe("rulesByTree", () => {
  it("binds a rule to every tree its paths block names, not only the one its heading names", () => {
    const bound = rulesByTree({
      rules: [
        {
          content:
            '---\npaths:\n  - "src/handover/**"\n  - "src/cli/commands/handover/**"\n---\n\n# Working in `src/handover/`\n',
          path: ".claude/rules/area-handover.md",
        },
      ],
    });
    expect(bound.get("handover")).toBe(".claude/rules/area-handover.md");
    expect(bound.get("cli")).toBe(".claude/rules/area-handover.md");
  });

  it("holds one binding when two rules name a tree, the lowest path, so neither silently replaces it", () => {
    const bound = rulesByTree({
      rules: [
        {
          content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n',
          path: ".claude/rules/area-cli.md",
        },
        {
          content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n',
          path: ".claude/rules/area-two.md",
        },
      ],
    });
    expect(bound.get("cli")).toBe(".claude/rules/area-cli.md");
  });

  it("binds a tree to the rule whose heading names it, even when a supplemental glob arrives first", () => {
    const bound = rulesByTree({
      rules: [
        {
          content:
            '---\npaths:\n  - "src/handover/**"\n  - "src/cli/commands/handover/**"\n---\n\n# Working in `src/handover/`\n',
          path: ".claude/rules/area-handover.md",
        },
        {
          content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n',
          path: ".claude/rules/area-cli.md",
        },
      ],
    });
    expect(bound.get("cli")).toBe(".claude/rules/area-cli.md");
    expect(bound.get("handover")).toBe(".claude/rules/area-handover.md");
  });

  it("binds a tree reached by a glob that does not end in a directory wildcard", () => {
    const bound = rulesByTree({
      rules: [
        {
          content: '---\npaths:\n  - "src/handover/**"\n  - "src/cli/**/*.tsx"\n---\n\n# Working in `src/handover/`\n',
          path: ".claude/rules/area-handover.md",
        },
      ],
    });
    expect(bound.get("cli")).toBe(".claude/rules/area-handover.md");
  });

  it("breaks a tie between two rules that only reach a tree by path, whatever order they arrive in", () => {
    const handover = {
      content:
        '---\npaths:\n  - "src/handover/**"\n  - "src/cli/commands/handover/**"\n---\n\n# Working in `src/handover/`\n',
      path: ".claude/rules/area-handover.md",
    };
    const live = {
      content: '---\npaths:\n  - "src/live/**"\n  - "src/cli/commands/live/**"\n---\n\n# Working in `src/live/`\n',
      path: ".claude/rules/area-live.md",
    };
    expect(rulesByTree({ rules: [live, handover] }).get("cli")).toBe(".claude/rules/area-handover.md");
    expect(rulesByTree({ rules: [handover, live] }).get("cli")).toBe(".claude/rules/area-handover.md");
  });

  it("does not read a heading naming a subtree as naming the top-level tree", () => {
    const bound = rulesByTree({
      rules: [
        {
          content: '---\npaths:\n  - "src/cli/commands/**"\n---\n\n# Working in `src/cli/commands/`\n',
          path: ".claude/rules/area-cli-commands.md",
        },
        {
          content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n',
          path: ".claude/rules/area-cli.md",
        },
      ],
    });
    expect(bound.get("cli")).toBe(".claude/rules/area-cli.md");
  });
});

describe("repeatedNamesOf", () => {
  it("counts a name carried by enough files and says how many trees it spans", () => {
    const modules = [
      mod({ path: "src/cli/commands/a/run.ts" }),
      mod({ path: "src/cli/commands/b/run.ts" }),
      mod({ path: "src/cli/commands/c/run.ts" }),
      mod({ path: "src/atlas/d/run.ts" }),
      mod({ path: "src/live/e/run.ts" }),
    ];
    expect(repeatedNamesOf({ modules })).toEqual([{ files: 5, name: "run.ts", trees: 3 }]);
  });

  it("drops a name under the floor, so two coincidences are not a naming finding", () => {
    const modules = [mod({ path: "src/cli/a/run.ts" }), mod({ path: "src/cli/b/run.ts" })];
    expect(repeatedNamesOf({ modules })).toEqual([]);
  });

  it("orders two repeated names most files first, so the page opens on the commonest", () => {
    const modules = [
      ...Array.from({ length: 6 }, (_unused, index) => mod({ path: `src/cli/n${String(index)}/run.ts` })),
      ...Array.from({ length: 5 }, (_unused, index) => mod({ path: `src/live/n${String(index)}/store.ts` })),
    ];
    expect(repeatedNamesOf({ modules })).toEqual([
      { files: 6, name: "run.ts", trees: 1 },
      { files: 5, name: "store.ts", trees: 1 },
    ]);
  });
});

describe("folderFanoutOf", () => {
  it("counts direct children only, so a parent does not inherit its subdirectories' files", () => {
    const modules = [
      ...Array.from({ length: 16 }, (_unused, index) => mod({ path: `src/devLint/gate${String(index)}.ts` })),
      mod({ path: "src/devLint/refusal/registry.ts" }),
    ];
    expect(folderFanoutOf({ modules })).toEqual([{ dir: "src/devLint", files: 16 }]);
  });

  it("drops a directory under the floor", () => {
    expect(folderFanoutOf({ modules: [mod({ path: "src/lib/result.ts" })] })).toEqual([]);
  });

  it("orders two wide directories widest first, so the page opens on the worst one", () => {
    const modules = [
      ...Array.from({ length: 17 }, (_unused, index) => mod({ path: `src/devLint/gate${String(index)}.ts` })),
      ...Array.from({ length: 15 }, (_unused, index) => mod({ path: `src/atlas/page${String(index)}.ts` })),
    ];
    expect(folderFanoutOf({ modules })).toEqual([
      { dir: "src/devLint", files: 17 },
      { dir: "src/atlas", files: 15 },
    ]);
  });
});

describe("codebaseHealth", () => {
  /** One tree, two modules, one of them mirrored and both reached, with a rule naming the tree. */
  const folded = codebaseHealth({
    debtLists: [
      {
        entries: [{ count: 7, path: "src/cli/commands/a.ts" }],
        file: ".baselines/x.json",
        gate: "no-silent-fallback",
        previous: { changedAtIso: "2026-09-14T00:00:00Z", sha: "dad7205", total: 9 },
        total: 7,
      },
    ],
    gates: CENSUS,
    modules: [
      mod({ codeLines: 400, libRelativeImports: 2, path: "src/cli/commands/a.ts" }),
      mod({ codeLines: 100, libAliasImports: 1, path: "src/cli/commands/b.ts" }),
    ],
    observedAtIso: "2026-09-20T00:00:00Z",
    rules: [
      { content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n', path: ".claude/rules/area-cli.md" },
    ],
    testReach: [
      { imports: ["src/cli/commands/a.ts"], path: "src/__tests__/unit/cli/commands/a.test.ts" },
      { imports: ["src/cli/commands/b.ts"], path: "src/__tests__/integration/cli/b.test.ts" },
    ],
  });

  it("separates the mirror signal from the import signal rather than deriving one from the other", () => {
    const cli = folded.trees.find((tree) => tree.tree === "cli")!;
    expect(cli.modules).toBe(2);
    expect(cli.mirrored).toBe(1);
    expect(cli.reachedByTest).toBe(2);
  });

  it("counts a module over the owner's bar without counting it over the cap that actually refuses", () => {
    expect(folded.length.ownerBar).toBe(OWNER_CODE_LINE_BAR);
    expect(folded.length.gateCap).toBe(560);
    expect(folded.length.overOwnerBar).toBe(1);
    expect(folded.length.overGateCap).toBe(0);
  });

  it("names both numbers in the length headline while the owner's bar and the shipped cap disagree", () => {
    expect(folded.opportunities.find((one) => one.kind === "length")!.headline).toBe(
      "1 modules are over the owner's 300 code-line bar, 0 of them frozen at their own exempt ceiling; 0 are over the 560-line cap file-size-ratchet refuses at",
    );
  });

  it("stops repeating the number once the gate adopts the owner's bar", () => {
    const adopted = codebaseHealth({
      debtLists: [],
      gates: { ...CENSUS, fileLineCap: OWNER_CODE_LINE_BAR },
      modules: [mod({ codeLines: 400, path: "src/cli/commands/a.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(adopted.opportunities.find((one) => one.kind === "length")!.headline).toBe(
      "1 modules are over the owner's 300 code-line bar, which is the cap file-size-ratchet refuses at — 1 held as debt that has to come down, 0 frozen at their own exempt ceiling",
    );
  });

  it("splits an exempt ceiling out of the debt it used to be counted as", () => {
    const withGenerated = codebaseHealth({
      debtLists: [],
      gates: { ...CENSUS, fileLineCap: OWNER_CODE_LINE_BAR },
      modules: [
        mod({ codeLines: 400, path: "src/cli/commands/a.ts" }),
        mod({ codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts" }),
      ],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(withGenerated.length.overOwnerBar).toBe(2);
    expect(withGenerated.length.exemptOverBar).toBe(1);
    expect(withGenerated.opportunities.find((one) => one.kind === "length")!.headline).toBe(
      "2 modules are over the owner's 300 code-line bar, which is the cap file-size-ratchet refuses at — 1 held as debt that has to come down, 1 frozen at their own exempt ceiling",
    );
  });

  it("marks the generated surface on the longest-files list, so the page never proposes splitting it", () => {
    const withGenerated = codebaseHealth({
      debtLists: [],
      gates: { ...CENSUS, fileLineCap: OWNER_CODE_LINE_BAR },
      modules: [
        mod({ codeLines: 400, path: "src/cli/commands/a.ts" }),
        mod({ codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts" }),
      ],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(withGenerated.length.longest).toEqual([
      { codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts", recorded: true },
      { codeLines: 400, exempt: false, path: "src/cli/commands/a.ts", recorded: true },
    ]);
  });

  it("will not call a marked file frozen when the committed floor holds no row for it — the r2 counterexample", () => {
    const unrecorded = codebaseHealth({
      debtLists: [],
      gates: { ...CENSUS, fileLineCap: OWNER_CODE_LINE_BAR },
      modules: [
        mod({ codeLines: 400, path: "src/cli/commands/a.ts" }),
        mod({ codeLines: 2000, exempt: true, path: "src/atlas/newGenerated.ts", recorded: false }),
      ],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(unrecorded.length.overOwnerBar).toBe(2);
    expect(unrecorded.length.exemptOverBar).toBe(0);
    expect(unrecorded.length.unrecordedOverBar).toBe(1);
    expect(unrecorded.opportunities.find((one) => one.kind === "length")!.headline).toBe(
      "2 modules are over the owner's 300 code-line bar, which is the cap file-size-ratchet refuses at — 1 held as debt that has to come down, 0 frozen at their own exempt ceiling, 1 on no baseline row at all",
    );
  });

  it("says nothing about unrecorded files when there are none, so a green tree reads clean", () => {
    const clean = codebaseHealth({
      debtLists: [],
      gates: { ...CENSUS, fileLineCap: OWNER_CODE_LINE_BAR },
      modules: [mod({ codeLines: 400, path: "src/cli/commands/a.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(clean.length.unrecordedOverBar).toBe(0);
    expect(clean.opportunities.find((one) => one.kind === "length")!.headline).not.toContain("no baseline row");
  });

  it("attributes a debt entry to the tree its path sits in", () => {
    const cli = folded.trees.find((tree) => tree.tree === "cli")!;
    expect(cli.debt).toEqual([{ count: 7, gate: "no-silent-fallback" }]);
  });

  it("binds the area rule that names the tree", () => {
    expect(folded.trees.find((tree) => tree.tree === "cli")!.rulePath).toBe(".claude/rules/area-cli.md");
    expect(folded.totals.treesWithRule).toBe(1);
  });

  it("sums the sharing axis across the tree", () => {
    expect(folded.totals.libAliasImports).toBe(1);
    expect(folded.totals.libRelativeImports).toBe(2);
    expect(folded.totals.codeLines).toBe(500);
  });

  it("ranks blast radius first, so the biggest debt list outranks a smaller pattern gap", () => {
    const measures = folded.opportunities.map((one) => one.measure);
    expect(measures).toEqual([...measures].toSorted((left, right) => right - left));
  });

  it("gives every ranked opportunity a command that recomputes it", () => {
    expect(folded.opportunities.length).toBeGreaterThan(0);
    expect(folded.opportunities.filter((one) => one.command.trim() === "")).toEqual([]);
  });

  it("ranks the untested row on the import signal, never on the mirror", () => {
    const wide = codebaseHealth({
      debtLists: [],
      gates: CENSUS,
      // Twelve modules, every one reached by a test, none of them mirrored. Ranking on the mirror would
      // propose twelve files of work; ranking on the import signal correctly proposes none.
      observedAtIso: "2026-09-20T00:00:00Z",
      modules: Array.from({ length: 12 }, (_unused, index) => mod({ path: `src/atlas/m${String(index)}.ts` })),
      rules: [],
      testReach: Array.from({ length: 12 }, (_unused, index) => ({
        imports: [`src/atlas/m${String(index)}.ts`],
        path: `src/__tests__/integration/atlas/m${String(index)}.test.ts`,
      })),
    });
    expect(wide.trees.find((tree) => tree.tree === "atlas")!.mirrored).toBe(0);
    expect(wide.opportunities.filter((one) => one.kind === "untested")).toEqual([]);
  });

  it("reports a list with no earlier commit as first-recorded rather than as a flat trend", () => {
    const fresh = codebaseHealth({
      debtLists: [{ entries: [], file: ".baselines/y.json", gate: "clone-detection", previous: undefined, total: 21 }],
      gates: CENSUS,
      modules: [mod({ path: "src/lib/result.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(fresh.debtLists[0]!.previous).toBeUndefined();
    expect(fresh.totals.debtEntries).toBe(21);
  });

  it("counts standing debt against a deleted path into its tree, because the gate still prints it", () => {
    const ghost: DebtList = {
      entries: [{ count: 3, path: "src/gone/removed.ts" }],
      file: ".baselines/z.json",
      gate: "internal-exports",
      previous: undefined,
      total: 3,
    };
    const withGhost = codebaseHealth({
      debtLists: [ghost],
      gates: CENSUS,
      modules: [mod({ path: "src/lib/result.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(withGhost.trees.find((tree) => tree.tree === "gone")!.debt).toEqual([
      { count: 3, gate: "internal-exports" },
    ]);
  });

  /**
   * One tree wide enough to be untested, one directory wide enough to be a splitting finding, and one name
   * repeated across five trees — the three ranked rows the two-module fixture above never reaches.
   */
  const wide = codebaseHealth({
    debtLists: [],
    gates: CENSUS,
    modules: [
      ...Array.from({ length: 16 }, (_unused, index) => mod({ path: `src/atlas/wide/f${String(index)}.ts` })),
      mod({ path: "src/cli/a/run.ts" }),
      mod({ path: "src/live/b/run.ts" }),
      mod({ path: "src/outbound/c/run.ts" }),
      mod({ path: "src/handover/d/run.ts" }),
      mod({ path: "src/store/e/run.ts" }),
    ],
    observedAtIso: "2026-09-20T00:00:00Z",
    rules: [],
    testReach: [],
  });

  it("ranks a tree no test imports, naming the tree and the count in one row", () => {
    const untested = wide.opportunities.find((one) => one.kind === "untested")!;
    expect(untested.subject).toBe("src/atlas");
    expect(untested.measure).toBe(16);
    expect(untested.headline).toBe("16 of 16 modules in src/atlas are imported by no test on any lane");
  });

  it("ranks the widest directory, which is the folder-splitting axis", () => {
    const folder = wide.opportunities.find((one) => one.kind === "folder")!;
    expect(folder.subject).toBe("src/atlas/wide");
    expect(folder.measure).toBe(16);
    expect(folder.command).toBe("slopweaver catalog health --json | jq '.folders'");
  });

  it("ranks the commonest repeated name, and says how many trees carry it", () => {
    const naming = wide.opportunities.find((one) => one.kind === "naming")!;
    expect(naming.subject).toBe("run.ts");
    expect(naming.measure).toBe(5);
    expect(naming.headline).toBe(
      "5 files are named run.ts, across 5 trees — a name that says which layer it is, not what it holds",
    );
  });
});
