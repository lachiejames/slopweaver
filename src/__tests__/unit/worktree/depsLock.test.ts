/**
 * The worktree deps lock: a critical section never runs while another holder has the lock, two spellings of one
 * worktree are one lock, and the lock lives in the worktree's own git directory rather than under any state home —
 * the properties that close the reservation ABA (`depsLock.ts`).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockDir } from "../../../admit/operationLockPath.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import {
  cleanUpUnlessHeld,
  depsLockLocus,
  depsLockLocusMoved,
  withDepsLock,
  worktreeAdminIds,
} from "../../../worktree/depsLock.js";

/** The admin directories an add saw before it ran, when it was the first: none, so whatever registers is its own. */
const NONE_BEFORE: ReadonlySet<string> = new Set();

let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "deps-lock-")));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A worktree admin directory as git lays one out under the repository's common directory, `commondir` included. */
const adminDir = ({ id }: { id: string }): string => {
  const gitDir = join(dir, "repo", ".git", "worktrees", id);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  return gitDir;
};

/** A linked worktree as git lays one out: a `.git` FILE naming its own directory under the repository's. */
const linkedWorktree = ({ worktree }: { worktree: string }): { gitDir: string } => {
  const gitDir = adminDir({ id: "w" });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  return { gitDir };
};

/** Where every linked worktree's lock in the fixture repository lives: its common git directory. */
const commonRoot = (): string => join(dir, "repo", ".git", "slopweaver");

describe("depsLockLocus", () => {
  it("puts a linked worktree's lock in the common git directory, keyed by the worktree's ID", () => {
    const worktree = join(dir, "w");
    const { gitDir } = linkedWorktree({ worktree });
    expect(unwrap(depsLockLocus({ worktree }))).toEqual({
      gitDir,
      key: "worktree-node-modules w",
      real: worktree,
      root: commonRoot(),
    });
  });

  it("resolves a relative gitdir pointer against the worktree", () => {
    const worktree = join(dir, "w");
    adminDir({ id: "g" });
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), "gitdir: ../repo/.git/worktrees/g\n");
    expect(unwrap(depsLockLocus({ worktree })).key).toBe("worktree-node-modules g");
    expect(unwrap(depsLockLocus({ worktree })).root).toBe(commonRoot());
  });

  it("refuses a linked worktree whose admin directory git has removed, rather than placing a lock for it", () => {
    const worktree = join(dir, "w");
    const { gitDir } = linkedWorktree({ worktree });
    // What a `git worktree remove` that failed to delete the tree leaves: the tree, its `.git`, and no admin directory.
    rmSync(gitDir, { recursive: true });

    expect(unwrapErr(depsLockLocus({ worktree }))).toContain("could not be resolved to lock its node_modules");
  });

  it("puts a main checkout's lock in its .git directory", () => {
    mkdirSync(join(dir, "main", ".git"), { recursive: true });
    expect(unwrap(depsLockLocus({ worktree: join(dir, "main") })).root).toBe(join(dir, "main", ".git", "slopweaver"));
  });

  it("refuses a .git file that names no git directory", () => {
    mkdirSync(join(dir, "w"));
    writeFileSync(join(dir, "w", ".git"), "not a pointer\n");
    expect(unwrapErr(depsLockLocus({ worktree: join(dir, "w") }))).toContain("names no git directory");
  });

  it("refuses a worktree that does not exist rather than locking a name for it", () => {
    expect(unwrapErr(depsLockLocus({ worktree: join(dir, "absent") }))).toContain(
      "could not be resolved to lock its node_modules",
    );
  });
});

describe("depsLockLocusMoved", () => {
  it("answers nothing while the worktree still names the git directory its lock was taken in", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const held = unwrap(depsLockLocus({ worktree }));
    expect(depsLockLocusMoved({ held, worktree })).toBe(undefined);
  });

  it("names the move when the worktree was recreated at the same path under a new git directory", () => {
    const worktree = join(dir, "w");
    const { gitDir } = linkedWorktree({ worktree });
    const held = unwrap(depsLockLocus({ worktree }));
    // What a removal and a fresh `git worktree add` at the same path leave: a `.git` naming a different directory.
    const recreated = adminDir({ id: "w1" });
    writeFileSync(join(worktree, ".git"), `gitdir: ${recreated}\n`);

    expect(depsLockLocusMoved({ held, worktree })).toBe(
      `${worktree}'s git directory changed while its deps lock was taken (${gitDir} is now ${recreated}), so the lock held is not this worktree's`,
    );
  });

  it("names the failure when the worktree's git directory no longer resolves at all", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const held = unwrap(depsLockLocus({ worktree }));
    rmSync(join(worktree, ".git"));

    expect(depsLockLocusMoved({ held, worktree })).toContain("could not be resolved to lock its node_modules");
  });
});

