/** `cmux/worktreeAdminDir.ts` — the failed-add cleanup's direct removal of one admin directory, over a temp fixture. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeDanglingWorktreeAdminDir } from "../../../cmux/worktreeAdminDir.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worktree-admin-dir-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** One admin directory under the fixture's `.git/worktrees/`, recording `gitdir` the way git writes it. */
const adminDir = ({ id, gitdir }: { id: string; gitdir: string }): string => {
  const admin = join(dir, "repo", ".git", "worktrees", id);
  mkdirSync(admin, { recursive: true });
  writeFileSync(join(admin, "gitdir"), `${gitdir}\n`);
  return admin;
};

describe("removeDanglingWorktreeAdminDir", () => {
  it("removes only the admin directory whose recorded gitdir names the path's .git", () => {
    const mine = adminDir({ gitdir: join(dir, "w", ".git"), id: "w" });
    const other = adminDir({ gitdir: join(dir, "other", ".git"), id: "other" });

    removeDanglingWorktreeAdminDir({ gitCommonDir: join(dir, "repo", ".git"), path: join(dir, "w") });

    expect([existsSync(mine), existsSync(other)]).toEqual([false, true]);
  });

  it("leaves an admin directory with no gitdir file alone", () => {
    const admin = join(dir, "repo", ".git", "worktrees", "half");
    mkdirSync(admin, { recursive: true });

    removeDanglingWorktreeAdminDir({ gitCommonDir: join(dir, "repo", ".git"), path: join(dir, "half") });

    expect(existsSync(admin)).toBe(true);
  });

  it("does nothing, and does not throw, when the repository has no worktrees directory", () => {
    mkdirSync(join(dir, "repo", ".git"), { recursive: true });

    removeDanglingWorktreeAdminDir({ gitCommonDir: join(dir, "repo", ".git"), path: join(dir, "w") });

    expect(existsSync(join(dir, "repo", ".git", "worktrees"))).toBe(false);
  });
});
