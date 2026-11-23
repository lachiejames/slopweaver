/**
 * {@link mainCheckoutCleanliness} — real filesystem round-trips against a real repo + a real linked
 * worktree, since the whole point is distinguishing the main checkout from a linked one and reading real
 * `git status --porcelain` output.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mainCheckoutCleanliness } from "../../../admit/mainCheckoutCleanliness.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repo (its own `.git` directory) plus one real linked worktree, in a fresh temp dir. */
function realRepoWithWorktree(): { main: string; linked: string } {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-cleanliness-main-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  gitInTemp({ args: ["commit", "--allow-empty", "-q", "-m", "root"], cwd: main });
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-cleanliness-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

describe("mainCheckoutCleanliness", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports clean for a freshly committed main checkout", () => {
    const { main } = realRepoWithWorktree();
    expect(mainCheckoutCleanliness({ cwd: main })).toEqual({ dirty: false, entries: 0 });
  });

  it("reports dirty with the entry count for an untracked file", () => {
    const { main } = realRepoWithWorktree();
    writeFileSync(join(main, "untracked.txt"), "hi");
    expect(mainCheckoutCleanliness({ cwd: main })).toEqual({ dirty: true, entries: 1 });
  });

  it("counts each changed file separately", () => {
    const { main } = realRepoWithWorktree();
    writeFileSync(join(main, "a.txt"), "a");
    writeFileSync(join(main, "b.txt"), "b");
    expect(mainCheckoutCleanliness({ cwd: main })).toEqual({ dirty: true, entries: 2 });
  });

  it("is undefined for a linked worktree, never asserting its own status", () => {
    const { linked } = realRepoWithWorktree();
    writeFileSync(join(linked, "untracked.txt"), "hi");
    expect(mainCheckoutCleanliness({ cwd: linked })).toBeUndefined();
  });

  it("is undefined for a directory that is not a git repository at all", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-cleanliness-none-"));
    fixtureDirs.push(outside);
    expect(mainCheckoutCleanliness({ cwd: outside })).toBeUndefined();
  });
});
