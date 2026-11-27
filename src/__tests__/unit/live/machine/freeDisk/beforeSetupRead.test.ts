/**
 * `gitEntriesInside` over a throwaway tree: a `.git` directory, link file or symlink anywhere below the root is counted,
 * however deep, and a tree with none counts zero.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { gitEntriesInside } from "../../../../../live/machine/freeDisk/beforeSetupRead.js";

const roots: string[] = [];

/** A fresh tree holding one ordinary file. */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "before-setup-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export {};\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("gitEntriesInside", () => {
  it("counts zero for a tree with no git entry", () => {
    expect(unwrap(gitEntriesInside({ root: tree() }))).toBe(0);
  });

  it("counts a nested .git directory and a deep .git link file", () => {
    const root = tree();
    mkdirSync(join(root, "vendor", "lib", ".git"), { recursive: true });
    writeFileSync(join(root, "vendor", "lib", ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", ".git"), "gitdir: /elsewhere/.git/worktrees/c\n");

    expect(unwrap(gitEntriesInside({ root }))).toBe(2);
  });

  it("counts a symlink named .git and never follows it into the repository it points at", () => {
    const root = tree();
    const elsewhere = tree();
    mkdirSync(join(elsewhere, "repo", ".git", "nested", ".git"), { recursive: true });
    mkdirSync(join(root, "linked"));
    symlinkSync(join(elsewhere, "repo", ".git"), join(root, "linked", ".git"));

    expect(unwrap(gitEntriesInside({ root }))).toBe(1);
  });

  it("does not descend through a symlinked directory that holds a .git", () => {
    const root = tree();
    const elsewhere = tree();
    mkdirSync(join(elsewhere, ".git"));
    symlinkSync(elsewhere, join(root, "outside"));

    expect(unwrap(gitEntriesInside({ root }))).toBe(0);
  });
});
