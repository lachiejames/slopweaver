/*
 * A filter driver named like git's own sentinel is still a filter: a lossy driver called `unspecified` hides a file
 * from status, and the removal keeps the tree anyway.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { hiddenEditsNow } from "../../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("a filter driver named like git's own sentinel is still a filter (the p3 Codex pass)", REAL_GIT_SUITE, () => {
  it("keeps a merged tree whose file a lossy driver called unspecified hides from status", () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "payload"), "");
    writeFileSync(join(repo, ".gitattributes"), "payload filter=unspecified\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "filtered"], cwd: repo });
    gitInTemp({ args: ["config", "filter.unspecified.clean", "cat /dev/null"], cwd: repo });
    const path = join(dir, "sentinel");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    writeFileSync(join(path, "payload"), "ONLY COPY\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: path })).toBe("");
    expect(hiddenEditsNow({ path })).toBe(1);
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };
    expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(false);
    expect(existsSync(join(path, "payload"))).toBe(true);
  });
});
