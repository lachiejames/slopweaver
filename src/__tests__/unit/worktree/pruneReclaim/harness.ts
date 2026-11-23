/*
 * What more than one worktree-reclaim test file reads, for the three reclaims: a hidden bit over
 * unchanged bytes is not hidden work, a branch on its own remote branch is resumable from it, and a kept tree gives up
 * exactly the `node_modules` git calls wholly untracked. The real-git cases run in the directory `useReclaimDir()`
 * mints per case and removes after it, so read `dir` only inside a case. A plain module, not a `*.test.ts`.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach } from "vitest";

import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { seedTemplate } from "../../../seedTemplate.js";
import { gitInTemp } from "../../../tempGitRepo.js";

/** The commit command with an explicit identity, since CI runners carry none; a case appends its message. */
export const COMMIT: readonly string[] = ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm"];

/** The case's temp directory; a live binding, assigned before each case and read only inside one. */
export let dir = "";

/**
 * The repository {@link seedRepo} copies, built by the file's first call and removed, and forgotten, when the file
 * ends; empty while none is built.
 */
let seed = "";

/**
 * Register the hooks that give every case a fresh {@link dir} and remove it after, and remove the file's seed
 * repository once its last case is done. Call it once, at the top of a test file whose cases read it.
 */
export function useReclaimDir(): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-reclaim-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  afterAll(() => {
    if (seed !== "") {
      rmSync(seed, { force: true, recursive: true });
      seed = "";
    }
  });
}

/**
 * Build, at `repo`, a repository with one committed file and a `.gitignore` naming `node_modules`.
 *
 * @param repo the directory to build it in, made when absent
 */
export const buildSeedRepo = ({ repo }: { repo: string }): void => {
  mkdirSync(repo, { recursive: true });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  writeFileSync(join(repo, "tsconfig.shared.json"), '{ "extends": "./base.json" }\n');
  writeFileSync(join(repo, ".gitignore"), "node_modules\n");
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: [...COMMIT, "base"], cwd: repo });
};

/**
 * A repository with one committed file and a `.gitignore` naming `node_modules`, at `<dir>/repo`: a copy of the one
 * {@link buildSeedRepo} builds once per file, since a plain repository's `.git` holds no absolute path and every git
 * process is a launch.
 *
 * @returns the repository's path
 */
export const seedRepo = (): string => {
  if (seed === "") {
    seed = seedTemplate({
      prefix: "prune-reclaim-seed-",
      seed: ({ dir: built }) => {
        buildSeedRepo({ repo: built });
      },
    });
  }
  const repo = join(dir, "repo");
  cpSync(seed, repo, { recursive: true });
  return repo;
};

/**
 * A kept worktree's verdict at the given path, which a case overrides for any other class.
 *
 * @returns the verdict, marked to drop its `node_modules`
 */
export const verdictFor = ({ path }: { path: string }): PruneVerdict => ({
  branch: "kept",
  cls: "hold",
  deleteBranch: false,
  diskKib: null,
  dropsDeps: true,
  path,
  reason: "3 uncommitted change(s)",
});
