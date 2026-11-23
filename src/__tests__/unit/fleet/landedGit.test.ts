/**
 * The git half of `fleet landed`, against a real throwaway repository: main resolved by the first candidate that
 * names a commit and never by HEAD, and its first-parent log read to the limit asked.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LandedErrors } from "../../../fleet/landedErrors.js";
import { landedGitFailure, readLandedLog, resolveLandedRef } from "../../../fleet/landedGit.js";
import { err, unwrap } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

describe("main's history in a checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  let dir = "";
  let headSha = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "landed-git-"));
    const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: dir });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-m", "First change (#1)");
    writeFileSync(join(dir, "a.txt"), "two\n");
    git("add", ".");
    git("commit", "-m", "Second change (#2)");
    headSha = git("rev-parse", "HEAD");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("resolves the first candidate that names a commit, skipping one that does not", () => {
    const resolved = resolveLandedRef({ dir, refs: ["origin/main", "main"] });
    expect(unwrap(resolved)).toEqual({ ref: "main", sha: headSha });
  });

  it("refuses naming every candidate when none resolves", () => {
    const resolved = resolveLandedRef({ dir, refs: ["origin/main", "trunk"] });
    expect(resolved._unsafeUnwrapErr()).toEqual(LandedErrors.refUnresolved({ ref: "origin/main or trunk" }));
  });

  it("reads the newest first-parent commits, as many as asked", () => {
    const lines = unwrap(readLandedLog({ dir, limit: 1, sha: headSha }))
      .trim()
      .split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]!.startsWith(`${headSha}\t`)).toBe(true);
    expect(lines[0]!.endsWith("\tSecond change (#2)")).toBe(true);
  });

  it("says git failed rather than reading an empty history when the commit is not there", () => {
    const log = readLandedLog({ dir, limit: 2, sha: "b".repeat(40) });
    expect(log._unsafeUnwrapErr().code).toBe("GIT_FAILED");
  });
});

describe("a git read stopped at its bound", () => {
  it("is named as timed out, never as an ordinary git failure", () => {
    const failure = landedGitFailure({ cause: { code: "ETIMEDOUT", signal: "SIGKILL" }, command: "rev-parse main" });
    expect(failure).toEqual(LandedErrors.gitTimedOut({ command: "rev-parse main", timeoutMs: 120_000 }));
    expect(failure.message).toBe("git rev-parse main was still running after 2 minutes, so it was stopped");
  });

  it("keeps a non-zero exit an ordinary failure", () => {
    const failure = landedGitFailure({ cause: new Error("exit 128"), command: "log" });
    expect(failure).toEqual(LandedErrors.gitFailed({ cause: new Error("exit 128"), command: "log" }));
  });

  it("ends the ref walk on a hung child rather than falling through to the next candidate", () => {
    const asked: string[] = [];
    const resolved = resolveLandedRef({
      dir: "/nowhere",
      read: ({ args }) => {
        asked.push(args.join(" "));
        return err(LandedErrors.gitTimedOut({ command: args.join(" "), timeoutMs: 120_000 }));
      },
      refs: ["origin/main", "main"],
    });
    expect(resolved._unsafeUnwrapErr().code).toBe("GIT_TIMED_OUT");
    expect(asked).toEqual(["rev-parse --verify --quiet origin/main^{commit}"]);
  });
});
