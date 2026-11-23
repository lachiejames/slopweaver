/**
 * `readWorktreeCommit` against a REAL repository, because the defect it guards is a property of git's own config:
 * a repository-local `status.showUntrackedFiles=no` hides an untracked file from a plain `git status`, so a parked
 * worktree holding unfinished work would read clean on the merged head.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readWorktreeCommit } from "../../../cli/commands/handover/wakeWorktreeCommit.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

let root = "";

describe("readWorktreeCommit over a real repository", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "wt-commit-"));
    gitInTemp({ args: ["init", "-q", "-b", "asked"], cwd: root });
    writeFileSync(join(root, "a.txt"), "a\n");
    gitInTemp({ args: ["add", "-A"], cwd: root });
    gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "a"], cwd: root });
    gitInTemp({ args: ["config", "status.showUntrackedFiles", "no"], cwd: root });
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("reads a clean tree as clean on its branch", () => {
    const read = unwrap(readWorktreeCommit({ cwd: root, timeoutMs: REAL_GIT_TIMEOUT_MS }));
    expect([read.branch, read.dirty]).toEqual(["asked", false]);
  });

  it("reads an untracked file as dirty though the repository's config hides untracked files", () => {
    writeFileSync(join(root, "unfinished.txt"), "work\n");
    const read = unwrap(readWorktreeCommit({ cwd: root, timeoutMs: REAL_GIT_TIMEOUT_MS }));
    expect([read.branch, read.dirty]).toEqual(["asked", true]);
  });
});

describe("readWorktreeCommit over a repository whose fsmonitor hook reports nothing changed", () => {
  let monitored = "";

  beforeAll(() => {
    monitored = mkdtempSync(join(tmpdir(), "wt-fsmon-"));
    gitInTemp({ args: ["init", "-q", "-b", "asked"], cwd: monitored });
    writeFileSync(join(monitored, "a.txt"), "a\n");
    gitInTemp({ args: ["add", "-A"], cwd: monitored });
    gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "a"], cwd: monitored });
    // A hook speaking fsmonitor protocol 2 that always answers "nothing changed since the last token".
    const hook = join(monitored, ".git", "lying-fsmonitor");
    writeFileSync(hook, "#!/bin/sh\nprintf 'tok\\0'\n", { mode: 0o755 });
    gitInTemp({ args: ["config", "core.fsmonitor", hook], cwd: monitored });
    gitInTemp({ args: ["config", "core.fsmonitorHookVersion", "2"], cwd: monitored });
    // Two plain reads prime the index's fsmonitor extension, so the next read trusts the hook.
    gitInTemp({ args: ["status"], cwd: monitored });
    gitInTemp({ args: ["status"], cwd: monitored });
    writeFileSync(join(monitored, "a.txt"), "unfinished work\n");
  });

  afterAll(() => {
    rmSync(monitored, { force: true, recursive: true });
  });

  // A repository's fsmonitor hook can hide a modified tracked file from a plain status.
  it("reads a modified tracked file as dirty though the hook says nothing changed", () => {
    const read = unwrap(readWorktreeCommit({ cwd: monitored, timeoutMs: REAL_GIT_TIMEOUT_MS }));
    expect([read.branch, read.dirty]).toEqual(["asked", true]);
  });
});

describe("readWorktreeCommit over a repository whose index tells git not to check a file", () => {
  let flagged = "";

  beforeAll(() => {
    flagged = mkdtempSync(join(tmpdir(), "wt-flag-"));
    gitInTemp({ args: ["init", "-q", "-b", "asked"], cwd: flagged });
    writeFileSync(join(flagged, "a.txt"), "a\n");
    gitInTemp({ args: ["add", "-A"], cwd: flagged });
    gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "a"], cwd: flagged });
    gitInTemp({ args: ["update-index", "--assume-unchanged", "a.txt"], cwd: flagged });
    writeFileSync(join(flagged, "a.txt"), "unfinished work\n");
  });

  afterAll(() => {
    rmSync(flagged, { force: true, recursive: true });
  });

  // An assume-unchanged file is one status never compares, so the tree it sits in is unprovable, never clean.
  it("reads an assume-unchanged file's tree as dirty though status lists nothing", () => {
    const read = unwrap(readWorktreeCommit({ cwd: flagged, timeoutMs: REAL_GIT_TIMEOUT_MS }));
    expect([read.branch, read.dirty]).toEqual(["asked", true]);
  });
});
