/**
 * The `github merge` effectful shell's report path. Fast tests inject plain fake edges (no mocks).
 */
import { describe, expect, it } from "vitest";
import { productionGithubMergeDeps, runGithubMerge } from "../../../../../../cli/commands/github/mergeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err } from "../../../../../../lib/result.js";
import { BASE_SHA, capturingOut, depsWith, HEAD_SHA, VERB_ARGV } from "./harness.js";

describe("runGithubMerge", () => {
  it("exits usage and prints nothing else on a missing required flag", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: ["node", "slopweaver", "github", "merge"],
      deps: depsWith({ out: captured.out }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.lines.some((line) => line.includes("--repo"))).toBe(true);
  });

  it("refuses when the repository cannot be resolved, never measuring anything", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        out: captured.out,
        resolveRepoRoot: () => err({ kind: "io", message: "not a git repository", operation: "x" }),
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("not a git repository"))).toBe(true);
  });

  it("refuses when measuring the diff throws, rather than crashing", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        measureFacts: () => {
          throw new Error("git diff failed: bad revision 'feature'");
        },
        out: captured.out,
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("bad revision"))).toBe(true);
  });

  it("exits OK and reports clean when the guard finds nothing", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({ argv: [...VERB_ARGV], deps: depsWith({ out: captured.out }) });
    expect(code).toBe(EXIT_OK);
    expect(captured.lines.some((line) => line.startsWith("clean:"))).toBe(true);
  });

  it("exits ERROR and refuses when the diff carries an unmentioned deletion", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        measureFacts: () => ({
          baseAhead: [],
          baseSha: BASE_SHA,
          diff: [{ deleted: 999, path: "src/gone.ts", status: "deleted" }],
          headSha: HEAD_SHA,
          reverted: [],
        }),
        out: captured.out,
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("UNACKNOWLEDGED"))).toBe(true);
  });

  it("exits ERROR and refuses when the proposed content is one the base branch's history once held", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        measureFacts: () => ({
          baseAhead: [],
          baseSha: BASE_SHA,
          diff: [],
          headSha: HEAD_SHA,
          reverted: [{ path: "src/poster.ts", restoresBaseCommit: "abc1234" }],
        }),
        out: captured.out,
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("reverts-main"))).toBe(true);
    expect(captured.lines.some((line) => line.includes("src/poster.ts"))).toBe(true);
    expect(captured.lines.some((line) => line.includes("held exactly this proposed content at abc1234"))).toBe(true);
  });

  it("names the tree, the base commit and the head commit every finding was measured against", async () => {
    const captured = capturingOut();
    await runGithubMerge({ argv: [...VERB_ARGV], deps: depsWith({ out: captured.out }) });
    expect(captured.lines).toContain("measured in tree: /repo");
    expect(captured.lines).toContain(`measured base:    main = ${BASE_SHA}  (origin/main, fetched just now)`);
    expect(captured.lines).toContain(`measured head:    feature = ${HEAD_SHA}`);
  });

  it("measures the FETCHED tip, never the local ref the caller spelled", async () => {
    const bases: string[] = [];
    await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        measureFacts: ({ base }) => {
          bases.push(base);
          return { baseAhead: [], baseSha: BASE_SHA, diff: [], headSha: HEAD_SHA, reverted: [] };
        },
        sweepDocsBudget: ({ base }) => {
          bases.push(base);
          return { budgets: [], kind: "evaluated" };
        },
        sweepProbes: ({ base }) => {
          bases.push(base);
          return { docsChecked: 0, kind: "evaluated", regressions: [] };
        },
      }),
    });
    expect(bases).toEqual([BASE_SHA, BASE_SHA, BASE_SHA]);
  });

  it("refuses with an acknowledgeable finding, and says LOCAL in the header, when the tip cannot be fetched", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        out: captured.out,
        resolveBase: () => ({ branch: "main", fetchedFrom: undefined, revision: "main", why: "no such remote" }),
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("base-unresolved"))).toBe(true);
    expect(captured.lines.some((line) => line.includes("no such remote"))).toBe(true);
    expect(
      captured.lines.some((line) => line.includes("LOCAL ref — the remote tip was NOT fetched: no such remote")),
    ).toBe(true);
  });

  it("exits OK once that local-base finding is acknowledged by its own subject", async () => {
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--acknowledge", "base-unresolved"],
      deps: depsWith({
        resolveBase: () => ({ branch: "main", fetchedFrom: undefined, revision: "main", why: "no such remote" }),
      }),
    });
    expect(code).toBe(EXIT_OK);
  });

  it("exits OK once every finding is acknowledged", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--acknowledge", "src/gone.ts"],
      deps: depsWith({
        measureFacts: () => ({
          baseAhead: [],
          baseSha: BASE_SHA,
          diff: [{ deleted: 999, path: "src/gone.ts", status: "deleted" }],
          headSha: HEAD_SHA,
          reverted: [],
        }),
        out: captured.out,
      }),
    });
    expect(code).toBe(EXIT_OK);
  });

  it("refuses when the board could not be evaluated, never reporting clean", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        out: captured.out,
        sweepProbes: () => ({ kind: "not-evaluated", reason: "no board found" }),
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("orchestration-board"))).toBe(true);
  });

  it("always states plainly that it reports rather than merges", async () => {
    const captured = capturingOut();
    runGithubMerge({ argv: [...VERB_ARGV], deps: depsWith({ out: captured.out }) });
    expect(captured.lines.some((line) => line.includes("REPORTS ONLY"))).toBe(true);
    expect(captured.lines.some((line) => line.includes("gh pr merge"))).toBe(true);
  });

  it('production deps read stdin only when the description source is exactly "-"', () => {
    const deps = productionGithubMergeDeps();
    expect(deps.readDescription({ source: "a literal description" })).toBe("a literal description");
  });
});
