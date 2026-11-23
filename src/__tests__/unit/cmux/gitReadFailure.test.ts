/**
 * {@link describeGitReadFailure} — pure — and {@link gitReadError} over what `execFileSync` really throws, so the
 * tick-188 message is pinned against Node rather than against a restatement. The missing-directory case spawns
 * `node` rather than git: Node refuses to start ANY child in a missing cwd, with the same `{ code: "ENOENT",
 * stderr: undefined }` shape, and the test door for git (`gitInTemp`) refuses a missing directory itself before
 * git would start.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { describeGitReadFailure, gitReadError } from "../../../cmux/gitReadFailure.js";
import { gitInTemp } from "../../tempGitRepo.js";

describe("describeGitReadFailure", () => {
  const args = ["worktree", "list", "--porcelain"];

  it("names a missing working directory — the bare `repo: slopweaver` shape Node reports as spawnSync git ENOENT", () => {
    const message = describeGitReadFailure({
      args,
      code: "ENOENT",
      cwd: "slopweaver",
      cwdExists: false,
      message: "spawnSync git ENOENT",
      stderr: "",
    });
    expect(message).toBe(
      "git worktree list --porcelain failed: its working directory slopweaver does not exist — a row's repo: " +
        "must be the absolute path of a checkout, never a bare name",
    );
  });

  it("prefers git's own words when git ran and spoke", () => {
    const message = describeGitReadFailure({
      args,
      code: undefined,
      cwd: "/w/repo",
      cwdExists: true,
      message: "Command failed: git worktree list --porcelain",
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
    });
    expect(message).toBe(
      "git worktree list --porcelain failed: fatal: not a git repository (or any of the parent directories): .git",
    );
  });

  it("names the start failure's code and message when the directory exists, so a missing git reads as one", () => {
    const message = describeGitReadFailure({
      args,
      code: "ENOENT",
      cwd: "/w/repo",
      cwdExists: true,
      message: "spawnSync git ENOENT",
      stderr: "",
    });
    expect(message).toBe("git worktree list --porcelain failed: ENOENT (spawnSync git ENOENT)");
  });

  it("says only that it failed when git exited silently in a real directory", () => {
    const message = describeGitReadFailure({
      args,
      code: undefined,
      cwd: "/w/repo",
      cwdExists: true,
      message: "Command failed: git worktree list --porcelain",
      stderr: "  \n",
    });
    expect(message).toBe("git worktree list --porcelain failed");
  });
});

describe("gitReadError over what execFileSync really throws", () => {
  const args = ["worktree", "list", "--porcelain"];
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  /** What `execFileSync` throws for this git read in `cwd` (the test door runs it unwrapped), caught — the value `runGit` hands over. */
  function thrownBy({ cwd }: { cwd: string }): unknown {
    try {
      gitInTemp({ args, cwd });
    } catch (error: unknown) {
      return error;
    }
    throw new Error(`git ran in ${cwd} and succeeded`);
  }

  /** What Node throws when asked to start a child in `cwd`, caught — a start failure, since no child runs. */
  function startFailureIn({ cwd }: { cwd: string }): unknown {
    try {
      execFileSync(process.execPath, ["--version"], { cwd, stdio: "pipe" });
    } catch (error: unknown) {
      return error;
    }
    throw new Error(`a child started in ${cwd}`);
  }

  it("names the missing directory Node refused to start a child in, and keeps Node's error as the cause", () => {
    const parent = mkdtempSync(join(tmpdir(), "git-read-"));
    dirs.push(parent);
    const cwd = join(parent, "slopweaver");
    const error = startFailureIn({ cwd });
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("ENOENT");
    const thrown = gitReadError({ args, cwd, error });
    expect(thrown.message).toBe(
      `git worktree list --porcelain failed: its working directory ${cwd} does not exist — a row's repo: ` +
        "must be the absolute path of a checkout, never a bare name",
    );
    expect(thrown.cause).toBe(error);
  });

  it("carries git's own stderr when git ran in a directory that is not a checkout", () => {
    const cwd = mkdtempSync(join(tmpdir(), "git-read-"));
    dirs.push(cwd);
    const thrown = gitReadError({ args, cwd, error: thrownBy({ cwd }) });
    expect(thrown.message).toContain("git worktree list --porcelain failed: fatal: not a git repository");
  });
});
