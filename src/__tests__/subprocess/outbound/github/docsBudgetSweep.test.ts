/**
 * `sweepMergeDocsBudget` against a real temp git repository — reconstructing the measured two-branch shape:
 * two branches each add lines to the same skill body, each green at its own head, and only the tree a merge
 * would actually produce crosses the cap. `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may not
 * shell git any other way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { budgetOverruns } from "../../../../canon/alwaysOnDocs.js";
import { sweepMergeDocsBudget } from "../../../../outbound/github/docsBudgetSweep.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A skill body of exactly `count` lines, none of them near either budget's other ceilings. */
function fillerLines({ count }: { count: number }): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => `line ${String(index)}`);
}

/** A minimal, always-passing `skills/loop/SKILL.md`: frontmatter plus a body of exactly `bodyLines` lines. */
function skillMdWith({ bodyLines }: { bodyLines: readonly string[] }): string {
  return `---\ndescription: a test skill\n---\n${bodyLines.join("\n")}\n`;
}

/** A fresh temp git repo on `main`, seeded with the smallest always-on set `sweepMergeDocsBudget` needs. */
function initRepoWithBaseline({ bodyLines }: { bodyLines: readonly string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-budget-sweep-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "CLAUDE.md"), "# CLAUDE\n");
  writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n");
  mkdirSync(join(dir, "skills", "loop"), { recursive: true });
  writeFileSync(join(dir, "skills", "loop", "SKILL.md"), skillMdWith({ bodyLines }));
  git("add", "-A");
  git("commit", "-m", "base");
  return dir;
}

/**
 * A fresh temp git repo on `main` whose skill lives under `.agents/skills/`, not `skills/` — acme-admin's own
 * layout, the case this test closes: a pull request was refused on both its pre-merge report
 * and its post-merge probe because the sweep's `skills/` pathspec never matched anything there.
 */
function initAgentsLayoutRepo({ bodyLines }: { bodyLines: readonly string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-budget-sweep-agents-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "CLAUDE.md"), "# CLAUDE\n");
  writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n");
  mkdirSync(join(dir, ".agents", "skills", "loop"), { recursive: true });
  writeFileSync(join(dir, ".agents", "skills", "loop", "SKILL.md"), skillMdWith({ bodyLines }));
  git("add", "-A");
  git("commit", "-m", "base");
  return dir;
}

/**
 * A fresh temp git repo whose `AGENTS.md`, read natively with no `CLAUDE.md` beside it, imports a PATH-SCOPED
 * rule — the exact shape this repository has, plus an unscoped rule no import reaches. Both must be measured.
 * `claudeMd` adds a root `CLAUDE.md`, which the host then reads INSTEAD of `AGENTS.md`.
 */
function initImportChainRepo({ scopedRuleLines, claudeMd }: { scopedRuleLines: number; claudeMd?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-budget-sweep-imports-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  if (claudeMd !== undefined) {
    writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  }
  writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n@.claude/rules/typescript-patterns.md\n");
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "rules", "typescript-patterns.md"),
    `---\npaths:\n  - "src/**/*.ts"\n---\n${fillerLines({ count: scopedRuleLines }).join("\n")}\n`,
  );
  writeFileSync(join(dir, ".claude", "rules", "cross-session-messages.md"), "# unscoped\nsecond line\n");
  mkdirSync(join(dir, "skills", "loop"), { recursive: true });
  writeFileSync(join(dir, "skills", "loop", "SKILL.md"), skillMdWith({ bodyLines: fillerLines({ count: 10 }) }));
  git("add", "-A");
  git("commit", "-m", "base");
  return dir;
}

