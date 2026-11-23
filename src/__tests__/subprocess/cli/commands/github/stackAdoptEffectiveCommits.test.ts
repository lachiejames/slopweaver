/**
 * `stackAdoptEffectiveCommits.ts` against a real repository — the proof that `stack adopt` stops refusing
 * precisely the pull requests it exists to repair.
 *
 * The fixture reproduces the exact shape of a real admin-app pull request: a branch of two commits, one
 * of which is a stale COPY of a change its base has since landed. GitHub reports two commits, the old
 * ordering refused, and a rebase would have left exactly one.
 *
 * The falsifiable half is the third case: a branch of two commits that are BOTH genuinely its own must still
 * be refused, and a branch whose surviving commit is not its tip must still be refused — otherwise this
 * measurement would be a way to make the single-commit replay silently drop real work.
 *
 * `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import {
  measureEffectiveCommits,
  rebaseWouldLeaveOneCommit,
} from "../../../../../cli/commands/github/stackAdoptEffectiveCommits.js";
import { err, ok } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const realGit: GithubPushDeps = {
  cwd: () => "",
  doorLedger: memoryDoorLedger().port,
  out: () => {},
  readGit: ({ cwd, args }) => gitInTemp({ args, cwd }),
  writeGit: ({ cwd, args }) => {
    try {
      gitInTemp({ args, cwd });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error.message : String(error));
    }
  },
};

/** A bare "remote" plus a clone, matching how `stack adopt` actually operates against a real GitHub remote. */
function initRemoteAndClone(): { workDir: string } {
  const remoteDir = mkdtempSync(join(tmpdir(), "eff-commits-remote-"));
  fixtureDirs.push(remoteDir);
  gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });
  const workDir = mkdtempSync(join(tmpdir(), "eff-commits-work-"));
  fixtureDirs.push(workDir);
  gitInTemp({ args: ["clone", remoteDir, "."], cwd: workDir });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: workDir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: workDir });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: workDir });
  return { workDir };
}

/** Write one file and commit it, returning the commit's SHA. */
function commitFile({
  content,
  message,
  name,
  workDir,
}: {
  content: string;
  message: string;
  name: string;
  workDir: string;
}): string {
  writeFileSync(join(workDir, name), content);
  gitInTemp({ args: ["add", "-A"], cwd: workDir });
  gitInTemp({ args: ["commit", "-m", message], cwd: workDir });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });
}

describe("measureEffectiveCommits against a real repository", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports one surviving commit for a branch whose extra commit is a stale copy of what its base landed", () => {
    const { workDir } = initRemoteAndClone();
    commitFile({ content: "root\n", message: "root", name: "root.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

    // The branch carries the consent-test change first, then its own real work, the shape the fixture reproduces.
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
    commitFile({ content: "consent\n", message: "add the consent test", name: "consent.txt", workDir });
    const headSha = commitFile({ content: "real\n", message: "the real work", name: "real.txt", workDir });

    // The base then lands the SAME consent change independently, so the branch's copy is a duplicate.
    // The MESSAGE differs deliberately: `git patch-id` reads the diff and nothing else, so the two stay
    // patch-equivalent, while the commits themselves are guaranteed to be distinct objects. With identical
    // content, message, author and committer, git computes the SAME SHA whenever both land inside one
    // second — which is a real duplicate SHA, not a duplicate patch, and makes the whole fixture describe a
    // different shape. MEASURED: this test passed locally and failed on CI's faster runner with
    // `origin/main..HEAD` reading 1 instead of 2, purely on that timing.
    gitInTemp({ args: ["checkout", "main"], cwd: workDir });
    commitFile({ content: "consent\n", message: "land the consent test on the base", name: "consent.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
    gitInTemp({ args: ["checkout", "feature"], cwd: workDir });

    expect(gitInTemp({ args: ["rev-list", "--count", "origin/main..HEAD"], cwd: workDir })).toBe("2");

    const measured = measureEffectiveCommits({
      baseBranch: "main",
      git: realGit,
      headSha,
      remote: "origin",
      worktreePath: workDir,
    });

    expect(measured.measured).toBe(true);
    expect(measured.count).toBe(1);
    expect(measured.tipSurvives).toBe(true);
    expect(rebaseWouldLeaveOneCommit({ effective: measured })).toBe(true);
  });

  it("reports two surviving commits for a branch whose commits are both genuinely its own", () => {
    const { workDir } = initRemoteAndClone();
    commitFile({ content: "root\n", message: "root", name: "root.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
    commitFile({ content: "one\n", message: "first", name: "one.txt", workDir });
    const headSha = commitFile({ content: "two\n", message: "second", name: "two.txt", workDir });

    const measured = measureEffectiveCommits({
      baseBranch: "main",
      git: realGit,
      headSha,
      remote: "origin",
      worktreePath: workDir,
    });

    expect(measured.measured).toBe(true);
    expect(measured.count).toBe(2);
    expect(measured.tipSurvives).toBe(false);
    expect(rebaseWouldLeaveOneCommit({ effective: measured })).toBe(false);
  });

  it("refuses a branch whose one surviving commit is NOT its tip, which the replay would silently drop", () => {
    const { workDir } = initRemoteAndClone();
    commitFile({ content: "root\n", message: "root", name: "root.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

    // Real work FIRST, stale duplicate on top: replaying the tip would push the duplicate and drop the work.
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
    commitFile({ content: "real\n", message: "the real work", name: "real.txt", workDir });
    const headSha = commitFile({ content: "consent\n", message: "add the consent test", name: "consent.txt", workDir });

    // A distinct message for the same reason the first case gives: identical content, message and identity
    // inside one second produce one SHA, not two commits with one patch.
    gitInTemp({ args: ["checkout", "main"], cwd: workDir });
    commitFile({ content: "consent\n", message: "land the consent test on the base", name: "consent.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
    gitInTemp({ args: ["checkout", "feature"], cwd: workDir });

    expect(gitInTemp({ args: ["rev-list", "--count", "origin/main..HEAD"], cwd: workDir })).toBe("2");

    const measured = measureEffectiveCommits({
      baseBranch: "main",
      git: realGit,
      headSha,
      remote: "origin",
      worktreePath: workDir,
    });

    expect(measured.measured).toBe(true);
    expect(measured.count).toBe(1);
    expect(measured.tipSurvives).toBe(false);
    expect(rebaseWouldLeaveOneCommit({ effective: measured })).toBe(false);
  });

  it("reports the measurement as not taken, never as one commit, when the base cannot be fetched", () => {
    const { workDir } = initRemoteAndClone();
    const headSha = commitFile({ content: "root\n", message: "root", name: "root.txt", workDir });

    const measured = measureEffectiveCommits({
      baseBranch: "no-such-branch",
      git: realGit,
      headSha,
      remote: "origin",
      worktreePath: workDir,
    });

    expect(measured.measured).toBe(false);
    expect(measured.count).toBe(0);
    expect(rebaseWouldLeaveOneCommit({ effective: measured })).toBe(false);
    expect(measured.residue).toContain("could not fetch origin/no-such-branch");
  });

  it("leaves no private fetch ref behind", () => {
    const { workDir } = initRemoteAndClone();
    const headSha = commitFile({ content: "root\n", message: "root", name: "root.txt", workDir });
    gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

    measureEffectiveCommits({ baseBranch: "main", git: realGit, headSha, remote: "origin", worktreePath: workDir });

    expect(gitInTemp({ args: ["for-each-ref", "--format=%(refname)", "refs/slopweaver/"], cwd: workDir })).toBe("");
  });
});
