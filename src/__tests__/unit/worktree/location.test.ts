import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  ensureNoindexWorktreesDir,
  isUnderWorktrees,
  planWorktreesDirRepair,
  readWorktreesDirFacts,
  WORKTREE_SUFFIX,
  worktreePath,
  worktreePathKey,
  worktreesDir,
  worktreesLink,
} from "../../../worktree/location.js";

describe("worktreePath and its siblings", () => {
  it("places every worktree under the .noindex directory", () => {
    expect(worktreesDir({ repoRoot: "/r" })).toBe("/r/.claude/worktrees.noindex");
    expect(worktreesLink({ repoRoot: "/r" })).toBe("/r/.claude/worktrees");
    expect(worktreePath({ name: "slug", repoRoot: "/r" })).toBe("/r/.claude/worktrees.noindex/slug");
  });

  it("recognises a path under either spelling of the worktrees directory", () => {
    expect(isUnderWorktrees({ checkout: "/r", path: "/r/.claude/worktrees/slug" })).toBe(true);
    expect(isUnderWorktrees({ checkout: "/r", path: "/r/.claude/worktrees.noindex/slug/src" })).toBe(true);
    expect(isUnderWorktrees({ checkout: "/r", path: "/r/src" })).toBe(false);
    expect(isUnderWorktrees({ checkout: "/r", path: "/r/.claude/worktreesx/slug" })).toBe(false);
  });

  it("strips a worktree suffix in either spelling", () => {
    expect("/r/.claude/worktrees.noindex/slug".replace(WORKTREE_SUFFIX, "")).toBe("/r");
    expect("/r/.claude/worktrees/slug/".replace(WORKTREE_SUFFIX, "")).toBe("/r");
    expect("/r/.claude/worktrees/slug/src".replace(WORKTREE_SUFFIX, "")).toBe("/r/.claude/worktrees/slug/src");
  });
});

describe("worktreePathKey", () => {
  it("folds the alias, the /private prefix and lexical noise onto one key", () => {
    const physical = "/r/.claude/worktrees.noindex/slug";
    expect(worktreePathKey({ path: "/r/.claude/worktrees/slug" })).toBe(physical);
    expect(worktreePathKey({ path: "/r/.claude/worktrees/slug/" })).toBe(physical);
    expect(worktreePathKey({ path: "/private/r/.claude/worktrees/x/../slug" })).toBe(physical);
    expect(worktreePathKey({ path: physical })).toBe(physical);
  });

  it("folds EVERY worktrees segment, so a worktree nested in another has one key", () => {
    const physical = "/r/.claude/worktrees.noindex/outer/nested/.claude/worktrees.noindex/branch";
    expect(worktreePathKey({ path: "/r/.claude/worktrees/outer/nested/.claude/worktrees/branch" })).toBe(physical);
    expect(worktreePathKey({ path: "/r/.claude/worktrees.noindex/outer/nested/.claude/worktrees/branch" })).toBe(
      physical,
    );
  });

  it("leaves the directory itself and unrelated paths alone", () => {
    expect(worktreePathKey({ path: "/r/.claude/worktrees" })).toBe("/r/.claude/worktrees.noindex");
    expect(worktreePathKey({ path: "/r/.claude/worktreesx/slug" })).toBe("/r/.claude/worktreesx/slug");
    expect(worktreePathKey({ path: "/private" })).toBe("/private");
  });
});

