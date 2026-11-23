/**
 * The reclaim trash: which directories a removal may move aside, that a moved tree is removed with its
 * `node_modules` in the trash, that a refused removal puts it back, that emptying is bounded, and when a pending
 * batch goes back into its tree, is held, or is deleted.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { bulkEntriesToMove } from "../../../worktree/bulkAside.js";
import { claimDeleteLease, DELETE_LEASE_ROOT_VAR, deleteLeaseRoot } from "../../../worktree/deleteLease.js";
import { withDepsLock } from "../../../worktree/depsLock.js";
import type { FseventsdCpu } from "../../../worktree/fseventsdGauge.js";
import { applyVerdict } from "../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { emptyReclaimTrash, reclaimTrashDir, removeWithBulkAside } from "../../../worktree/reclaimTrash.js";
import { recyclePoolDir } from "../../../worktree/recyclePool.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";
import { DELETE_NOW, FROZEN_CLOCK, NEVER_PAUSED, QUIET_FSEVENTSD, UNLIMITED } from "./reclaimTrashFixtures.js";

const COMMIT = ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm"];

/**
 * The repository every linked tree is cut from, built once by the real-git describe below and copied into each of its
 * cases, so the describes that drive no git run none, filtered or not (the r7-rebase-01 Codex review).
 */
let seed = "";
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reclaim-trash-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * A repository ignoring `node_modules`, with `main` published as its trunk, and a linked worktree on `landed`
 * holding one installed package. The repository is a copy of {@link seed} — a plain repository's `.git` holds no
 * absolute path, so the copy is the same repository — and the worktree is the case's own.
 */
