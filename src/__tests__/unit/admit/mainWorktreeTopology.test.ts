/**
 * The worktree topology `src/admit/mainWorktree.ts` reads from disk — the shapes git itself writes, built by
 * hand in temp directories so the read is pinned without a `git` child anywhere in the test. That no child
 * is spawned is the point: these predicates run on every `Bash` call, and the fork chain they replaced was
 * the check that scaled worst under load. `subprocess/admit/hookWallClock.test.ts` holds the read equal to
 * `git rev-parse` on a real `git worktree add` fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isMainWorktree, isMainWorktreeForRepository } from "../../../admit/mainWorktree.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A main worktree and one linked worktree of it, laid out exactly as `git worktree add` lays them out.
 *
 * @param relativeGitdir write the linked `.git` file's `gitdir:` relative to it, as `worktree.useRelativePaths`
 * @returns the two worktree roots
 */
function repoWithLinkedWorktree({ relativeGitdir = false }: { relativeGitdir?: boolean } = {}): {
  main: string;
  linked: string;
} {
  const root = mkdtempSync(join(tmpdir(), "sw-topology-"));
  dirs.push(root);
  const main = join(root, "main");
  const linked = join(root, "linked");
  const entry = join(main, ".git", "worktrees", "linked");
  mkdirSync(entry, { recursive: true });
  mkdirSync(linked);
  writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(entry, "HEAD"), "ref: refs/heads/linked\n");
  writeFileSync(join(entry, "commondir"), "../..\n");
  const gitdir = relativeGitdir ? relative(linked, entry) : entry;
  writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
  return { linked, main };
}

describe("isMainWorktree, read from disk", () => {
  it("is true in a main worktree, whose .git is a directory", () => {
    const { main } = repoWithLinkedWorktree();
    expect(isMainWorktree({ cwd: main })).toBe(true);
  });

  it("is true in a subdirectory of the main worktree, found by walking up", () => {
    const { main } = repoWithLinkedWorktree();
    const deep = join(main, "packages", "x");
    mkdirSync(deep, { recursive: true });
    expect(isMainWorktree({ cwd: deep })).toBe(true);
  });

  it("is false in a linked worktree, whose git dir names a different common dir", () => {
    const { linked } = repoWithLinkedWorktree();
    expect(isMainWorktree({ cwd: linked })).toBe(false);
  });

  it("is false in a linked worktree whose gitdir line is relative", () => {
    const { linked } = repoWithLinkedWorktree({ relativeGitdir: true });
    expect(isMainWorktree({ cwd: linked })).toBe(false);
  });

  it("is true for a submodule-shaped .git file whose git dir carries no commondir", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-topology-sub-"));
    dirs.push(root);
    const modules = join(root, "super", ".git", "modules", "sub");
    const sub = join(root, "super", "sub");
    mkdirSync(modules, { recursive: true });
    mkdirSync(sub);
    writeFileSync(join(modules, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(sub, ".git"), `gitdir: ${modules}\n`);
    // git rev-parse answers --git-dir == --git-common-dir here too.
    expect(isMainWorktree({ cwd: sub })).toBe(true);
  });

  it("is false outside any repository", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-topology-none-"));
    dirs.push(root);
    expect(isMainWorktree({ cwd: root })).toBe(false);
  });

  it("is false for a .git file naming a git dir that is not there", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-topology-dangling-"));
    dirs.push(root);
    writeFileSync(join(root, ".git"), `gitdir: ${join(root, "gone")}\n`);
    expect(isMainWorktree({ cwd: root })).toBe(false);
  });

  it("walks past a .git directory with no HEAD, as git's own discovery does", () => {
    const { linked } = repoWithLinkedWorktree();
    const nested = join(linked, "vendor", "x");
    mkdirSync(join(nested, ".git"), { recursive: true });
    expect(isMainWorktree({ cwd: nested })).toBe(false);
  });

  it("is false for a .git file naming a directory with no HEAD", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-topology-headless-"));
    dirs.push(root);
    mkdirSync(join(root, "not-a-git-dir"));
    writeFileSync(join(root, ".git"), `gitdir: ${join(root, "not-a-git-dir")}\n`);
    expect(isMainWorktree({ cwd: root })).toBe(false);
  });

  it("is false for a cwd that does not exist, even inside a main worktree", () => {
    const { main } = repoWithLinkedWorktree();
    expect(isMainWorktree({ cwd: join(main, "not", "yet") })).toBe(false);
  });

  it("reads a gitdir line carrying a CRLF ending and trailing spaces", () => {
    const { linked } = repoWithLinkedWorktree();
    const { main } = repoWithLinkedWorktree();
    writeFileSync(join(linked, ".git"), `gitdir: ${join(main, ".git")}  \r\n`);
    expect(isMainWorktree({ cwd: linked })).toBe(true);
  });

  it("is false for a .git file whose gitdir line is not its first, as git refuses one", () => {
    const { linked } = repoWithLinkedWorktree();
    const { main } = repoWithLinkedWorktree();
    writeFileSync(join(linked, ".git"), `garbage\ngitdir: ${join(main, ".git")}\n`);
    expect(isMainWorktree({ cwd: linked })).toBe(false);
  });

  it("is false for a .git file carrying no gitdir line", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-topology-garbled-"));
    dirs.push(root);
    writeFileSync(join(root, ".git"), "not a gitdir line\n");
    expect(isMainWorktree({ cwd: root })).toBe(false);
  });
});

describe("isMainWorktreeForRepository, read from disk", () => {
  it("is true for the main worktree of the repository a linked worktree belongs to", () => {
    const { linked, main } = repoWithLinkedWorktree();
    expect(isMainWorktreeForRepository({ cwd: main, repositoryCwd: linked })).toBe(true);
  });

  it("is false for the linked worktree itself", () => {
    const { linked, main } = repoWithLinkedWorktree();
    expect(isMainWorktreeForRepository({ cwd: linked, repositoryCwd: main })).toBe(false);
  });

  it("is false for the main worktree of a DIFFERENT repository", () => {
    const one = repoWithLinkedWorktree();
    const two = repoWithLinkedWorktree();
    expect(isMainWorktreeForRepository({ cwd: one.main, repositoryCwd: two.linked })).toBe(false);
  });
});
