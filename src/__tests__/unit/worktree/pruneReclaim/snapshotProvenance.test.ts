/*
 * A one-off snapshot is known by what made it, not only by where it sits. Measured: a
 * detached tree a person made at `<tmpdir>/slopweaver-snap-<6>/tree`, carrying their own commit, was taken for a
 * Codex copy and removed with its only checkout. Both trees here are real: one the snapshot code itself builds,
 * one hand-made at the same shape.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTreeSnapshot } from "../../../../codex/snapshot.js";
import { unwrap } from "../../../../lib/result.js";
import { FRESH_SNAPSHOT_PREFIX } from "../../../../worktree/freshSnapshotPath.js";
import { pinSnapshot } from "../../../../worktree/pruneRecheck.js";
import { scanWorktree } from "../../../../worktree/pruneScan.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir } from "./harness.js";

useReclaimDir();

/**
 * The harness repository, carrying its own commit identity: `createTreeSnapshot`'s `commit-tree` reads it from
 * config, and the local lap runs with a throwaway HOME holding none.
 *
 * @returns the repository root
 */
function seedIdentifiedRepo(): string {
  const repo = seedRepo();
  gitInTemp({ args: ["config", "user.email", "a@b.c"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "t"], cwd: repo });
  return repo;
}

/** Scan one detached tree of `repo` the way the hourly prune does. */
function scannedAsSnapshot({ repo, path }: { repo: string; path: string }): boolean {
  return scanWorktree({
    liveRefs: [],
    mainCheckout: repo,
    openPullRequests: [],
    repoRoot: repo,
    runsDir: join(dir, "no-runs"),
    trunk: "main",
    worktree: { branch: null, path },
  }).freshSnapshot;
}

describe("a one-off snapshot is known by its own commit", REAL_GIT_SUITE, () => {
  it("takes the tree the snapshot code builds", () => {
    const repo = seedIdentifiedRepo();
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(true);
    } finally {
      snapshot.release();
    }
  });

  it("pins a real snapshot at removal, its reflog being its own creation alone", () => {
    const repo = seedIdentifiedRepo();
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: snapshot.path });
      expect(
        pinSnapshot({ nowMs: Date.UTC(2100, 0, 1), path: snapshot.path, repoRoot: repo, scannedHead: head }),
      ).toEqual({ headSha: head });
    } finally {
      snapshot.release();
    }
  });

  it("leaves a real snapshot to the ordinary rules once its gitdir names a commit moved away from", () => {
    const repo = seedIdentifiedRepo();
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: snapshot.path });
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(true);
      writeFileSync(join(snapshot.path, "only-here.txt"), "work on no ref\n");
      gitInTemp({ args: ["add", "-A"], cwd: snapshot.path });
      gitInTemp({ args: [...COMMIT, "c1"], cwd: snapshot.path });
      gitInTemp({ args: ["checkout", "-q", "--detach", head], cwd: snapshot.path });
      // Back at the snapshot's own commit, so only the private reflog still names the commit made on it.
      expect(gitInTemp({ args: ["rev-parse", "HEAD"], cwd: snapshot.path })).toBe(head);
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(false);
    } finally {
      snapshot.release();
    }
  });

  it("refuses a real snapshot that froze an untracked file its source never committed", () => {
    const repo = seedIdentifiedRepo();
    writeFileSync(join(repo, "draft.txt"), "uncommitted work\n");
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(false);
    } finally {
      snapshot.release();
    }
  });

  it("refuses a real snapshot whose parent commit no ref carries any more", () => {
    const repo = seedIdentifiedRepo();
    gitInTemp({ args: ["checkout", "-q", "-b", "wip"], cwd: repo });
    writeFileSync(join(repo, "wip.txt"), "committed, never pushed\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "wip"], cwd: repo });
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(true);
      gitInTemp({ args: ["checkout", "-q", "main"], cwd: repo });
      gitInTemp({ args: ["branch", "-q", "-D", "wip"], cwd: repo });
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(false);
    } finally {
      snapshot.release();
    }
  });

  it("refuses a parent only the snapshot tree's own per-worktree ref carries, which the removal deletes", () => {
    const repo = seedIdentifiedRepo();
    gitInTemp({ args: ["checkout", "-q", "-b", "wip"], cwd: repo });
    writeFileSync(join(repo, "wip.txt"), "committed, never pushed\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "wip"], cwd: repo });
    const snapshot = unwrap(createTreeSnapshot({ repoRoot: repo }));
    try {
      gitInTemp({ args: ["checkout", "-q", "main"], cwd: repo });
      gitInTemp({ args: ["branch", "-q", "-D", "wip"], cwd: repo });
      gitInTemp({ args: ["update-ref", "refs/bisect/keep", "HEAD^"], cwd: snapshot.path });
      // The witness half: that ref really does contain the parent, as seen from inside the snapshot tree.
      expect(
        gitInTemp({ args: ["for-each-ref", "--contains", "HEAD^", "--format=%(refname)"], cwd: snapshot.path }),
      ).toBe("refs/bisect/keep");
      expect(scannedAsSnapshot({ path: snapshot.path, repo })).toBe(false);
    } finally {
      snapshot.release();
    }
  });

  it("refuses a hand-made tree at the same shape carrying its own commit", () => {
    const repo = seedIdentifiedRepo();
    const staging = mkdtempSync(join(tmpdir(), FRESH_SNAPSHOT_PREFIX));
    try {
      const path = join(staging, "tree");
      gitInTemp({ args: ["worktree", "add", "-q", "--detach", path, "HEAD"], cwd: repo });
      writeFileSync(join(path, "only-here.txt"), "work on no ref\n");
      gitInTemp({ args: ["add", "-A"], cwd: path });
      gitInTemp({ args: [...COMMIT, "my own work"], cwd: path });

      expect(scannedAsSnapshot({ path, repo })).toBe(false);
    } finally {
      rmSync(staging, { force: true, recursive: true });
    }
  });
});