describe("planWorktreesDirRepair", () => {
  it("takes no step when the alias already points at the .noindex directory", () => {
    const plan = planWorktreesDirRepair({
      facts: { dir: "directory", link: "symlink", linkTarget: "worktrees.noindex" },
    });
    expect(plan.isOk()).toBe(true);
    expect(unwrap(plan)).toEqual([]);
  });

  it("renames a real worktrees directory and leaves the alias behind", () => {
    const plan = planWorktreesDirRepair({ facts: { dir: "absent", link: "directory", linkTarget: undefined } });
    expect(unwrap(plan)).toEqual(["rename-alias-to-dir", "create-alias"]);
  });

  it("creates both when neither exists, and only the alias when the directory does", () => {
    expect(unwrap(planWorktreesDirRepair({ facts: { dir: "absent", link: "absent", linkTarget: undefined } }))).toEqual(
      ["create-dir", "create-alias"],
    );
    expect(
      unwrap(planWorktreesDirRepair({ facts: { dir: "directory", link: "absent", linkTarget: undefined } })),
    ).toEqual(["create-alias"]);
    expect(
      unwrap(planWorktreesDirRepair({ facts: { dir: "absent", link: "symlink", linkTarget: "worktrees.noindex" } })),
    ).toEqual(["create-dir"]);
  });

  it("refuses the layouts a rename would merge or hide", () => {
    const both = planWorktreesDirRepair({ facts: { dir: "directory", link: "directory", linkTarget: undefined } });
    expect(both.isErr()).toBe(true);
    expect(both._unsafeUnwrapErr().code).toBe("WORKTREES_DIR_CONFLICT");
    expect(both._unsafeUnwrapErr().message).toContain("merge them by hand");

    const elsewhere = planWorktreesDirRepair({ facts: { dir: "absent", link: "symlink", linkTarget: "/elsewhere" } });
    expect(elsewhere._unsafeUnwrapErr().message).toContain("symlink to /elsewhere");

    const file = planWorktreesDirRepair({ facts: { dir: "other", link: "absent", linkTarget: undefined } });
    expect(file._unsafeUnwrapErr().message).toContain("a plain file");

    const dirIsLink = planWorktreesDirRepair({ facts: { dir: "symlink", link: "absent", linkTarget: undefined } });
    expect(dirIsLink._unsafeUnwrapErr().message).toContain("worktrees.noindex is itself a symlink");
  });
});

describe("ensureNoindexWorktreesDir", () => {
  const roots: string[] = [];
  const freshRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-noindex-"));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("renames an existing worktrees directory, keeps its contents reachable through the alias, then idles", () => {
    const repoRoot = freshRoot();
    mkdirSync(join(repoRoot, ".claude", "worktrees", "slug"), { recursive: true });
    writeFileSync(join(repoRoot, ".claude", "worktrees", "slug", "marker.txt"), "kept");

    expect(unwrap(ensureNoindexWorktreesDir({ repoRoot }))).toEqual(["rename-alias-to-dir", "create-alias"]);
    expect(readlinkSync(join(repoRoot, ".claude", "worktrees"))).toBe("worktrees.noindex");
    expect(realpathSync(join(repoRoot, ".claude", "worktrees", "slug", "marker.txt"))).toBe(
      realpathSync(join(repoRoot, ".claude", "worktrees.noindex", "slug", "marker.txt")),
    );
    expect(readWorktreesDirFacts({ repoRoot })).toEqual({
      dir: "directory",
      link: "symlink",
      linkTarget: "worktrees.noindex",
    });
    expect(unwrap(ensureNoindexWorktreesDir({ repoRoot }))).toEqual([]);
  });

  it("creates both from nothing, .claude included", () => {
    const repoRoot = freshRoot();
    expect(unwrap(ensureNoindexWorktreesDir({ repoRoot }))).toEqual(["create-dir", "create-alias"]);
    expect(readWorktreesDirFacts({ repoRoot })).toEqual({
      dir: "directory",
      link: "symlink",
      linkTarget: "worktrees.noindex",
    });
  });

  it("refuses without touching anything when the alias points elsewhere", () => {
    const repoRoot = freshRoot();
    mkdirSync(join(repoRoot, ".claude", "elsewhere"), { recursive: true });
    symlinkSync("elsewhere", join(repoRoot, ".claude", "worktrees"));
    const ensured = ensureNoindexWorktreesDir({ repoRoot });
    expect(ensured.isErr()).toBe(true);
    expect(ensured._unsafeUnwrapErr().code).toBe("WORKTREES_DIR_CONFLICT");
    expect(readWorktreesDirFacts({ repoRoot })).toEqual({ dir: "absent", link: "symlink", linkTarget: "elsewhere" });
  });
});
