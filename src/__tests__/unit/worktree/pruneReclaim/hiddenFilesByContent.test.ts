/*
 * A hidden bit over unchanged bytes is not hidden work: what `readWorkingTree` counts for skip-worktree and
 * assume-unchanged files, driven against a real git repository in a temp directory, and the null it answers when
 * the staged listing cannot be read.
 */
import { chmodSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readWorkingTree, realGit } from "../../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir } from "./harness.js";

useReclaimDir();

describe("hidden files are counted by content, not by bit", REAL_GIT_SUITE, () => {
  it("counts zero for a skip-worktree file whose bytes match the index", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: repo });

    expect(gitInTemp({ args: ["ls-files", "-v"], cwd: repo })).toContain("S tsconfig.shared.json");
    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(0);
  });

  it("counts one for a skip-worktree file whose bytes were edited, which status does not report", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: repo });
    writeFileSync(join(repo, "tsconfig.shared.json"), '{ "extends": "./edited.json" }\n');

    const read = readWorkingTree({ git: realGit, path: repo });
    expect(read.dirtyCount).toBe(0);
    expect(read.hiddenFromStatus).toBe(1);
  });

  it("counts one for a skip-worktree file whose only edit is its executable bit", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: repo });
    chmodSync(join(repo, "tsconfig.shared.json"), 0o755);

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: repo })).toBe("");
    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(1);
  });

  it("counts one for a skip-worktree executable that lost only its owner execute bit, as git reads mode", () => {
    const repo = seedRepo();
    chmodSync(join(repo, "tsconfig.shared.json"), 0o755);
    gitInTemp({ args: ["add", "tsconfig.shared.json"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "exec"], cwd: repo });
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: repo });
    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(0);
    chmodSync(join(repo, "tsconfig.shared.json"), 0o655);

    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(1);
  });

  it("counts one for a skip-worktree file replaced by a symlink to the same bytes", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: repo });
    const twin = join(dir, "twin.json");
    writeFileSync(twin, '{ "extends": "./base.json" }\n');
    rmSync(join(repo, "tsconfig.shared.json"));
    symlinkSync(twin, join(repo, "tsconfig.shared.json"));

    expect(gitInTemp({ args: ["hash-object", "--no-filters", "tsconfig.shared.json"], cwd: repo })).toBe(
      gitInTemp({ args: ["rev-parse", ":tsconfig.shared.json"], cwd: repo }),
    );
    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(1);
  });

  it("sees an untracked file beside a deletion however the repository configures status, so it is not deletions-only", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["config", "status.showUntrackedFiles", "no"], cwd: repo });
    rmSync(join(repo, ".gitignore"));
    writeFileSync(join(repo, "scratch.txt"), "the only copy\n");

    const tree = readWorkingTree({ git: realGit, path: repo });
    expect(tree.deletionsOnly).toBe(false);
    expect(tree.dirtyCount).toBe(2);
  });

  it("counts one for an assume-unchanged file deleted from disk", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["update-index", "--assume-unchanged", "tsconfig.shared.json"], cwd: repo });
    rmSync(join(repo, "tsconfig.shared.json"));

    expect(readWorkingTree({ git: realGit, path: repo }).hiddenFromStatus).toBe(1);
  });

  it("returns null when the staged listing cannot be read, rather than zero", () => {
    const git = ({ args }: { args: readonly string[] }): string | null => {
      if (args.includes("-v")) {
        return "S tsconfig.shared.json\0";
      }
      if (args.includes("status")) {
        return "";
      }
      return null;
    };

    expect(readWorkingTree({ git, path: dir }).hiddenFromStatus).toBe(null);
  });
});
