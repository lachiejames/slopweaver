/**
 * The `github merge` effectful shell end to end, against a real temp git repository and a real handovers
 * directory, reconstructing the measured `git reset --soft` incident. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countCommitsAhead } from "../../../../../../cli/commands/github/gitAncestry.js";
import {
  type GithubMergeDeps,
  productionGithubMergeDeps,
  runGithubMerge,
} from "../../../../../../cli/commands/github/mergeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { sweepMergeDocsBudget } from "../../../../../../outbound/github/docsBudgetSweep.js";
import { measureMergeFacts } from "../../../../../../outbound/github/mergeFacts.js";
import { sweepMergeProbeRegressions } from "../../../../../../outbound/github/probeSweep.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../../tempGitRepo.js";
import { capturingOut, NO_HOLD_DEPS, UNREACHABLE_ADMIN_DEPS, VERB_ARGV } from "./harness.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe(
  "runGithubMerge end to end, against a real repository and a real handovers board",
  {
    timeout: REAL_GIT_TIMEOUT_MS,
  },
  () => {
    it("reconstructs the measured reset --soft incident and refuses", async () => {
      const dir = mkdtempSync(join(tmpdir(), "merge-run-e2e-"));
      fixtureDirs.push(dir);
      const git = (...args: string[]): void => {
        gitInTemp({ args, cwd: dir });
      };
      git("init", "-b", "main");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      git("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "kept.txt"), "original\n");
      git("add", "-A");
      git("commit", "-m", "fork point");
      git("checkout", "-b", "feature");
      writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
      git("add", "-A");
      git("commit", "-m", "feature work");
      git("checkout", "main");
      writeFileSync(join(dir, "gained.ts"), "export const gained = 1;\nexport const also = 2;\n");
      git("add", "-A");
      git("commit", "-m", "213: base gains a file");
      git("checkout", "feature");
      git("reset", "--soft", "main");
      git("commit", "-m", "214: squashed onto main");

      const handoversDir = mkdtempSync(join(tmpdir(), "merge-run-e2e-handovers-"));
      fixtureDirs.push(handoversDir);
      const captured = capturingOut();

      const code = await runGithubMerge({
        argv: [...VERB_ARGV],
        deps: {
          admin: UNREACHABLE_ADMIN_DEPS,
          countBehindBase: countCommitsAhead,
          cwd: () => dir,
          hold: NO_HOLD_DEPS,
          measureFacts: ({ cwd, base, head }) => measureMergeFacts({ base, cwd, head }),
          out: captured.out,
          readDescription: ({ source }) => source,
          resolveBase: ({ base }) => ({ branch: base, fetchedFrom: "origin", revision: base, why: undefined }),
          resolveRepoRoot: () => ok(dir),
          sweepDocsBudget: ({ repoRoot, base, head }) =>
            sweepMergeDocsBudget({ baseRef: base, headRef: head, repoRoot }),
          sweepProbes: ({ repoRoot, base, head }) =>
            sweepMergeProbeRegressions({ baseRef: base, handoversDir, headRef: head, repoRoot }),
        },
      });

      expect(code).toBe(EXIT_ERROR);
      expect(captured.lines.some((line) => line.includes("REFUSED"))).toBe(true);
      expect(captured.lines.some((line) => line.includes("gained.ts"))).toBe(true);
      expect(captured.lines.some((line) => line.includes("unmentioned-deletion"))).toBe(true);
    });

    /**
     * The measured incident from `squash-onto-moved-base-silently-reverts-main`: a MODIFIED
     * file, not an added one — `poster.ts` here stands in for the real incident's `poster.ts`. No new-file
     * signature exists to catch it, and the description below names the file honestly, which is exactly why
     * `unmentioned-deletion` alone cannot be the whole guard.
     */
    it("reconstructs a squash reverting a MODIFIED file and refuses, even though the description names it", async () => {
      const dir = mkdtempSync(join(tmpdir(), "merge-run-e2e-revert-"));
      fixtureDirs.push(dir);
      const git = (...args: string[]): void => {
        gitInTemp({ args, cwd: dir });
      };
      git("init", "-b", "main");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      git("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "poster.ts"), "export const version = 1;\n");
      git("add", "-A");
      git("commit", "-m", "fork point");
      git("checkout", "-b", "feature");
      writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
      git("add", "-A");
      git("commit", "-m", "feature work");
      git("checkout", "main");
      writeFileSync(join(dir, "poster.ts"), "export const version = 2;\n");
      git("add", "-A");
      git("commit", "-m", "446: main changes poster.ts");
      git("checkout", "feature");
      git("reset", "--soft", "main");
      git("commit", "-m", "squashed onto main");

      const handoversDir = mkdtempSync(join(tmpdir(), "merge-run-e2e-revert-handovers-"));
      fixtureDirs.push(handoversDir);
      const captured = capturingOut();

      const code = await runGithubMerge({
        argv: [
          "node",
          "slopweaver",
          "github",
          "merge",
          "--repo",
          "owner/name",
          "--base",
          "main",
          "--head",
          "feature",
          "--description",
          "adds feature-work.ts, touches poster.ts",
        ],
        deps: {
          admin: UNREACHABLE_ADMIN_DEPS,
          countBehindBase: countCommitsAhead,
          cwd: () => dir,
          hold: NO_HOLD_DEPS,
          measureFacts: ({ cwd, base, head }) => measureMergeFacts({ base, cwd, head }),
          out: captured.out,
          readDescription: ({ source }) => source,
          resolveBase: ({ base }) => ({ branch: base, fetchedFrom: "origin", revision: base, why: undefined }),
          resolveRepoRoot: () => ok(dir),
          sweepDocsBudget: ({ repoRoot, base, head }) =>
            sweepMergeDocsBudget({ baseRef: base, headRef: head, repoRoot }),
          sweepProbes: ({ repoRoot, base, head }) =>
            sweepMergeProbeRegressions({ baseRef: base, handoversDir, headRef: head, repoRoot }),
        },
      });

      expect(code).toBe(EXIT_ERROR);
      expect(captured.lines.some((line) => line.includes("REFUSED"))).toBe(true);
      expect(captured.lines.some((line) => line.includes("poster.ts"))).toBe(true);
      expect(captured.lines.some((line) => line.includes("reverts-main"))).toBe(true);
    });

    /**
     * The measured defect from `the-merge-guard-s-base-relative-findings-are`: `--base main`
     * resolved to the LOCAL ref, which in every worktree on the owner's machine trails the remote — local
     * `main` one commit behind `origin/main`. The guard then read another session's
     * landed pull request as an unmentioned deletion in YOURS: 16 findings against `main` and 15 against
     * `origin/main`, the extra one a 146-line deletion in a file the pull request does not touch.
     *
     * Reconstructed here with a real `origin` and the REAL production base resolver — nothing about the
     * fetch is faked, which is the only way this proves the fetch happens. The falsifiability check is the
     * second half: the same tree, measured against the stale LOCAL ref, still produces the phantom.
     */
    it("fetches the remote tip, so a stale LOCAL main cannot attribute another PR's deletion to this one", async () => {
      const originDir = mkdtempSync(join(tmpdir(), "merge-run-origin-"));
      const workDir = mkdtempSync(join(tmpdir(), "merge-run-work-"));
      fixtureDirs.push(originDir, workDir);
      const originGit = (...args: string[]): void => {
        gitInTemp({ args, cwd: originDir });
      };
      const workGit = (...args: string[]): void => {
        gitInTemp({ args, cwd: workDir });
      };
      const identify = ({ run }: { run: (...args: string[]) => void }): void => {
        run("config", "user.email", "test@example.invalid");
        run("config", "user.name", "Test");
        run("config", "commit.gpgsign", "false");
      };
      originGit("init", "-b", "main");
      identify({ run: originGit });
      // 60 lines, so removing 50 of them clears the default 40-line deletion threshold.
      writeFileSync(
        join(originDir, "unrelated.ts"),
        Array.from({ length: 60 }, (_, i) => `export const a${String(i)} = ${String(i)};`).join("\n"),
      );
      originGit("add", "-A");
      originGit("commit", "-m", "the fork point");

      gitInTemp({ args: ["clone", originDir, workDir], cwd: tmpdir() });
      identify({ run: workGit });
      workGit("checkout", "-b", "feature");
      writeFileSync(join(workDir, "feature-work.ts"), "export const work = 1;\n");
      workGit("add", "-A");
      workGit("commit", "-m", "the branch's own work");

      // Another session lands a 50-line deletion on main while this branch is in flight.
      writeFileSync(
        join(originDir, "unrelated.ts"),
        Array.from({ length: 10 }, (_, i) => `export const a${String(i)} = ${String(i)};`).join("\n"),
      );
      originGit("add", "-A");
      originGit("commit", "-m", "another session's landed pull request");

      // The branch rebases onto the fetched tip. LOCAL main is deliberately left behind — the worktree state.
      workGit("fetch", "origin");
      workGit("rebase", "origin/main");

      const handoversDir = mkdtempSync(join(tmpdir(), "merge-run-fetch-handovers-"));
      fixtureDirs.push(handoversDir);
      const production = productionGithubMergeDeps();
      const depsFor = ({
        resolveBase,
        out,
      }: {
        resolveBase: GithubMergeDeps["resolveBase"];
        out: GithubMergeDeps["out"];
      }): GithubMergeDeps => ({
        admin: UNREACHABLE_ADMIN_DEPS,
        countBehindBase: countCommitsAhead,
        cwd: () => workDir,
        hold: NO_HOLD_DEPS,
        measureFacts: ({ cwd, base, head }) => measureMergeFacts({ base, cwd, head }),
        out,
        readDescription: ({ source }) => source,
        resolveBase,
        resolveRepoRoot: () => ok(workDir),
        sweepDocsBudget: () => ({ budgets: [], kind: "evaluated" }),
        sweepProbes: ({ repoRoot, base, head }) =>
          sweepMergeProbeRegressions({ baseRef: base, handoversDir, headRef: head, repoRoot }),
      });
      const argv = [
        "node",
        "slopweaver",
        "github",
        "merge",
        "--repo",
        "owner/name",
        "--base",
        "main",
        "--head",
        "feature",
        "--description",
        "adds feature-work.ts",
      ];

      const fetched = capturingOut();
      const fetchedCode = await runGithubMerge({
        argv,
        deps: depsFor({ out: fetched.out, resolveBase: production.resolveBase }),
      });
      const originTip = gitInTemp({ args: ["rev-parse", "origin/main"], cwd: workDir }).trim();
      expect(fetchedCode).toBe(EXIT_OK);
      expect(fetched.lines.some((line) => line.includes("unrelated.ts"))).toBe(false);
      expect(fetched.lines).toContain(`measured base:    main = ${originTip}  (origin/main, fetched just now)`);

      // Falsifiable: the same tree measured against the stale LOCAL ref still invents the phantom finding.
      const local = capturingOut();
      const localCode = await runGithubMerge({
        argv,
        deps: depsFor({
          out: local.out,
          resolveBase: ({ base }) => ({ branch: base, fetchedFrom: undefined, revision: base, why: "offline" }),
        }),
      });
      expect(localCode).toBe(EXIT_ERROR);
      expect(local.lines.some((line) => line.includes("unrelated.ts"))).toBe(true);
    });
  },
);
