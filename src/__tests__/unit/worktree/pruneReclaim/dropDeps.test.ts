/*
 * A kept tree gives up exactly the `node_modules` git calls wholly untracked, never a tracked file and never a
 * symlink: `dropDeps` driven against real git worktrees in a temp directory, and the pure `depDirsIn` that picks them
 * out of a listing.
 */
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { withDepsLock } from "../../../../worktree/depsLock.js";
import { depDirsIn, dropDeps } from "../../../../worktree/pruneDeps.js";
import { type GitRunner, realGit } from "../../../../worktree/pruneGit.js";
import { deleteGently } from "../../../../worktree/prunePacing.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { QUIET_FSEVENTSD } from "../reclaimTrashFixtures.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

/** A load gate that never shuts, for every drop not about the gate. */
const NEVER_PAUSED = (): null => null;

/**
 * The real gentle delete, with both of its machine reads fixed: a quiet fseventsd, so no quantum holds for the
 * daemon a saturated unit shard keeps hot, and a non-darwin OS, so `rm` runs at normal priority rather than under
 * `taskpolicy -b`'s background QoS. The real `rm` still runs, so every filesystem assertion below still holds;
 * `lowPriorityArgv`'s own cases in `prunePacing.test.ts` pin both wrappers.
 *
 * @param dir the moved directory to delete
 * @param timeoutMs the drop's own budget, passed through unchanged
 * @returns whether the directory is gone
 */
const GENTLE_AT_NORMAL_PRIORITY = ({ dir: moved, timeoutMs }: { dir: string; timeoutMs: number }): boolean =>
  deleteGently({ dir: moved, gauge: QUIET_FSEVENTSD, os: "linux", timeoutMs });

/** The trash a drop moves into, beside the trees on the same volume. */
const trashOf = (): string => join(dir, "trash");

