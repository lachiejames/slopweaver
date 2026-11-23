import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { directoryKey, sameDirectory } from "../../../lib/sameDirectory.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-same-directory-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("sameDirectory", () => {
  it("treats a path through a symlinked parent as the directory behind the link", () => {
    // The measured shape: `worktrees -> worktrees.noindex`, a registration spelled through the link, a cwd
    // spelled physically.
    const root = fixture();
    mkdirSync(join(root, "worktrees.noindex", "scheduler"), { recursive: true });
    symlinkSync("worktrees.noindex", join(root, "worktrees"));
    expect(
      sameDirectory({
        left: join(root, "worktrees", "scheduler"),
        right: join(root, "worktrees.noindex", "scheduler"),
      }),
    ).toBe(true);
  });

  it("folds every link in a nested worktree path, not only the first", () => {
    // A recipe child's worktree sits under a scheduler worktree that sits under a loop worktree, and every
    // level carries the alias. A lexical fold of the first segment alone would leave the inner two unequal.
    const root = fixture();
    const inner = join(
      "worktrees.noindex",
      "a",
      ".claude",
      "worktrees.noindex",
      "b",
      ".claude",
      "worktrees.noindex",
      "c",
    );
    mkdirSync(join(root, inner), { recursive: true });
    symlinkSync("worktrees.noindex", join(root, "worktrees"));
    symlinkSync("worktrees.noindex", join(root, "worktrees.noindex", "a", ".claude", "worktrees"));
    symlinkSync(
      "worktrees.noindex",
      join(root, "worktrees.noindex", "a", ".claude", "worktrees.noindex", "b", ".claude", "worktrees"),
    );
    const linked = join(root, "worktrees", "a", ".claude", "worktrees", "b", ".claude", "worktrees", "c");
    expect(sameDirectory({ left: linked, right: join(root, inner) })).toBe(true);
  });

  it("folds the worktrees alias for a path that does not exist yet", () => {
    expect(sameDirectory({ left: "/r/.claude/worktrees/missing", right: "/r/.claude/worktrees.noindex/missing" })).toBe(
      true,
    );
  });

  it("distinguishes two real sibling directories", () => {
    const root = fixture();
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    expect(sameDirectory({ left: join(root, "a"), right: join(root, "b") })).toBe(false);
  });

  it("compares a missing path by its absolute spelling", () => {
    const root = fixture();
    expect(sameDirectory({ left: join(root, "missing"), right: join(root, "missing") })).toBe(true);
    expect(sameDirectory({ left: join(root, "missing"), right: join(root, "other") })).toBe(false);
  });

  it("compares a missing path against a real one without throwing", () => {
    const root = fixture();
    mkdirSync(join(root, "real"));
    expect(sameDirectory({ left: join(root, "real"), right: join(root, "missing") })).toBe(false);
  });
});

describe("directoryKey", () => {
  it("keys a subdirectory reached through a symlinked root under the root's own key", () => {
    const root = fixture();
    mkdirSync(join(root, "checkouts", "repo", "packages", "api"), { recursive: true });
    mkdirSync(join(root, "links"));
    symlinkSync(join(root, "checkouts", "repo"), join(root, "links", "repo"));
    const rootKey = directoryKey({ path: join(root, "checkouts", "repo") });
    expect(directoryKey({ path: join(root, "links", "repo", "packages", "api") })).toBe(
      join(rootKey, "packages", "api"),
    );
  });

  it("keys a deleted subdirectory under a symlinked root under the root's own key", () => {
    const root = fixture();
    mkdirSync(join(root, "checkouts", "repo"), { recursive: true });
    mkdirSync(join(root, "links"));
    symlinkSync(join(root, "checkouts", "repo"), join(root, "links", "repo"));
    const rootKey = directoryKey({ path: join(root, "checkouts", "repo") });
    expect(directoryKey({ path: join(root, "links", "repo", "packages", "api") })).toBe(
      join(rootKey, "packages", "api"),
    );
  });
});
