/**
 * The worktree add lock: two creations of one path never overlap, every spelling of the path is one lock, and a
 * throwing creation still releases it (`addLock.ts`).
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockDir } from "../../../admit/operationLockPath.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { physicalPathKey, withWorktreeAddLock } from "../../../worktree/addLock.js";

let gitCommonDir = "";

beforeEach(() => {
  gitCommonDir = realpathSync(mkdtempSync(join(tmpdir(), "add-lock-")));
});

afterEach(() => {
  rmSync(gitCommonDir, { force: true, recursive: true });
});

const path = "/repo/.claude/worktrees.noindex/slug";

describe("physicalPathKey", () => {
  it("resolves the nearest existing ancestor through a symlink and appends the rest", () => {
    mkdirSync(join(gitCommonDir, "real"));
    symlinkSync(join(gitCommonDir, "real"), join(gitCommonDir, "link"));

    // The temp root is under `/private` on darwin, which the key drops by design (`worktreePathKey`).
    expect(physicalPathKey({ path: join(gitCommonDir, "link", "not", "yet") })).toBe(
      join(gitCommonDir.replace(/^\/private(?=\/)/u, ""), "real", "not", "yet").toLowerCase(),
    );
  });

  it("still folds the `.claude/worktrees` alias when nothing on the path exists", () => {
    expect(physicalPathKey({ path: "/absent-root/.claude/worktrees/slug" })).toBe(
      "/absent-root/.claude/worktrees.noindex/slug",
    );
  });

  it("is one key for two spellings differing only in case, as darwin's default volume treats them", () => {
    mkdirSync(join(gitCommonDir, "Repo"));

    expect(physicalPathKey({ path: join(gitCommonDir, "Repo", "Slug") })).toBe(
      physicalPathKey({ path: join(gitCommonDir, "repo", "slug") }),
    );
  });
});

describe("withWorktreeAddLock", () => {
  it("runs the creation, answers its value, and roots the lock in the common git directory", () => {
    expect(unwrap(withWorktreeAddLock({ act: () => 7, gitCommonDir, path }))).toBe(7);
    expect(existsSync(operationLockDir({ home: join(gitCommonDir, "slopweaver") }))).toBe(true);
  });

  it("refuses a second creation of the path while the first holds it, never running it", () => {
    const ran: string[] = [];

    const second = unwrap(
      withWorktreeAddLock({
        act: () => withWorktreeAddLock({ act: () => ran.push("second"), gitCommonDir, path }),
        gitCommonDir,
        path,
      }),
    );

    expect(unwrapErr(second)).toContain(`another creation of the worktree at ${path} is in flight`);
    expect(ran).toEqual([]);
  });

  it("refuses a creation of the same path spelled in another case while the first holds it", () => {
    const ran: string[] = [];

    const second = unwrap(
      withWorktreeAddLock({
        act: () => withWorktreeAddLock({ act: () => ran.push("second"), gitCommonDir, path: path.toUpperCase() }),
        gitCommonDir,
        path,
      }),
    );

    expect([unwrapErr(second).includes(`held by pid ${String(process.pid)}`), ran]).toEqual([true, []]);
  });

  it("is one lock for the `.claude/worktrees` alias of `worktrees.noindex`", () => {
    const alias = "/repo/.claude/worktrees/slug";

    const viaAlias = unwrap(
      withWorktreeAddLock({
        act: () => withWorktreeAddLock({ act: () => "ran", gitCommonDir, path: alias }),
        gitCommonDir,
        path,
      }),
    );

    expect(unwrapErr(viaAlias)).toContain(`held by pid ${String(process.pid)}`);
  });

  it("is one lock for a repository reached through a symlinked root, and for its common git directory", () => {
    const real = join(gitCommonDir, "real-repo");
    mkdirSync(join(real, ".claude", "worktrees.noindex"), { recursive: true });
    symlinkSync(real, join(gitCommonDir, "alias-repo"));
    symlinkSync(gitCommonDir, join(gitCommonDir, "..", `${basename(gitCommonDir)}-link`));
    const viaLink = join(gitCommonDir, "..", `${basename(gitCommonDir)}-link`);

    const viaSymlink = unwrap(
      withWorktreeAddLock({
        act: () =>
          withWorktreeAddLock({
            act: () => "ran",
            gitCommonDir: viaLink,
            path: join(gitCommonDir, "alias-repo", ".claude", "worktrees.noindex", "slug"),
          }),
        gitCommonDir,
        path: join(real, ".claude", "worktrees.noindex", "slug"),
      }),
    );

    rmSync(viaLink);
    expect(unwrapErr(viaSymlink)).toContain(`held by pid ${String(process.pid)}`);
  });

  it("lets a creation of a DIFFERENT path run while one is held", () => {
    const other = unwrap(
      withWorktreeAddLock({
        act: () =>
          withWorktreeAddLock({ act: () => "ran", gitCommonDir, path: "/repo/.claude/worktrees.noindex/other" }),
        gitCommonDir,
        path,
      }),
    );

    expect(unwrap(other)).toBe("ran");
  });

  it("releases the lock when the creation throws, so the retry is a plain retry", () => {
    expect(() =>
      withWorktreeAddLock({
        act: () => {
          throw new Error("git worktree add failed");
        },
        gitCommonDir,
        path,
      }),
    ).toThrow("git worktree add failed");

    expect(unwrap(withWorktreeAddLock({ act: () => "retried", gitCommonDir, path }))).toBe("retried");
  });
});