describe("dropDeps", REAL_GIT_SUITE, () => {
  it("removes root and nested node_modules, keeps a partly-tracked one and a symlink, and restores the mtime", () => {
    const repo = seedRepo();
    mkdirSync(join(repo, "packages", "a"), { recursive: true });
    writeFileSync(join(repo, "packages", "a", "index.ts"), "export {};\n");
    mkdirSync(join(repo, "vendored", "node_modules"), { recursive: true });
    writeFileSync(join(repo, "vendored", "node_modules", "patched.js"), "tracked\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: ["add", "-f", "vendored/node_modules/patched.js"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "packages"], cwd: repo });
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    for (const nm of ["node_modules/left-pad", "packages/a/node_modules/right-pad"]) {
      mkdirSync(join(tree, nm), { recursive: true });
      writeFileSync(join(tree, nm, "index.js"), "module.exports = 1;\n");
    }
    writeFileSync(join(tree, "vendored", "node_modules", "installed.js"), "untracked\n");
    const shared = join(dir, "shared-node-modules");
    mkdirSync(shared);
    writeFileSync(join(shared, "keep.js"), "shared\n");
    mkdirSync(join(tree, "linked"));
    symlinkSync(shared, join(tree, "linked", "node_modules"));
    const stamp = new Date("2026-09-01T00:00:00.000Z");
    utimesSync(tree, stamp, stamp);

    const outcome = dropDeps({
      deleteDir: GENTLE_AT_NORMAL_PRIORITY,
      paused: NEVER_PAUSED,
      trashDir: trashOf(),
      verdict: verdictFor({ path: tree }),
    });

    expect(outcome.dropped.toSorted()).toEqual(["node_modules", "packages/a/node_modules"]);
    expect(outcome.declined).toBe(null);
    expect(readdirSync(trashOf())).toEqual([]);
    expect(existsSync(join(tree, "node_modules"))).toBe(false);
    expect(existsSync(join(tree, "packages", "a", "node_modules"))).toBe(false);
    expect(existsSync(join(tree, "packages", "a", "index.ts"))).toBe(true);
    expect(existsSync(join(tree, "vendored", "node_modules", "patched.js"))).toBe(true);
    expect(existsSync(join(shared, "keep.js"))).toBe(true);
    expect(existsSync(join(tree, "linked", "node_modules"))).toBe(true);
    expect(statSync(tree).mtimeMs).toBe(stamp.getTime());
  });

  it("deposits an installed root node_modules into the recycle pool and deletes the nested one, mtime restored", () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "package.json"), '{"name":"repo"}\n');
    mkdirSync(join(repo, "packages", "a"), { recursive: true });
    writeFileSync(join(repo, "packages", "a", "index.ts"), "export {};\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "manifest"], cwd: repo });
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    for (const nm of ["node_modules/left-pad", "packages/a/node_modules/right-pad"]) {
      mkdirSync(join(tree, nm), { recursive: true });
      writeFileSync(join(tree, nm, "index.js"), "module.exports = 1;\n");
    }
    writeFileSync(join(tree, "node_modules", ".yarn-state.yml"), '"repo@workspace:.":\n  locations:\n    - ""\n');
    const stamp = new Date("2026-09-01T00:00:00.000Z");
    utimesSync(tree, stamp, stamp);
    const pool = join(dir, "pool");

    const outcome = dropDeps({
      deleteDir: GENTLE_AT_NORMAL_PRIORITY,
      paused: NEVER_PAUSED,
      recyclePool: pool,
      trashDir: trashOf(),
      verdict: verdictFor({ path: tree }),
    });

    expect(outcome).toEqual({
      branch: "kept",
      declined: null,
      dropped: ["node_modules", "packages/a/node_modules"],
      path: tree,
    });
    const [entry] = readdirSync(join(pool, "0"));
    expect(existsSync(join(pool, "0", entry!, "left-pad", "index.js"))).toBe(true);
    expect([existsSync(join(tree, "node_modules")), readdirSync(trashOf())]).toEqual([false, []]);
    expect(statSync(tree).mtimeMs).toBe(stamp.getTime());
  });

  it("takes every directory out of the tree at once, and leaves what a shut load gate stops in the trash", () => {
    const repo = seedRepo();
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    for (const nm of ["node_modules/left-pad", "packages/a/node_modules/right-pad"]) {
      mkdirSync(join(tree, nm), { recursive: true });
      writeFileSync(join(tree, nm, "index.js"), "module.exports = 1;\n");
    }
    const shut = (): string => "the 1-minute load is 119.8, at or above the 22 hold";

    const outcome = dropDeps({
      deleteDir: GENTLE_AT_NORMAL_PRIORITY,
      paused: shut,
      trashDir: trashOf(),
      verdict: verdictFor({ path: tree }),
    });

    expect(outcome.dropped.toSorted()).toEqual(["node_modules", "packages/a/node_modules"]);
    expect(existsSync(join(tree, "node_modules"))).toBe(false);
    expect(existsSync(join(tree, "packages", "a", "node_modules"))).toBe(false);
    const [batch] = readdirSync(trashOf());
    expect(batch!.startsWith("tree-deps-")).toBe(true);
    expect(readdirSync(join(trashOf(), batch!))).toEqual(["1"]);
  });

  it("declines, removing and depositing nothing, while a provision holds the tree's deps lock", () => {
    const repo = seedRepo();
    writeFileSync(join(repo, "package.json"), '{"name":"repo"}\n');
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "manifest"], cwd: repo });
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    mkdirSync(join(tree, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(tree, "node_modules", ".yarn-state.yml"), '"repo@workspace:.":\n  locations:\n    - ""\n');
    const pool = join(dir, "pool");

    const outcome = unwrap(
      withDepsLock({
        act: () =>
          dropDeps({
            paused: NEVER_PAUSED,
            recyclePool: pool,
            trashDir: trashOf(),
            verdict: verdictFor({ path: tree }),
          }),
        waitMs: 0,
        worktree: tree,
      }),
    );

    expect(outcome.dropped).toEqual([]);
    expect(outcome.declined).toContain("a provision holds its node_modules: ");
    expect(outcome.declined).toContain("held by pid");
    expect(existsSync(join(tree, "node_modules", "left-pad"))).toBe(true);
    expect(existsSync(pool)).toBe(false);
  });

  it("declines, moving nothing, a tree `git worktree lock` locked since the scan", () => {
    const repo = seedRepo();
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    mkdirSync(join(tree, "node_modules", "left-pad"), { recursive: true });
    gitInTemp({ args: ["worktree", "lock", "--reason", "seat working here", tree], cwd: repo });

    const outcome = dropDeps({ paused: NEVER_PAUSED, trashDir: trashOf(), verdict: verdictFor({ path: tree }) });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.declined).toBe("locked by `git worktree lock` since the scan — kept");
    expect(existsSync(join(tree, "node_modules", "left-pad"))).toBe(true);
    expect(existsSync(trashOf())).toBe(false);
  });

  it("declines, removing nothing, when git cannot list the tree", () => {
    writeFileSync(join(dir, ".git"), "gitdir: elsewhere\n");
    const outcome = dropDeps({
      git: () => null,
      paused: NEVER_PAUSED,
      trashDir: trashOf(),
      verdict: verdictFor({ path: dir }),
    });

    expect(outcome.dropped).toEqual([]);
    expect(outcome.declined).toBe("git could not list its ignored directories");
  });

  it("never strips a directory git tracks a file in, even when the listing names it", () => {
    const repo = seedRepo();
    const tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "deps", tree], cwd: repo });
    mkdirSync(join(tree, "node_modules"));
    writeFileSync(join(tree, "node_modules", "tracked.txt"), "keep\n");
    gitInTemp({ args: ["add", "-f", "node_modules/tracked.txt"], cwd: tree });
    gitInTemp({ args: [...COMMIT, "tracked dep"], cwd: tree });
    // What the trimming runner returned for a directory named " node_modules": the tracked one's name.
    const git: GitRunner = (input) => (input.args.includes("--others") ? "node_modules/\0" : realGit(input));

    const outcome = dropDeps({ git, paused: NEVER_PAUSED, trashDir: trashOf(), verdict: verdictFor({ path: tree }) });
    expect(outcome.dropped).toEqual([]);
    expect(existsSync(join(tree, "node_modules", "tracked.txt"))).toBe(true);
  });

  it("declines a listing whose name did not decode, rather than stripping whatever the mangled name matches", () => {
    writeFileSync(join(dir, ".git"), "gitdir: elsewhere\n");
    mkdirSync(join(dir, "bad\uFFFD", "node_modules"), { recursive: true });
    const git = (): string => "bad\uFFFD/node_modules/\0";

    const outcome = dropDeps({ git, paused: NEVER_PAUSED, trashDir: trashOf(), verdict: verdictFor({ path: dir }) });
    expect(outcome.dropped).toEqual([]);
    expect(existsSync(join(dir, "bad\uFFFD", "node_modules"))).toBe(true);
  });

  it("declines a root swapped for a symlink, leaving the target's node_modules alone", () => {
    const repo = seedRepo();
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    const link = join(dir, "linked-root");
    symlinkSync(repo, link);

    const outcome = dropDeps({ paused: NEVER_PAUSED, trashDir: trashOf(), verdict: verdictFor({ path: link }) });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.declined).toBe("its root is no longer a real directory");
    expect(existsSync(join(repo, "node_modules", "pkg"))).toBe(true);
  });

  it("declines the main checkout however its path was spelled, because it carries a .git directory", () => {
    const repo = seedRepo();
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });

    const outcome = dropDeps({ paused: NEVER_PAUSED, trashDir: trashOf(), verdict: verdictFor({ path: repo }) });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.declined).toBe("it is not a linked worktree");
    expect(existsSync(join(repo, "node_modules", "pkg"))).toBe(true);
  });
});

describe("depDirsIn", () => {
  it("takes only whole-directory entries named node_modules", () => {
    const listing = "node_modules/\0packages/a/node_modules/\0dist/\0my_node_modules/\0vendored/node_modules/x.js\0";

    expect(depDirsIn({ listing })).toEqual(["node_modules", "packages/a/node_modules"]);
  });
});