describe("cleanUpUnlessHeld", () => {
  it("cleans up a registered worktree whose lock nobody holds, under the lock, told it registered", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const ran: { registered: boolean; nested: string }[] = [];

    const outcome = cleanUpUnlessHeld({
      cleanUp: ({ registered }) => {
        ran.push({ nested: unwrapErr(withDepsLock({ act: () => "nested", waitMs: 0, worktree })), registered });
      },
      adminIdsBefore: NONE_BEFORE,
      gitCommonDir: join(dir, "repo", ".git"),
      worktree,
    });

    expect(outcome).toBe("cleaned");
    expect(ran[0]!.registered).toBe(true);
    expect(ran[0]!.nested).toContain(`held by pid ${String(process.pid)}`);
  });

  it("leaves a worktree alone while a provision that reused it holds its lock", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const ran: boolean[] = [];

    const outcome = unwrap(
      withDepsLock({
        act: () =>
          cleanUpUnlessHeld({
            cleanUp: ({ registered }) => ran.push(registered),
            adminIdsBefore: NONE_BEFORE,
            gitCommonDir: join(dir, "repo", ".git"),
            worktree,
          }),
        waitMs: 0,
        worktree,
      }),
    );

    expect([outcome, ran]).toEqual(["held", []]);
  });

  it("tells the cleanup of a path that never registered so, since it runs without the deps lock", () => {
    const ran: boolean[] = [];

    const outcome = cleanUpUnlessHeld({
      cleanUp: ({ registered }) => ran.push(registered),
      adminIdsBefore: NONE_BEFORE,
      gitCommonDir: join(dir, "repo", ".git"),
      worktree: join(dir, "absent"),
    });

    expect([outcome, ran]).toEqual(["cleaned", [false]]);
  });

  it("treats a tree ANOTHER repository registered at the path as never the add's own, taking no lock", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const ran: { registered: boolean; nested: string }[] = [];

    const outcome = cleanUpUnlessHeld({
      cleanUp: ({ registered }) => {
        ran.push({ nested: unwrap(withDepsLock({ act: () => "lock was free", waitMs: 0, worktree })), registered });
      },
      adminIdsBefore: NONE_BEFORE,
      gitCommonDir: join(dir, "other-repo", ".git"),
      worktree,
    });

    expect([outcome, ran]).toEqual(["cleaned", [{ nested: "lock was free", registered: false }]]);
  });

  it("treats a tree whose admin directory predates the add — one moved onto the path — as never its own", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    // What `git worktree move` onto the path leaves: a tree registered under an ID that was there before the add.
    const adminIdsBefore = worktreeAdminIds({ gitCommonDir: join(dir, "repo", ".git") });
    const ran: { registered: boolean; nested: string }[] = [];

    const outcome = cleanUpUnlessHeld({
      adminIdsBefore,
      cleanUp: ({ registered }) => {
        ran.push({ nested: unwrap(withDepsLock({ act: () => "lock was free", waitMs: 0, worktree })), registered });
      },
      gitCommonDir: join(dir, "repo", ".git"),
      worktree,
    });

    expect([[...adminIdsBefore], outcome, ran]).toEqual([
      ["w"],
      "cleaned",
      [{ nested: "lock was free", registered: false }],
    ]);
  });
});

describe("worktreeAdminIds", () => {
  it("names every admin directory under the common directory's worktrees/", () => {
    adminDir({ id: "a" });
    adminDir({ id: "b" });
    expect([...worktreeAdminIds({ gitCommonDir: join(dir, "repo", ".git") })].toSorted()).toEqual(["a", "b"]);
  });

  it("is empty for a repository with no linked worktree yet", () => {
    mkdirSync(join(dir, "repo", ".git"), { recursive: true });
    expect(worktreeAdminIds({ gitCommonDir: join(dir, "repo", ".git") }).size).toBe(0);
  });
});

