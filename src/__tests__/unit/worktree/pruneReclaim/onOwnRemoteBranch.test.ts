/*
 * A branch on its own remote branch is resumable from it: `onOwnRemoteBranch` driven against a real clone of a bare
 * origin, and the null it answers when the ahead count cannot be read.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { realGit } from "../../../../worktree/pruneGit.js";
import { onOwnRemoteBranch } from "../../../../worktree/pruneScan.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir } from "./harness.js";

useReclaimDir();

describe("onOwnRemoteBranch", REAL_GIT_SUITE, () => {
  /** A clone of a bare origin, with `feature` checked out and committed once. */
  const seedClone = (): string => {
    const origin = join(dir, "origin.git");
    gitInTemp({ args: ["init", "-q", "--bare", "-b", "main", origin], cwd: dir });
    const repo = seedRepo();
    gitInTemp({ args: ["remote", "add", "origin", origin], cwd: repo });
    gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: repo });
    gitInTemp({ args: ["fetch", "-q", "origin"], cwd: repo });
    gitInTemp({ args: ["switch", "-q", "-c", "feature"], cwd: repo });
    writeFileSync(join(repo, "work.txt"), "work\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "work"], cwd: repo });
    return repo;
  };

  it("is false for a branch origin/main already contains but that has no remote branch of its own", () => {
    const repo = seedRepo();
    const origin = join(dir, "origin.git");
    gitInTemp({ args: ["init", "-q", "--bare", "-b", "main", origin], cwd: dir });
    gitInTemp({ args: ["remote", "add", "origin", origin], cwd: repo });
    gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: repo });
    gitInTemp({ args: ["fetch", "-q", "origin"], cwd: repo });
    gitInTemp({ args: ["branch", "fresh-from-main"], cwd: repo });

    expect(onOwnRemoteBranch({ branch: "fresh-from-main", git: realGit, repoRoot: repo })).toBe(false);
  });

  it("is true once the branch is pushed, and false again when it commits past its remote branch", () => {
    const repo = seedClone();
    gitInTemp({ args: ["push", "-q", "origin", "feature"], cwd: repo });

    expect(onOwnRemoteBranch({ branch: "feature", git: realGit, repoRoot: repo })).toBe(true);

    writeFileSync(join(repo, "work.txt"), "more\n");
    gitInTemp({ args: [...COMMIT, "more", "-a"], cwd: repo });

    expect(onOwnRemoteBranch({ branch: "feature", git: realGit, repoRoot: repo })).toBe(false);
  });

  it("is null when the remote branch exists but the ahead count cannot be read", () => {
    const git = ({ args }: { args: readonly string[] }): string | null => (args.includes("rev-parse") ? "abc" : null);

    expect(onOwnRemoteBranch({ branch: "feature", git, repoRoot: dir })).toBe(null);
  });
});