const seedLinked = (): { repo: string; verdict: PruneVerdict } => {
  const repo = join(dir, "repo");
  cpSync(seed, repo, { recursive: true });
  const path = join(dir, "linked");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
  mkdirSync(join(path, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(path, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  const verdict: PruneVerdict = {
    branch: "landed",
    cls: "merged",
    deleteBranch: true,
    diskKib: null,
    dropsDeps: false,
    path,
    reason: "merged into the trunk",
  };
  return { repo, verdict };
};

/**
 * A removal git refuses: the tree is locked only once its `node_modules` is already aside — the one window the
 * apply's last lock read cannot see — and git's own refusal text is what the removal answers.
 */
const refusedRemoval = ({ path, repo }: { path: string; repo: string }): string | null => {
  gitInTemp({ args: ["worktree", "lock", path], cwd: repo });
  try {
    gitInTemp({ args: ["worktree", "remove", path], cwd: repo });
    return null;
  } catch (error) {
    return String(error);
  }
};

describe("bulkEntriesToMove", () => {
  it("keeps every wholly ignored node_modules, at the root and nested", () => {
    expect(bulkEntriesToMove({ listing: "node_modules/\0packages/a/node_modules/\0dist-cli/\0" })).toEqual([
      "node_modules",
      "packages/a/node_modules",
    ]);
  });

  it("refuses a node_modules with another entry listed beneath it", () => {
    expect(bulkEntriesToMove({ listing: "node_modules/\0node_modules/.keep\0" })).toEqual([]);
  });

  it("refuses a file named node_modules, and every other ignored directory", () => {
    expect(bulkEntriesToMove({ listing: "node_modules\0.yarn/\0.yarn/install-state.gz\0" })).toEqual([]);
  });

  it("answers nothing for an empty listing", () => {
    expect(bulkEntriesToMove({ listing: "" })).toEqual([]);
  });
});

describe("against a real repository", REAL_GIT_SUITE, () => {
  beforeAll(() => {
    seed = mkdtempSync(join(tmpdir(), "reclaim-trash-seed-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: seed });
    writeFileSync(join(seed, "index.ts"), "export {};\n");
    writeFileSync(join(seed, "package.json"), '{"name":"repo"}\n');
    writeFileSync(join(seed, ".gitignore"), "node_modules\n");
    gitInTemp({ args: ["add", "-A"], cwd: seed });
    gitInTemp({ args: [...COMMIT, "base"], cwd: seed });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", "refs/heads/main"], cwd: seed });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], cwd: seed });
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(seed, { force: true, recursive: true });
  });

  describe("a removal with a reclaim trash", REAL_GIT_SUITE, () => {
    it("removes the tree and leaves its node_modules in one trash batch", () => {
      const { repo, verdict } = seedLinked();
      const trash = reclaimTrashDir({ repoRoot: repo });

      const outcome = applyVerdict({ bulkTrash: trash, repoRoot: repo, verdict });
      expect(outcome.treeRemoved).toBe(true);
      expect(outcome.declined).toBe(null);
      expect(existsSync(verdict.path)).toBe(false);
      const batches = readdirSync(trash);
      expect(batches).toHaveLength(1);
      expect(batches[0]!.startsWith("linked-")).toBe(true);
      expect(existsSync(join(trash, batches[0]!, "0", "pkg", "index.js"))).toBe(true);
      expect(existsSync(join(trash, batches[0]!, "pending.json"))).toBe(false);
    });

    it("keeps a tree locked before the removal whole, never moving its node_modules aside", () => {
      const { repo, verdict } = seedLinked();
      gitInTemp({ args: ["worktree", "lock", verdict.path], cwd: repo });

      const outcome = applyVerdict({
        bulkTrash: reclaimTrashDir({ repoRoot: repo }),
        repoRoot: repo,
        verdict,
      });
      expect(outcome.treeRemoved).toBe(false);
      expect(outcome.declined).toContain("locked");
      expect(existsSync(join(verdict.path, "node_modules", "pkg", "index.js"))).toBe(true);
      expect(existsSync(reclaimTrashDir({ repoRoot: repo }))).toBe(false);
    });

    it("puts node_modules back when git refuses the removal, as it does a lock taken after the last read", () => {
      const { repo, verdict } = seedLinked();
      const trash = reclaimTrashDir({ repoRoot: repo });

      const refusal = removeWithBulkAside({
        bulkTrash: trash,
        remove: () => refusedRemoval({ path: verdict.path, repo }),
        worktree: verdict.path,
      });
      expect(refusal).toContain("locked");
      expect(existsSync(join(verdict.path, "node_modules", "pkg", "index.js"))).toBe(true);
      expect(readdirSync(trash)).toEqual([]);
    });

    it("keeps the whole tree, never handing node_modules to git, when it cannot be moved aside", () => {
      const { repo, verdict } = seedLinked();
      // A trash under a plain file cannot be made, so the batch is never published and nothing can move.
      const blocker = join(dir, "not-a-directory");
      writeFileSync(blocker, "");

      const outcome = applyVerdict({ bulkTrash: join(blocker, "trash"), repoRoot: repo, verdict });
      expect(outcome.treeRemoved).toBe(false);
      expect(outcome.declined).toContain("its trash batch could not be published");
      expect(existsSync(join(verdict.path, "node_modules", "pkg", "index.js"))).toBe(true);
      expect(existsSync(join(verdict.path, "index.ts"))).toBe(true);
    });

    it("runs git holding the machine's delete lease, so no other delete runs beside it", () => {
      const { repo, verdict } = seedLinked();
      const during: string[] = [];

      const refusal = removeWithBulkAside({
        bulkTrash: reclaimTrashDir({ repoRoot: repo }),
        remove: () => {
          during.push(claimDeleteLease({ root: deleteLeaseRoot() }).kind);
          gitInTemp({ args: ["worktree", "remove", verdict.path], cwd: repo });
          return null;
        },
        worktree: verdict.path,
      });
      expect(refusal).toBe(null);
      expect(during).toEqual(["busy"]);
    });

    it("with no delete lease to be had, trashes node_modules and keeps the tracked tree, never running git", () => {
      const { repo, verdict } = seedLinked();
      const trash = reclaimTrashDir({ repoRoot: repo });
      const blocker = join(dir, "no-lease");
      writeFileSync(blocker, "");
      const sandboxed = process.env[DELETE_LEASE_ROOT_VAR];
      process.env[DELETE_LEASE_ROOT_VAR] = join(blocker, "lease");
      const gitRuns: string[] = [];
      let refusal: string | null = null;
      try {
        refusal = removeWithBulkAside({
          bulkTrash: trash,
          remove: () => {
            gitRuns.push(verdict.path);
            return null;
          },
          worktree: verdict.path,
        });
      } finally {
        process.env[DELETE_LEASE_ROOT_VAR] = sandboxed;
      }

      expect(refusal).toContain("the machine's delete lease could not be taken (");
      expect(refusal).toContain("its node_modules went to the trash and the tracked tree was kept");
      expect(gitRuns).toEqual([]);
      expect(existsSync(join(verdict.path, "node_modules"))).toBe(false);
      expect(existsSync(join(verdict.path, "index.ts"))).toBe(true);
      const batches = readdirSync(trash);
      expect(existsSync(join(trash, batches[0]!, "0", "pkg", "index.js"))).toBe(true);
      expect(existsSync(join(trash, batches[0]!, "pending.json"))).toBe(false);
    });

    it("removes in place, leaving no trash, when the caller names none", () => {
      const { repo, verdict } = seedLinked();

      expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(true);
      expect(existsSync(reclaimTrashDir({ repoRoot: repo }))).toBe(false);
    });
  });

  describe("a removal with a recycle pool", REAL_GIT_SUITE, () => {
    /** {@link seedLinked}, with the state file yarn writes into an installed root `node_modules`. */
    const seedInstalled = (): { repo: string; verdict: PruneVerdict } => {
      const seeded = seedLinked();
      writeFileSync(join(seeded.verdict.path, "node_modules", ".yarn-state.yml"), '"repo@workspace:.":\n');
      return seeded;
    };

    it("pools the removed tree's root node_modules and leaves a committed, empty batch in the trash", () => {
      const { repo, verdict } = seedInstalled();
      const trash = reclaimTrashDir({ repoRoot: repo });
      const pool = recyclePoolDir({ repoRoot: repo });

      const outcome = applyVerdict({ bulkTrash: trash, recyclePool: pool, repoRoot: repo, verdict });
      expect(outcome.treeRemoved).toBe(true);
      const batches = readdirSync(trash);
      expect(batches).toHaveLength(1);
      expect([readdirSync(pool), readdirSync(join(pool, "0"))]).toEqual([["0"], batches]);
      expect(existsSync(join(pool, "0", batches[0]!, "pkg", "index.js"))).toBe(true);
      expect(readdirSync(join(trash, batches[0]!))).toEqual([]);
    });

    it("leaves a tree yarn wrote no state into in the trash, exactly as without a pool", () => {
      const { repo, verdict } = seedLinked();
      const trash = reclaimTrashDir({ repoRoot: repo });
      const pool = recyclePoolDir({ repoRoot: repo });

      applyVerdict({ bulkTrash: trash, recyclePool: pool, repoRoot: repo, verdict });
      const batches = readdirSync(trash);
      expect(existsSync(join(trash, batches[0]!, "0", "pkg", "index.js"))).toBe(true);
      expect(existsSync(pool)).toBe(false);
    });

    it("leaves a tree installed for another package in the trash, judged before git removed its package.json", () => {
      const { repo, verdict } = seedLinked();
      writeFileSync(join(verdict.path, "node_modules", ".yarn-state.yml"), '"other@workspace:.":\n');
      const trash = reclaimTrashDir({ repoRoot: repo });
      const pool = recyclePoolDir({ repoRoot: repo });

      applyVerdict({ bulkTrash: trash, recyclePool: pool, repoRoot: repo, verdict });
      const batches = readdirSync(trash);
      expect(existsSync(join(trash, batches[0]!, "0", ".yarn-state.yml"))).toBe(true);
      expect(existsSync(pool)).toBe(false);
    });

    it("pools nothing when git refuses the removal, and puts node_modules back", () => {
      const { repo, verdict } = seedInstalled();
      const pool = recyclePoolDir({ repoRoot: repo });

      const refusal = removeWithBulkAside({
        bulkTrash: reclaimTrashDir({ repoRoot: repo }),
        recyclePool: pool,
        remove: () => refusedRemoval({ path: verdict.path, repo }),
        worktree: verdict.path,
      });
      expect(refusal).toContain("locked");
      expect(existsSync(join(verdict.path, "node_modules", ".yarn-state.yml"))).toBe(true);
      expect(existsSync(pool)).toBe(false);
    });

    it("refuses the removal, moving and pooling nothing, while a provision holds the tree's deps lock", () => {
      const { repo, verdict } = seedInstalled();
      const trash = reclaimTrashDir({ repoRoot: repo });
      const pool = recyclePoolDir({ repoRoot: repo });

      const outcome = unwrap(
        withDepsLock({
          act: () => applyVerdict({ bulkTrash: trash, recyclePool: pool, repoRoot: repo, verdict }),
          waitMs: 0,
          worktree: verdict.path,
        }),
      );
      expect(outcome.treeRemoved).toBe(false);
      expect(outcome.declined).toContain("a provision holds its node_modules, so it was not removed: held by pid");
      expect(existsSync(join(verdict.path, "node_modules", ".yarn-state.yml"))).toBe(true);
      expect(existsSync(trash)).toBe(false);
      expect(existsSync(pool)).toBe(false);
    });

    it("moves and removes nothing when the tree's git directory cannot be resolved, since the lock cannot be asked", () => {
      const { repo } = seedLinked();
      // A tree under the main checkout, as `.claude/worktrees.noindex` is, whose `.git` is gone: git walks up to the
      // main checkout and still lists its ignored node_modules, while the lock has no git directory to live in.
      const nested = join(repo, "nested");
      mkdirSync(join(nested, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(nested, "package.json"), '{"name":"repo"}\n');
      writeFileSync(join(nested, "node_modules", ".yarn-state.yml"), '"repo@workspace:.":\n');
      const trash = reclaimTrashDir({ repoRoot: repo });
      const pool = recyclePoolDir({ repoRoot: repo });
      const gitRuns: string[] = [];

      const refusal = removeWithBulkAside({
        bulkTrash: trash,
        recyclePool: pool,
        remove: () => {
          // A `.git` restored between the locus read and this call would let git delete a tree a live install holds.
          gitRuns.push(nested);
          return null;
        },
        worktree: nested,
      });

      expect(refusal).toContain("its deps lock cannot be resolved, so it was not removed: ");
      expect(gitRuns).toEqual([]);
      expect(existsSync(join(nested, "node_modules", ".yarn-state.yml"))).toBe(true);
      expect([existsSync(trash), existsSync(pool)]).toEqual([false, false]);
    });

    it("holds the deps lock while git removes the tree, so no provision can start inside the removal", () => {
      const { repo, verdict } = seedInstalled();
      const pool = recyclePoolDir({ repoRoot: repo });
      const during: string[] = [];

      const refusal = removeWithBulkAside({
        bulkTrash: reclaimTrashDir({ repoRoot: repo }),
        recyclePool: pool,
        remove: () => {
          const entered = withDepsLock({ act: () => during.push("provision ran"), waitMs: 0, worktree: verdict.path });
          during.push(entered.isErr() ? entered.error.slice(0, "held by pid".length) : "lock was free");
          gitInTemp({ args: ["worktree", "remove", verdict.path], cwd: repo });
          return null;
        },
        worktree: verdict.path,
      });

      expect(refusal).toBe(null);
      expect(during).toEqual(["held by pid"]);
      expect(existsSync(verdict.path)).toBe(false);
      expect(readdirSync(join(pool, "0"))).toHaveLength(1);
    });

    it("pools nothing without a trash, because only a pending batch is safe to take a tree from", () => {
      const { repo, verdict } = seedInstalled();
      const pool = recyclePoolDir({ repoRoot: repo });

      expect(applyVerdict({ recyclePool: pool, repoRoot: repo, verdict }).treeRemoved).toBe(true);
      expect(existsSync(pool)).toBe(false);
    });
  });
});

describe("emptyReclaimTrash", () => {
  /** A trash root holding two batches of one file each. */
  const seedTrash = (): string => {
    const root = join(dir, "trash");
    for (const batch of ["a-1", "b-2"]) {
      mkdirSync(join(root, batch, "0"), { recursive: true });
      writeFileSync(join(root, batch, "0", "f.js"), "x\n");
    }
    return root;
  };

  // The one case left on the governed default delete, so the pass is still proven wired to it. Its gauge and clock are
  // fixed: read live, a loaded machine's fseventsd held every quantum past the budget and reddened the case.
  it("deletes every batch inside the budget", () => {
    const root = seedTrash();
    // Each read the governed delete makes of the gauge and of the clock, so the case proves the default reads THIS
    // gauge against THIS clock. A live clock read in the same millisecond also answers 60000, so the clock's own count
    // is the clock's witness: the pass alone reads it three times, once for its deadline and once per batch.
    const reads: number[] = [];
    const gauge = ({ remainingMs }: { remainingMs: number }): FseventsdCpu => {
      reads.push(remainingMs);
      return QUIET_FSEVENTSD();
    };
    let clockReads = 0;
    const now = (): number => {
      clockReads += 1;
      return FROZEN_CLOCK();
    };

    expect(
      emptyReclaimTrash({
        budgetMs: 60_000,
        gauge,
        maxDeletes: UNLIMITED,
        now,
        paused: NEVER_PAUSED,
        roots: [root],
      }),
    ).toEqual({ emptied: 2, left: 0, restored: 0 });
    expect(readdirSync(root)).toEqual([]);
    expect(clockReads).toBeGreaterThan(3);
    expect(reads).toEqual([60_000, 60_000]);
  });

  it("leaves every batch for the next pass when the budget is already spent", () => {
    const root = seedTrash();

    expect(
      emptyReclaimTrash({
        budgetMs: 0,
        deleteTree: DELETE_NOW,
        maxDeletes: UNLIMITED,
        paused: NEVER_PAUSED,
        roots: [root],
      }),
    ).toEqual({ emptied: 0, left: 2, restored: 0 });
    expect(readdirSync(root)).toEqual(["a-1", "b-2"]);
  });

  it("leaves every batch for the next pass while the load gate is shut", () => {
    const root = seedTrash();
    const shut = (): string => "the 1-minute load is 119.8, at or above the 22 hold";

    expect(
      emptyReclaimTrash({
        budgetMs: 60_000,
        deleteTree: DELETE_NOW,
        maxDeletes: UNLIMITED,
        paused: shut,
        roots: [root],
      }),
    ).toEqual({ emptied: 0, left: 2, restored: 0 });
    expect(readdirSync(root)).toEqual(["a-1", "b-2"]);
  });

  it("deletes no more batches than its limit, leaving the rest for the next pass", () => {
    const root = seedTrash();

    expect(
      emptyReclaimTrash({
        budgetMs: 60_000,
        deleteTree: DELETE_NOW,
        maxDeletes: 1,
        paused: NEVER_PAUSED,
        roots: [root],
      }),
    ).toEqual({ emptied: 1, left: 1, restored: 0 });
    expect(readdirSync(root)).toEqual(["b-2"]);
  });

  it("reads an absent root as an empty one", () => {
    expect(
      emptyReclaimTrash({
        budgetMs: 60_000,
        deleteTree: DELETE_NOW,
        maxDeletes: UNLIMITED,
        paused: NEVER_PAUSED,
        roots: [join(dir, "never-made")],
      }),
    ).toEqual({ emptied: 0, left: 0, restored: 0 });
  });
});

describe("a pending batch", () => {
  /** A pid no process holds: darwin's ceiling is 99998, Linux's 4194304. */
  const DEAD_PID = 99_999_999;

  /** A worktree whose node_modules sits in a pending batch written by `pid`, as a kill mid-removal leaves it. */
  const seedPending = ({ pid }: { pid: number }): { root: string; worktree: string } => {
    const root = join(dir, "trash");
    const worktree = join(dir, "seat");
    const batch = join(root, "seat-1");
    // A `.git` directory, so the tree's deps lock has a git directory to live in.
    mkdirSync(join(worktree, ".git"), { recursive: true });
    mkdirSync(join(batch, "0", "pkg"), { recursive: true });
    writeFileSync(join(batch, "0", "pkg", "index.js"), "module.exports = 1;\n");
    const moves = [{ from: join(worktree, "node_modules"), to: join(batch, "0") }];
    writeFileSync(join(batch, "pending.json"), JSON.stringify({ moves, pid, worktree }));
    return { root, worktree };
  };

  /** One pass over `root` with an open budget, no load gate and no limit, deleting at once. */
  const emptyNow = ({ root }: { root: string }): ReturnType<typeof emptyReclaimTrash> =>
    emptyReclaimTrash({
      budgetMs: 60_000,
      deleteTree: DELETE_NOW,
      maxDeletes: UNLIMITED,
      paused: NEVER_PAUSED,
      roots: [root],
    });

  it("goes back into its tree when its writer died before git answered", () => {
    const { root, worktree } = seedPending({ pid: DEAD_PID });

    expect(emptyNow({ root })).toEqual({ emptied: 0, left: 0, restored: 1 });
    expect(existsSync(join(worktree, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  it("goes back into a nested place whose parent the failed removal already deleted", () => {
    const root = join(dir, "trash");
    const worktree = join(dir, "seat");
    const batch = join(root, "seat-1");
    mkdirSync(join(worktree, ".git"), { recursive: true });
    mkdirSync(join(batch, "0", "pkg"), { recursive: true });
    writeFileSync(join(batch, "0", "pkg", "index.js"), "module.exports = 1;\n");
    const moves = [{ from: join(worktree, "packages", "x", "node_modules"), to: join(batch, "0") }];
    writeFileSync(join(batch, "pending.json"), JSON.stringify({ moves, pid: DEAD_PID, worktree }));

    expect(emptyNow({ root })).toEqual({ emptied: 0, left: 0, restored: 1 });
    expect(existsSync(join(worktree, "packages", "x", "node_modules", "pkg", "index.js"))).toBe(true);
  });

  it("is held, never put back, while a provision that started after its writer died holds the tree's deps lock", () => {
    const { root, worktree } = seedPending({ pid: DEAD_PID });

    const settled = unwrap(
      withDepsLock({
        act: () => emptyNow({ root }),
        waitMs: 0,
        worktree,
      }),
    );

    expect(settled).toEqual({ emptied: 0, left: 1, restored: 0 });
    expect(existsSync(join(root, "seat-1", "0", "pkg", "index.js"))).toBe(true);
    expect(existsSync(join(worktree, "node_modules"))).toBe(false);
  });

  it("is held, never put back, when its tree's git directory cannot be resolved, since the lock cannot be asked", () => {
    const { root, worktree } = seedPending({ pid: DEAD_PID });
    rmSync(join(worktree, ".git"), { recursive: true });

    expect(emptyNow({ root })).toEqual({ emptied: 0, left: 1, restored: 0 });
    expect(existsSync(join(worktree, "node_modules"))).toBe(false);
  });

  it("is held, never deleted, while its writer is still running", () => {
    const { root, worktree } = seedPending({ pid: process.pid });

    expect(emptyNow({ root })).toEqual({ emptied: 0, left: 1, restored: 0 });
    expect(existsSync(join(root, "seat-1", "0", "pkg", "index.js"))).toBe(true);
    expect(existsSync(join(worktree, "node_modules"))).toBe(false);
  });

  it("is deleted once its writer died and its tree is gone", () => {
    const { root, worktree } = seedPending({ pid: DEAD_PID });
    rmSync(worktree, { recursive: true });

    expect(emptyNow({ root })).toEqual({ emptied: 1, left: 0, restored: 0 });
    expect(readdirSync(root)).toEqual([]);
  });

  it("is held while still staging under a live writer, and deleted once that writer is gone", () => {
    const root = join(dir, "trash");
    const pending = { moves: [], worktree: join(dir, "seat") };
    for (const [name, pid] of [
      ["live-1.staging", process.pid],
      ["dead-1.staging", DEAD_PID],
    ] as const) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, "pending.json"), JSON.stringify({ ...pending, pid }));
    }
    mkdirSync(join(root, "bare-1.staging"));

    expect(emptyNow({ root })).toEqual({ emptied: 1, left: 2, restored: 0 });
    expect(readdirSync(root).toSorted()).toEqual(["bare-1.staging", "live-1.staging"]);
  });

  it("is deleted once a staging batch with no marker is older than the grace, a fresh one still held", () => {
    const root = join(dir, "trash");
    mkdirSync(join(root, "old-1.staging"), { recursive: true });
    mkdirSync(join(root, "fresh-1.staging"));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(join(root, "old-1.staging"), twoHoursAgo, twoHoursAgo);

    expect(emptyNow({ root })).toEqual({ emptied: 1, left: 1, restored: 0 });
    expect(readdirSync(root)).toEqual(["fresh-1.staging"]);
  });

  it("is held when its marker does not parse", () => {
    const { root } = seedPending({ pid: DEAD_PID });
    writeFileSync(join(root, "seat-1", "pending.json"), "{");

    expect(emptyNow({ root })).toEqual({ emptied: 0, left: 1, restored: 0 });
  });
});