describe("withDepsLock", () => {
  it("is one lock for a worktree moved to a new path while its lock is held, since the key names no path", () => {
    const worktree = join(dir, "old");
    linkedWorktree({ worktree });
    const moved = join(dir, "new");

    const second = unwrap(
      withDepsLock({
        act: () => {
          // What `git worktree move` does mid-install: the same tree, and the same git directory, under a new name.
          renameSync(worktree, moved);
          return withDepsLock({ act: () => "second writer ran", waitMs: 0, worktree: moved });
        },
        waitMs: 0,
        worktree,
      }),
    );

    expect(unwrapErr(second)).toContain("held by pid");
  });

  it("runs the section, answers its value, and roots its lock in the common git directory, never the admin one", () => {
    const worktree = join(dir, "w");
    const { gitDir } = linkedWorktree({ worktree });
    expect(unwrap(withDepsLock({ act: () => 7, waitMs: 0, worktree }))).toBe(7);
    expect(existsSync(operationLockDir({ home: commonRoot() }))).toBe(true);
    expect(existsSync(join(gitDir, "slopweaver"))).toBe(false);
  });

  it("keeps a removal's lock while git deletes the admin directory, and refuses the waiter rather than recreating it", () => {
    const worktree = join(dir, "w");
    const { gitDir } = linkedWorktree({ worktree });
    const ran: string[] = [];

    const waiter = unwrap(
      withDepsLock({
        act: () => {
          // A failing `git worktree remove` inside the removal's section: the admin directory goes, the tree stays.
          rmSync(gitDir, { recursive: true });
          return withDepsLock({ act: () => ran.push("waiter"), waitMs: 0, worktree });
        },
        waitMs: 0,
        worktree,
      }),
    );

    expect(unwrapErr(waiter)).toContain("could not be resolved to lock its node_modules");
    expect([ran, existsSync(gitDir), existsSync(operationLockDir({ home: commonRoot() }))]).toEqual([[], false, true]);
  });

  it("never runs the section while another holder has the lock, then runs it once released", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const ran: string[] = [];

    const blocked = unwrap(
      withDepsLock({
        act: () => withDepsLock({ act: () => ran.push("inner"), waitMs: 60, worktree }),
        waitMs: 0,
        worktree,
      }),
    );
    const freed = withDepsLock({ act: () => ran.push("freed"), waitMs: 0, worktree });

    expect(unwrapErr(blocked)).toContain(`held by pid ${String(process.pid)}`);
    expect([unwrap(freed), ran]).toEqual([1, ["freed"]]);
  });

  it("is never taken over from a LIVE holder however old its lease, since an install may outlast any window", () => {
    const worktree = join(dir, "w");
    linkedWorktree({ worktree });
    const locks = operationLockDir({ home: commonRoot() });
    const ran: string[] = [];

    const stolen = unwrap(
      withDepsLock({
        act: () => {
          // Age the held lease past every finite window, the way a cold twenty-minute install would.
          const held = readdirSync(locks).find((name) => !name.includes(".candidate-"));
          const [token] = readdirSync(join(locks, held!));
          const record = join(locks, held!, token!);
          const contents = Object(safeJsonParse({ label: "deps lock record", text: readFileSync(record, "utf8") }));
          writeFileSync(record, JSON.stringify({ ...contents, acquiredAtIso: "2026-01-01T00:00:00.000Z" }));
          return withDepsLock({ act: () => ran.push("stolen"), waitMs: 0, worktree });
        },
        waitMs: 0,
        worktree,
      }),
    );

    expect(unwrapErr(stolen)).toContain("never to go stale while its holder lives");
    expect(ran).toEqual([]);
  });

  it("is one lock for an alias of the worktree, as `.claude/worktrees` is of `worktrees.noindex`", () => {
    const worktree = join(dir, "real", "w");
    linkedWorktree({ worktree });
    symlinkSync(join(dir, "real"), join(dir, "alias"));

    const viaAlias = unwrap(
      withDepsLock({
        act: () => withDepsLock({ act: () => "ran", waitMs: 0, worktree: join(dir, "alias", "w") }),
        waitMs: 0,
        worktree,
      }),
    );

    expect(unwrapErr(viaAlias)).toContain(`held by pid ${String(process.pid)}`);
  });
});