describe("sweepMergeDocsBudget", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("measures the rules AGENTS.md imports and the unscoped rule no import reaches", () => {
    const dir = initImportChainRepo({ scopedRuleLines: 20 });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    // 2 (AGENTS.md) + 24 (scoped rule: 4 frontmatter + 20 body) + 2 (unscoped rule) = 28.
    // Before the second hop was followed AND `ls-tree` was asked recursively, only the entry file was measured.
    expect(
      sweep.budgets.filter((entry) => entry.unit === "lines" && entry.label.startsWith("the always-on set")),
    ).toEqual([
      {
        budget: 969,
        label:
          "the always-on set (AGENTS.md, .claude/rules/typescript-patterns.md, .claude/rules/cross-session-messages.md)",
        measured: 28,
        target: 200,
        unit: "lines",
      },
    ]);
  });

  it("enters at a root CLAUDE.md when one exists, so an AGENTS.md it does not import is never counted", () => {
    const dir = initImportChainRepo({ claudeMd: "# CLAUDE\n", scopedRuleLines: 20 });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    // 1 (CLAUDE.md) + 2 (unscoped rule) = 3: the host reads the CLAUDE.md instead, so AGENTS.md and the rule
    // only it imports load nowhere.
    expect(
      sweep.budgets.filter((entry) => entry.unit === "lines" && entry.label.startsWith("the always-on set")),
    ).toEqual([
      {
        budget: 969,
        label: "the always-on set (CLAUDE.md, .claude/rules/cross-session-messages.md)",
        measured: 3,
        target: 200,
        unit: "lines",
      },
    ]);
  });

  it("catches a merge that only crosses the budget through a rule reached by an @ import", () => {
    const dir = initImportChainRepo({ scopedRuleLines: 964 });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    expect(budgetOverruns({ budgets: sweep.budgets.filter((entry) => entry.unit === "lines") })).toEqual([
      "the always-on set (AGENTS.md, .claude/rules/typescript-patterns.md, " +
        ".claude/rules/cross-session-messages.md): 972 lines — 3 over its budget of 969 (documented target " +
        "200). Move content out to a linked doc or a skill; do not raise the budget.",
    ]);
  });

  it("counts a rule in a subdirectory, the way the disk gate's own recursive pathspec does", () => {
    const dir = initImportChainRepo({ scopedRuleLines: 20 });
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    mkdirSync(join(dir, ".claude", "rules", "nested"), { recursive: true });
    writeFileSync(join(dir, ".claude", "rules", "nested", "extra.md"), "# Extra\n");
    git("add", "-A");
    git("commit", "-m", "a nested unscoped rule");
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    // The 28 of the first case plus the nested rule's one line.
    expect(
      sweep.budgets.filter((entry) => entry.unit === "lines" && entry.label.startsWith("the always-on set")),
    ).toEqual([
      {
        budget: 969,
        label:
          "the always-on set (AGENTS.md, .claude/rules/typescript-patterns.md, " +
          ".claude/rules/cross-session-messages.md, .claude/rules/nested/extra.md)",
        measured: 29,
        target: 200,
        unit: "lines",
      },
    ]);
  });

  it("refuses rather than measuring a smaller set when an @ import names a file the merged tree lacks", () => {
    const dir = initImportChainRepo({ scopedRuleLines: 20 });
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    git("checkout", "-b", "drops-the-rule");
    git("rm", "-q", ".claude/rules/typescript-patterns.md");
    git("commit", "-m", "drop the imported rule");
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "drops-the-rule", repoRoot: dir });
    expect(sweep.kind).toBe("not-evaluated");
    if (sweep.kind !== "not-evaluated") {
      throw new Error("unreachable");
    }
    expect(sweep.reason).toContain(".claude/rules/typescript-patterns.md");
  });

  it("evaluates a repo whose skills live under .agents/skills/, instead of reporting not-evaluated", () => {
    const dir = initAgentsLayoutRepo({ bodyLines: fillerLines({ count: 10 }) });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    expect(budgetOverruns({ budgets: sweep.budgets })).toEqual([]);
    expect(sweep.budgets.some((entry) => entry.label === ".agents/skills/loop/SKILL.md body")).toBe(true);
  });

  it("still catches an over-budget skill body under .agents/skills/", () => {
    const dir = initAgentsLayoutRepo({ bodyLines: fillerLines({ count: 501 }) });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    expect(budgetOverruns({ budgets: sweep.budgets })).toEqual([
      ".agents/skills/loop/SKILL.md body: 501 lines — 1 over its budget of 500 (documented target 500). " +
        "Move content out to a linked doc or a skill; do not raise the budget.",
    ]);
  });

  it("reports not-evaluated when a ref cannot be resolved, never as a clean budget", () => {
    const dir = initRepoWithBaseline({ bodyLines: fillerLines({ count: 10 }) });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "no-such-branch", repoRoot: dir });
    expect(sweep.kind).toBe("not-evaluated");
  });

  it("evaluates a clean merge and reports every budget, none exceeded", () => {
    const dir = initRepoWithBaseline({ bodyLines: fillerLines({ count: 10 }) });
    const sweep = sweepMergeDocsBudget({ baseRef: "main", headRef: "main", repoRoot: dir });
    expect(sweep.kind).toBe("evaluated");
    if (sweep.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    expect(budgetOverruns({ budgets: sweep.budgets })).toEqual([]);
  });

  it("catches the two-branch shape: two branches each green at their own head, over budget only once merged", () => {
    // 490 lines, comfortably under the 500-line skill-body cap on its own.
    const dir = initRepoWithBaseline({ bodyLines: fillerLines({ count: 490 }) });
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };

    // First branch: appends 8 lines to the END of the body — 498 lines on its own branch.
    git("checkout", "-b", "pr505");
    writeFileSync(
      join(dir, "skills", "loop", "SKILL.md"),
      skillMdWith({ bodyLines: [...fillerLines({ count: 490 }), ...fillerLines({ count: 8 }).map((l) => `end-${l}`)] }),
    );
    git("add", "-A");
    git("commit", "-m", "#505: append to the end");

    // Second branch: forked from the SAME base, inserts 8 different lines at the START — 498 lines on its own branch.
    git("checkout", "main");
    git("checkout", "-b", "pr506");
    writeFileSync(
      join(dir, "skills", "loop", "SKILL.md"),
      skillMdWith({
        bodyLines: [...fillerLines({ count: 8 }).map((l) => `start-${l}`), ...fillerLines({ count: 490 })],
      }),
    );
    git("add", "-A");
    git("commit", "-m", "#506: insert at the start");

    // Each PR alone, against the ORIGINAL base, is green — exactly what each PR's own CI measured.
    const pr505Alone = sweepMergeDocsBudget({ baseRef: "main", headRef: "pr505", repoRoot: dir });
    expect(pr505Alone.kind).toBe("evaluated");
    const pr506Alone = sweepMergeDocsBudget({ baseRef: "main", headRef: "pr506", repoRoot: dir });
    expect(pr506Alone.kind).toBe("evaluated");
    if (pr505Alone.kind !== "evaluated" || pr506Alone.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    expect(budgetOverruns({ budgets: pr505Alone.budgets })).toEqual([]);
    expect(budgetOverruns({ budgets: pr506Alone.budgets })).toEqual([]);

    // The first branch merges into main first (a fast-forward — main has not moved).
    git("checkout", "main");
    git("merge", "--ff-only", "pr505");

    // The second branch, unrebased, is now re-measured against the CURRENT main — the check this module exists to add.
    const merged = sweepMergeDocsBudget({ baseRef: "main", headRef: "pr506", repoRoot: dir });
    expect(merged.kind).toBe("evaluated");
    if (merged.kind !== "evaluated") {
      throw new Error("unreachable");
    }
    const overruns = budgetOverruns({ budgets: merged.budgets });
    expect(overruns).toEqual([
      "skills/loop/SKILL.md body: 506 lines — 6 over its budget of 500 (documented target 500). Move " +
        "content out to a linked doc or a skill; do not raise the budget.",
    ]);
  });
});
