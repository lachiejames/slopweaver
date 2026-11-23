import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { claimDeleteLease, DELETE_LEASE_ROOT_VAR, deleteLeaseRoot } from "../../../worktree/deleteLease.js";
import { type DepsFacts, depsStatus } from "../../../worktree/deps.js";
import { withDepsLock } from "../../../worktree/depsLock.js";
import {
  findRow,
  removeWorktree,
  renderWorktreeStatus,
  type WorktreeReadDeps,
  worktreeRows,
  worktreeStatus,
} from "../../../worktree/inventory.js";

const WORKTREES: readonly WorktreeInfo[] = [
  { branch: "main", path: "/repo" },
  { branch: "a-slug", path: "/repo/.claude/worktrees/a-slug" },
  { branch: null, path: "/tmp/snap/tree" },
];

const OWN_FACTS: DepsFacts = {
  installStateMs: 3_000,
  verifiedAtMs: undefined,
  linkTarget: undefined,
  lockfileMs: 2_000,
  lockfileText: "lock-a",
  manifestMs: 1_000,
  present: true,
  sharedLockfileText: "lock-a",
};

/** Fake read seams answering from literals, recording the git argv each call made. */
function fakeReadDeps({
  gitAnswers = {},
  removals = [],
  worktrees = WORKTREES,
}: {
  gitAnswers?: Readonly<Record<string, string | undefined>>;
  removals?: string[];
  worktrees?: readonly WorktreeInfo[];
}): WorktreeReadDeps {
  return {
    deps: () => depsStatus({ facts: OWN_FACTS }),
    git: ({ args }) => {
      const key = args.join(" ");
      removals.push(key);
      return gitAnswers[key];
    },
    worktrees: () => worktrees,
  };
}

describe("worktreeRows", () => {
  it("names each worktree by its directory and marks only the first as the main checkout", () => {
    const rows = worktreeRows({ worktrees: WORKTREES });

    expect(rows.map((row) => row.slug)).toEqual(["repo", "a-slug", "tree"]);
    expect(rows.map((row) => row.isMain)).toEqual([true, false, false]);
  });

  it("keeps a detached HEAD's null branch rather than inventing one", () => {
    expect(worktreeRows({ worktrees: WORKTREES })[2]!.branch).toBe(null);
  });
});

describe("findRow", () => {
  const rows = worktreeRows({ worktrees: WORKTREES });

  it("matches the directory name first", () => {
    expect(findRow({ rows, slug: "a-slug" })!.path).toBe("/repo/.claude/worktrees/a-slug");
  });

  it("falls back to the branch when no directory answers to the slug", () => {
    expect(findRow({ rows, slug: "main" })!.path).toBe("/repo");
  });

  it("finds nothing for a slug no worktree carries", () => {
    expect(findRow({ rows, slug: "nope" })).toBe(undefined);
  });
});

describe("worktreeStatus", () => {
  it("reports the branch, the base drift and the dependency state together", () => {
    const status = unwrap(
      worktreeStatus({
        base: "origin/main",
        deps: fakeReadDeps({ gitAnswers: { "rev-list --count HEAD..origin/main": "12" } }),
        repoRoot: "/repo",
        slug: "a-slug",
      }),
    );

    expect(status.row.branch).toBe("a-slug");
    expect(status.behind).toBe(12);
    expect(status.deps.link).toBe("own");
  });

  it("reports drift it could not measure as undefined rather than as zero", () => {
    const status = unwrap(
      worktreeStatus({ base: "origin/main", deps: fakeReadDeps({}), repoRoot: "/repo", slug: "a-slug" }),
    );

    expect(status.behind).toBe(undefined);
  });

  it("refuses a slug no worktree answers to", () => {
    const error = unwrapErr(
      worktreeStatus({ base: "origin/main", deps: fakeReadDeps({}), repoRoot: "/repo", slug: "nope" }),
    );

    expect(error.code).toBe("WORKTREE_NOT_FOUND");
  });
});

describe("renderWorktreeStatus", () => {
  it("says the drift could not be measured instead of printing a number it does not have", () => {
    const status = unwrap(
      worktreeStatus({ base: "origin/main", deps: fakeReadDeps({}), repoRoot: "/repo", slug: "a-slug" }),
    );

    expect(renderWorktreeStatus({ status })[2]).toBe("  base: origin/main — drift could not be measured");
  });

  it("names a detached HEAD rather than an empty branch", () => {
    const status = unwrap(
      worktreeStatus({ base: "origin/main", deps: fakeReadDeps({}), repoRoot: "/repo", slug: "tree" }),
    );

    expect(renderWorktreeStatus({ status })[1]).toBe("  branch: (detached HEAD)");
  });

  it("names the branch a worktree has checked out", () => {
    const status = unwrap(
      worktreeStatus({ base: "origin/main", deps: fakeReadDeps({}), repoRoot: "/repo", slug: "a-slug" }),
    );

    expect(renderWorktreeStatus({ status })[1]).toBe("  branch: a-slug");
  });
});

