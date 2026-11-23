/*
 * The stat cache cannot vouch for a file git has not re-read: a same-size edit with its mtime put back, inside the
 * index refresh's own second and under a minimal checkStat, still keeps the tree. Both cases wait on the wall clock.
 */
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { hiddenEditsNow, realGit, workingTreeStatus } from "../../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("the stat cache cannot vouch for a file git has not re-read (the r2 Codex review)", REAL_GIT_SUITE, () => {
  it("keeps a tree whose same-size edit landed inside the index refresh's own second, mtime put back", async () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "f"), "AAAA\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "f"], cwd: repo });
    const path = join(dir, "same-second");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    const old = new Date("2026-09-01T00:00:00Z");
    // The refresh and the edit start together at the top of a fresh second, so the two share one — the r3
    // Codex review's shape, where Apple's git compares ctime to the second and calls the file clean.
    await new Promise((resolve) => setTimeout(resolve, 1020 - (Date.now() % 1000)));
    utimesSync(join(path, "f"), old, old);
    gitInTemp({ args: ["update-index", "--refresh"], cwd: path });
    writeFileSync(join(path, "f"), "BBBB\n");
    utimesSync(join(path, "f"), old, old);

    expect(hiddenEditsNow({ path })).toBe(0);
    expect(hiddenEditsNow({ every: true, path })).toBe(1);
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(readFileSync(join(path, "f"), "utf8")).toBe("BBBB\n");
  });

  it("keeps a merged tree whose same-size edit had its mtime put back under a minimal checkStat", async () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "f"), "AAAA\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "f"], cwd: repo });
    gitInTemp({ args: ["config", "core.trustctime", "false"], cwd: repo });
    gitInTemp({ args: ["config", "core.checkStat", "minimal"], cwd: repo });
    const path = join(dir, "stat");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    const old = new Date("2026-09-01T00:00:00Z");
    utimesSync(join(path, "f"), old, old);
    gitInTemp({ args: ["update-index", "--refresh"], cwd: path });
    // Apple's git compares ctime to the SECOND, so STRICT_STAT's own witness needs the edit in the next one;
    // an edit inside the refresh's second is the case above, which only the raw read catches.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    writeFileSync(join(path, "f"), "BBBB\n");
    utimesSync(join(path, "f"), old, old);

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: path })).toBe("");
    expect(workingTreeStatus({ git: realGit, path })).toBe("M f");
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(existsSync(join(path, "f"))).toBe(true);
  });
});
