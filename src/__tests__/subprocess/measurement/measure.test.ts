/**
 * The pure half of measurement: folding a `gh` check rollup into one verdict, plus the git-facts rules.
 *
 * The rollup fold is the completion condition that would have caught the pull request whose unit tests went red
 * on the very commit its agent reported as done, so `pending`, `unknown` and `none` are each pinned as NOT
 * green — the direction that actually matters.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkRollupOf, isAlive, measureGit, resolveTrunk } from "../../../measurement/measure.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("checkRollupOf", () => {
  it("reports `unknown` when the field is not a list — nothing could be read", () => {
    expect(checkRollupOf({ value: undefined })).toEqual({ failing: [], state: "unknown" });
  });

  it("reports `none` for a pull request with an empty rollup", () => {
    expect(checkRollupOf({ value: [] })).toEqual({ failing: [], state: "none" });
  });

  it("reports `green` when every check has completed successfully", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "SUCCESS", name: "build", status: "COMPLETED" },
        { conclusion: "SUCCESS", name: "lint", status: "COMPLETED" },
      ],
    });

    expect(rollup).toEqual({ failing: [], state: "green" });
  });

  it("reports `failing` and names the check", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "SUCCESS", name: "build", status: "COMPLETED" },
        { conclusion: "FAILURE", name: "unit", status: "COMPLETED" },
      ],
    });

    expect(rollup).toEqual({ failing: ["unit"], state: "failing" });
  });

  it("treats a timed-out and a cancelled check as failures", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "TIMED_OUT", name: "slow", status: "COMPLETED" },
        { conclusion: "CANCELLED", name: "stopped", status: "COMPLETED" },
      ],
    });

    expect(rollup.failing).toEqual(["slow", "stopped"]);
  });

  it("lets one red check outrank many green ones", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "SUCCESS", name: "a", status: "COMPLETED" },
        { conclusion: "SUCCESS", name: "b", status: "COMPLETED" },
        { conclusion: "FAILURE", name: "c", status: "COMPLETED" },
      ],
    });

    expect(rollup.state).toBe("failing");
  });

  it("reports `pending` while a check is still running, rather than green", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "SUCCESS", name: "build", status: "COMPLETED" },
        { conclusion: null, name: "unit", status: "IN_PROGRESS" },
      ],
    });

    expect(rollup).toEqual({ failing: [], state: "pending" });
  });

  it("lets a red check outrank a pending one, because red is already an answer", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "FAILURE", name: "unit", status: "COMPLETED" },
        { conclusion: null, name: "slow", status: "IN_PROGRESS" },
      ],
    });

    expect(rollup.state).toBe("failing");
  });

  it("falls back to `context` and then `workflowName` for a check's display name", () => {
    const rollup = checkRollupOf({
      value: [
        { conclusion: "FAILURE", context: "legacy-status", status: "COMPLETED" },
        { conclusion: "FAILURE", status: "COMPLETED", workflowName: "CI" },
      ],
    });

    expect(rollup.failing).toEqual(["legacy-status", "CI"]);
  });

  it("names an unnamed failing check rather than printing nothing", () => {
    expect(checkRollupOf({ value: [{ conclusion: "FAILURE", status: "COMPLETED" }] }).failing).toEqual([
      "(unnamed check)",
    ]);
  });

  it("ignores a null entry rather than crashing on it", () => {
    expect(checkRollupOf({ value: [null, { conclusion: "SUCCESS", name: "a", status: "COMPLETED" }] }).state).toBe(
      "green",
    );
  });
});

describe("isAlive", () => {
  it("says this very process is alive", () => {
    expect(isAlive({ pid: process.pid })).toBe(true);
  });

  it("refuses a pid that cannot exist rather than asking the kernel", () => {
    expect(isAlive({ pid: 0 })).toBe(false);
    expect(isAlive({ pid: -1 })).toBe(false);
  });
});

/**
 * A temp repo that can COMMIT. The identity and gpg settings are per-repo rather than assumed: a CI runner
 * has no global git identity, so `git commit` fails there with `empty ident name` while passing locally.
 *
 * @param branch the branch to initialise on
 * @returns the repository directory
 */
