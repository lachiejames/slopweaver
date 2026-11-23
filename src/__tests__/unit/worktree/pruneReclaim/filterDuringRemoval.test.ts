/*
 * A filter git would run during the removal keeps the tree: a clean filter armed after setup, which would overwrite a
 * hidden file inside git's own dirty check.
 */
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { filterWouldRun, realGit } from "../../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("a filter git would run during the removal keeps the tree (the p3 Codex pass)", REAL_GIT_SUITE, () => {
  it("keeps a merged tree whose clean filter would overwrite a hidden file inside git's own dirty check", () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "payload"), "payload\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "payload"], cwd: repo });
    writeFileSync(join(repo, ".git", "info", "attributes"), "payload filter=side\n");
    // Armed only once the setup is done, as the p3 pass's stateful driver was, so git's own setup reads of
    // `payload` leave the hidden file alone and only a read DURING the prune could write it.
    const armed = join(dir, "armed");
    const side = `test -e ${armed} && printf ONLY-COPY > tsconfig.shared.json; cat`;
    gitInTemp({ args: ["config", "filter.side.clean", side], cwd: repo });
    const path = join(dir, "side");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: path });
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(path, "payload"), later, later);
    writeFileSync(armed, "");
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };

    expect(filterWouldRun({ git: realGit, path })).toBe(true);
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(
      "a filter command is configured over a file here, and git would run it before the removal — kept",
    );
    expect(readFileSync(join(path, "tsconfig.shared.json"), "utf8")).toBe('{ "extends": "./base.json" }\n');
  });
});
