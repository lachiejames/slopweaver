/*
 * A clean filter cannot hide an edit from the removal: a worktree whose filter drops every byte, read raw, keeps the
 * tree while status reports nothing, and goes once its own driver has no command.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { filterWouldRun, hiddenEditsNow, realGit } from "../../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("a clean filter cannot hide an edit from the removal (the r2 Codex review)", REAL_GIT_SUITE, () => {
  /** A linked, merged worktree whose empty `payload` is cleaned by a filter that drops every byte. */
  const seedFiltered = (): { repo: string; verdict: PruneVerdict } => {
    const repo = seedRepo();
    writeFileSync(join(repo, "payload"), "");
    writeFileSync(join(repo, "victim"), "victim\n");
    writeFileSync(join(repo, ".gitattributes"), "payload filter=drop\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "filtered"], cwd: repo });
    gitInTemp({ args: ["config", "filter.drop.clean", "cat /dev/null"], cwd: repo });
    const path = join(dir, "filtered");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };
    return { repo, verdict };
  };

  it("keeps a merged tree whose filtered file holds bytes status cannot see", () => {
    const { repo, verdict } = seedFiltered();
    writeFileSync(join(verdict.path, "payload"), "UNIQUE-ONLY-IN-WORKTREE\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("");
    expect(hiddenEditsNow({ path: verdict.path })).toBe(1);
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(existsSync(join(verdict.path, "payload"))).toBe(true);
  });

  it("keeps an interrupted tree whose only visible change is a deletion beside that edit", () => {
    const { repo, verdict } = seedFiltered();
    writeFileSync(join(verdict.path, "payload"), "UNIQUE-ONLY-IN-WORKTREE\n");
    rmSync(join(verdict.path, "victim"));

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("D victim");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(existsSync(join(verdict.path, "payload"))).toBe(true);
  });

  it("reads the filtered file raw and equal when it still holds its committed bytes", () => {
    const { verdict } = seedFiltered();

    expect(hiddenEditsNow({ path: verdict.path })).toBe(0);
  });

  it("removes the same tree once its own driver has no command, whatever other driver has one", () => {
    const { repo, verdict } = seedFiltered();
    gitInTemp({ args: ["config", "--unset", "filter.drop.clean"], cwd: repo });
    // The shape a GitHub runner's global git-lfs install leaves in every repository.
    gitInTemp({ args: ["config", "filter.lfs.clean", "git-lfs clean -- %f"], cwd: repo });

    expect(filterWouldRun({ git: realGit, path: verdict.path })).toBe(false);
    expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(true);
  });
});