function committableRepo({ branch }: { branch: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-trunk-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", branch], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: dir });
  return dir;
}

describe("resolveTrunk", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads the trunk from the remote's recorded HEAD, stripping the remote prefix", () => {
    const repo = committableRepo({ branch: "staging" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "first"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/staging", "HEAD"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/staging"], cwd: repo });

    const trunk = resolveTrunk({ worktree: repo });

    expect(trunk.known).toBe(true);
    expect(trunk.known ? trunk.value : "").toBe("refs/heads/staging");
  });

  /**
   * R2's counterexample. Git resolves `refs/tags/<name>` AHEAD of `refs/heads/<name>`, warns on stderr, and
   * these callers do not read stderr — so a bare trunk name let a same-named tag silently supply the wrong
   * base. The resolved ref is fully qualified for exactly this reason.
   */
  it("is not shadowed by a TAG sharing the trunk's name", () => {
    const repo = committableRepo({ branch: "staging" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "older"], cwd: repo });
    // The tag points one commit BEHIND the trunk, so counting against it inflates the ahead-count.
    gitInTemp({ args: ["tag", "staging-decoy"], cwd: repo });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "trunk"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/staging", "HEAD"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/staging"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/tags/staging", "staging-decoy"], cwd: repo });
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: repo });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "work"], cwd: repo });

    const trunk = resolveTrunk({ worktree: repo });
    const facts = measureGit({ base: undefined, worktree: repo });

    expect(trunk.known ? trunk.value : "").toBe("refs/heads/staging");
    // One commit ahead of the BRANCH. Against the tag it would be two.
    expect(facts.known ? facts.value.commitsAhead : -1).toBe(1);
  });

  /**
   * R2 round two, reproduced before it was believed: `symbolic-ref --short` renders
   * `refs/remotes/origin/main` as `remotes/origin/main` when a `refs/tags/origin/main` exists, and the code
   * then looked for a BRANCH of that name. The full, unshortened form is read for exactly this reason.
   */
  it("is not fooled by refs that change how git SHORTENS the symbolic ref", () => {
    const repo = committableRepo({ branch: "main" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "parent"], cwd: repo });
    gitInTemp({ args: ["tag", "decoy"], cwd: repo });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "trunk"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", "HEAD"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], cwd: repo });
    // The two decoys that make `--short` render `remotes/origin/main` instead of `origin/main`.
    gitInTemp({ args: ["update-ref", "refs/tags/origin/main", "decoy"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/heads/remotes/origin/main", "decoy"], cwd: repo });
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: repo });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "work"], cwd: repo });

    const trunk = resolveTrunk({ worktree: repo });
    const facts = measureGit({ base: undefined, worktree: repo });

    expect(trunk.known ? trunk.value : "").toBe("refs/heads/main");
    // One commit ahead of the real trunk. Against either decoy it would be two.
    expect(facts.known ? facts.value.commitsAhead : -1).toBe(1);
  });

  it("is NOT MEASURED when the trunk it names exists as neither a local branch nor a remote ref", () => {
    const repo = committableRepo({ branch: "feature" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "first"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/ghost", "HEAD"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost"], cwd: repo });
    gitInTemp({ args: ["update-ref", "-d", "refs/remotes/origin/ghost"], cwd: repo });

    const trunk = resolveTrunk({ worktree: repo });

    expect(trunk.known).toBe(false);
    expect(trunk.known === false ? trunk.why : "").toContain("neither refs/heads/ghost nor");
  });

  it("is NOT MEASURED, naming the fix, when the remote HEAD was never recorded", () => {
    const repo = committableRepo({ branch: "main" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "first"], cwd: repo });

    const trunk = resolveTrunk({ worktree: repo });

    expect(trunk.known).toBe(false);
    expect(trunk.known === false ? trunk.why : "").toContain("git remote set-head origin --auto");
  });

  it("counts commits against a non-main trunk, which is what a second repository has", () => {
    const repo = committableRepo({ branch: "staging" });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "trunk"], cwd: repo });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/staging", "HEAD"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/staging"], cwd: repo });
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: repo });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "work"], cwd: repo });

    const facts = measureGit({ base: undefined, worktree: repo });

    expect(facts.known).toBe(true);
    expect(facts.known ? facts.value.commitsAhead : -1).toBe(1);
    expect(facts.known ? facts.value.branch : "").toBe("feature");
  });
});