describe("removeWorktree", () => {
  // A real seat with a `.git` directory, so its deps lock has a git directory to live in.
  let scratch = "";
  let seat = "";
  let worktrees: readonly WorktreeInfo[] = [];

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "slopweaver-inventory-remove-"));
    seat = join(scratch, "a-slug");
    mkdirSync(join(seat, ".git"), { recursive: true });
    worktrees = [
      { branch: "main", path: "/repo" },
      { branch: "a-slug", path: seat },
    ];
  });

  afterEach(() => {
    rmSync(scratch, { force: true, recursive: true });
  });

  it("removes the worktree git registers for the slug", () => {
    const seen: string[] = [];
    const deps = fakeReadDeps({ gitAnswers: { [`worktree remove ${seat}`]: "" }, removals: seen, worktrees });
    const removed = unwrap(removeWorktree({ deps, force: false, repoRoot: "/repo", slug: "a-slug" }));

    expect(removed.path).toBe(seat);
    expect(seen).toEqual([`worktree remove ${seat}`]);
  });

  it("passes --force straight through to git rather than interpreting it", () => {
    const seen: string[] = [];
    const deps = fakeReadDeps({ gitAnswers: { [`worktree remove --force ${seat}`]: "" }, removals: seen, worktrees });
    unwrap(removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" }));

    expect(seen).toEqual([`worktree remove --force ${seat}`]);
  });

  it("holds the seat's deps lock while git removes it, so no provision can start inside the removal", () => {
    const provisionsRefused: boolean[] = [];
    const deps: WorktreeReadDeps = {
      ...fakeReadDeps({ worktrees }),
      git: () => {
        provisionsRefused.push(withDepsLock({ act: () => undefined, waitMs: 0, worktree: seat }).isErr());
        return "";
      },
    };
    unwrap(removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" }));

    expect(provisionsRefused).toEqual([true]);
  });

  it("holds the machine's delete lease while git removes it, so no prune deletes beside it", () => {
    const during: string[] = [];
    const deps: WorktreeReadDeps = {
      ...fakeReadDeps({ worktrees }),
      git: () => {
        during.push(claimDeleteLease({ root: deleteLeaseRoot() }).kind);
        return "";
      },
    };
    unwrap(removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" }));

    expect(during).toEqual(["busy"]);
  });

  it("runs no git, naming why, when the machine's delete lease cannot be taken at all", () => {
    const blocker = join(scratch, "no-lease");
    writeFileSync(blocker, "");
    const sandboxed = process.env[DELETE_LEASE_ROOT_VAR];
    process.env[DELETE_LEASE_ROOT_VAR] = join(blocker, "lease");
    const seen: string[] = [];
    const deps = fakeReadDeps({ gitAnswers: { [`worktree remove --force ${seat}`]: "" }, removals: seen, worktrees });
    let removed: ReturnType<typeof removeWorktree>;
    try {
      removed = removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" });
    } finally {
      process.env[DELETE_LEASE_ROOT_VAR] = sandboxed;
    }
    const error = unwrapErr(removed);

    expect(error.code).toBe("DELETE_LEASE_UNHELD");
    expect(error.message).toContain(`${seat} was not removed, because the machine's delete lease was not free: `);
    expect(seen).toEqual([]);
  });

  it("runs no git and names the holder while a provision holds the seat's deps lock", () => {
    const seen: string[] = [];
    const deps = fakeReadDeps({ gitAnswers: { [`worktree remove --force ${seat}`]: "" }, removals: seen, worktrees });
    const error = unwrapErr(
      unwrap(
        withDepsLock({
          act: () => removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" }),
          waitMs: 0,
          worktree: seat,
        }),
      ),
    );

    expect(error.code).toBe("DEPS_LOCKED");
    expect(error.message).toContain(
      `${seat} was not removed, because its node_modules is not free to delete: held by pid`,
    );
    expect(seen).toEqual([]);
  });

  it("runs no git when the seat's git directory cannot be resolved, since the lock cannot be asked", () => {
    rmSync(join(seat, ".git"), { recursive: true });
    const seen: string[] = [];
    const deps = fakeReadDeps({ gitAnswers: { [`worktree remove --force ${seat}`]: "" }, removals: seen, worktrees });
    const error = unwrapErr(removeWorktree({ deps, force: true, repoRoot: "/repo", slug: "a-slug" }));

    expect(error.code).toBe("DEPS_LOCKED");
    expect(seen).toEqual([]);
  });

  it("never removes the main checkout", () => {
    const error = unwrapErr(
      removeWorktree({ deps: fakeReadDeps({ worktrees }), force: true, repoRoot: "/repo", slug: "repo" }),
    );

    expect(error.code).toBe("REQUEST_INVALID");
    expect(error.message).toContain("main checkout");
  });

  it("names --force in the failure when git refused and it was not passed", () => {
    const error = unwrapErr(
      removeWorktree({ deps: fakeReadDeps({ worktrees }), force: false, repoRoot: "/repo", slug: "a-slug" }),
    );

    expect(error.code).toBe("GIT_FAILED");
    expect(error.message).toContain("--force");
  });

  it("refuses a slug no worktree answers to", () => {
    const error = unwrapErr(
      removeWorktree({ deps: fakeReadDeps({ worktrees }), force: false, repoRoot: "/repo", slug: "nope" }),
    );

    expect(error.code).toBe("WORKTREE_NOT_FOUND");
  });
});
