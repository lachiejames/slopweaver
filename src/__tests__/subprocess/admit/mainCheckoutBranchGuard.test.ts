/**
 * {@link branchSwitchTarget}, {@link isMainWorktree} and {@link evaluateMainCheckoutBranchGuard}.
 * `isMainWorktree` is exercised against a REAL git repository + a real linked worktree — a genuine
 * filesystem round-trip `testing.md` sanctions, and the only way to prove the main-vs-linked distinction
 * without a mock.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TRUNK_BRANCH } from "../../../admit/declaredMainCheckouts.js";
import {
  branchSwitchTarget,
  evaluateMainCheckoutBranchGuard,
  MAIN_CHECKOUT_OVERRIDE_ENV,
  renamesBranch,
} from "../../../admit/mainCheckoutBranchGuard.js";
import { isMainWorktree } from "../../../admit/mainWorktree.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("branchSwitchTarget", () => {
  it("reads the target of a plain checkout", () => {
    expect(branchSwitchTarget({ command: "git checkout feature-x" })).toBe("feature-x");
  });

  it("reads the target of a plain switch", () => {
    expect(branchSwitchTarget({ command: "git switch feature-x" })).toBe("feature-x");
  });

  it("reads the new branch name from checkout -b, ignoring its start point", () => {
    expect(branchSwitchTarget({ command: "git checkout -b feature-x origin/main" })).toBe("feature-x");
  });

  it("reads the new branch name from switch -c", () => {
    expect(branchSwitchTarget({ command: "git switch -c feature-x" })).toBe("feature-x");
  });

  it("reads a detaching checkout to a commit-ish, since that also leaves trunk", () => {
    expect(branchSwitchTarget({ command: "git checkout HEAD~1" })).toBe("HEAD~1");
  });

  it("ignores a file-restore checkout, which never switches branches", () => {
    expect(branchSwitchTarget({ command: "git checkout main -- src/index.ts" })).toBeUndefined();
  });

  it("ignores the previous-branch shorthand, which this cannot resolve statically", () => {
    expect(branchSwitchTarget({ command: "git switch -" })).toBeUndefined();
  });

  it("ignores a bare checkout with no target", () => {
    expect(branchSwitchTarget({ command: "git checkout" })).toBeUndefined();
  });

  it("ignores a non-git command", () => {
    expect(branchSwitchTarget({ command: "ls checkout" })).toBeUndefined();
  });

  it("ignores an unrelated git subcommand", () => {
    expect(branchSwitchTarget({ command: "git status" })).toBeUndefined();
  });

  it("ignores a target built from shell expansion, since the real value is unknowable statically", () => {
    expect(branchSwitchTarget({ command: "git checkout $BRANCH" })).toBeUndefined();
  });
});

describe("renamesBranch", () => {
  it("reads a short rename of the checked-out branch", () => {
    expect(renamesBranch({ command: "git branch -m feature-x" })).toBe(true);
  });

  it("reads a forced rename", () => {
    expect(renamesBranch({ command: "git branch -M feature-x" })).toBe(true);
  });

  it("reads the two-argument rename of another branch", () => {
    expect(renamesBranch({ command: "git branch --move old new" })).toBe(true);
  });

  it("reads a rename behind a git -C global", () => {
    expect(renamesBranch({ command: "git -C /somewhere branch -m feature-x" })).toBe(true);
  });

  it("ignores --merged, which shares a prefix with -m but only reads", () => {
    expect(renamesBranch({ command: "git branch --merged" })).toBe(false);
  });

  it("ignores a branch listing", () => {
    expect(renamesBranch({ command: "git branch -a" })).toBe(false);
  });

  it("ignores a commit whose message flag is also -m", () => {
    expect(renamesBranch({ command: "git commit -m rename" })).toBe(false);
  });

  it("ignores a non-git command that mentions branch", () => {
    expect(renamesBranch({ command: "echo git branch -m x" })).toBe(false);
  });
});

/** A real repo (its own `.git` directory) plus one real linked worktree, in a fresh temp dir. */
function realRepoWithWorktree(): { main: string; linked: string } {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-guard-main-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  gitInTemp({ args: ["commit", "--allow-empty", "-q", "-m", "root"], cwd: main });
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-guard-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

describe("isMainWorktree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports true for the main checkout", () => {
    const { main } = realRepoWithWorktree();
    expect(isMainWorktree({ cwd: main })).toBe(true);
  });

  it("reports false for a linked worktree of the same repository", () => {
    const { linked } = realRepoWithWorktree();
    expect(isMainWorktree({ cwd: linked })).toBe(false);
  });

  it("reports false for a directory that is not a git repository at all", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-guard-none-"));
    fixtureDirs.push(outside);
    expect(isMainWorktree({ cwd: outside })).toBe(false);
  });
});

describe("evaluateMainCheckoutBranchGuard", () => {
  const checkMainWorktree = (): boolean => true;
  // Every case below injects the trunk rather than letting the default read `profile.json` and shell out to
  // `git remote`: the trunk resolver has its own tests in `declaredMainCheckouts.test.ts`, and a guard test
  // that depended on the operator's real profile would pass or fail on which machine ran it.

  /** Assert a call blocks and return its message (throws otherwise — keeps assertions unconditional). */
  function blockedMessage({
    command,
    checkMainWorktree: check,
    trunk = DEFAULT_TRUNK_BRANCH,
  }: {
    command: string;
    checkMainWorktree: () => boolean;
    trunk?: string;
  }): string {
    const decision = evaluateMainCheckoutBranchGuard({
      allowOverride: false,
      checkMainWorktree: check,
      command,
      cwd: "/anywhere",
      trunkBranch: () => trunk,
    });
    if (!decision.block) {
      throw new Error(`expected blocked for: ${command}`);
    }
    return decision.message;
  }

  it("blocks an off-trunk checkout in the main checkout", () => {
    expect(blockedMessage({ checkMainWorktree, command: "git checkout stray-branch" })).toContain(
      MAIN_CHECKOUT_OVERRIDE_ENV,
    );
  });

  it("allows checking out to the pinned trunk branch itself, even as a no-op", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `git checkout ${DEFAULT_TRUNK_BRANCH}`,
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("allows the same off-trunk checkout when it is not the main worktree", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree: () => false,
        command: "git checkout stray-branch",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("allows under the override", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: true,
        checkMainWorktree,
        command: "git checkout stray-branch",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("blocks a branch rename in the main checkout, which no trunk-name comparison would catch", () => {
    expect(blockedMessage({ checkMainWorktree, command: "git branch -m feature-x" })).toContain("renaming a branch");
  });

  it("blocks a rename whose new name IS the pinned trunk, since the old branch still moves", () => {
    expect(blockedMessage({ checkMainWorktree, command: `git branch -m ${DEFAULT_TRUNK_BRANCH}` })).toContain(
      MAIN_CHECKOUT_OVERRIDE_ENV,
    );
  });

  it("blocks a rename reached through an inline cd, the shape an earlier incident took", () => {
    expect(
      blockedMessage({
        checkMainWorktree,
        command: "cd /somewhere && git branch -m feature-x",
      }),
    ).toContain("renaming a branch");
  });

  it("allows a branch rename outside the main checkout", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree: () => false,
        command: "git branch -m feature-x",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("allows a branch rename under the override", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: true,
        checkMainWorktree,
        command: "git branch -m feature-x",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("allows a read of the branch list in the main checkout", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: "git branch --merged",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("names the standing check in every refusal, so a blocked session has a route", () => {
    expect(blockedMessage({ checkMainWorktree, command: "git checkout stray-branch" })).toContain(
      "slopweaver worktree here",
    );
  });

  // DEFECT 1, measured: `PINNED_TRUNK_BRANCH` was the literal "main", so a declared checkout
  // pinned to `staging` had the guard exactly inverted — the correct move onto its trunk was refused, and
  // every wrong move off that trunk was allowed, since both read as "not main".
  it("allows a checkout ONTO the trunk of a checkout pinned to something other than main", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: "git checkout staging",
        cwd: "/anywhere",
        trunkBranch: () => "staging",
      }),
    ).toEqual({ block: false });
  });

  it("blocks a checkout onto main in a checkout pinned to staging, naming staging as the trunk", () => {
    expect(blockedMessage({ checkMainWorktree, command: "git checkout main", trunk: "staging" })).toContain(
      "switching a protected main checkout off staging",
    );
  });

  it("resolves the trunk from the SEGMENT's own target directory, not the session cwd", () => {
    const seen: string[] = [];
    const decision = evaluateMainCheckoutBranchGuard({
      allowOverride: false,
      checkMainWorktree,
      command: "git -C /other/checkout checkout staging",
      cwd: "/anywhere",
      trunkBranch: ({ cwd: target }) => {
        seen.push(target);
        return "staging";
      },
    });
    expect(decision).toEqual({ block: false });
    expect(seen).toEqual(["/other/checkout"]);
  });

  // DEFECT 2, measured: the block message prescribed setting the override "for this one run", a
  // reader wrote it as an inline prefix, and the runner read only the hook process's own environment — where
  // an assignment on the command being judged has never been, because the hook runs before the command.
  it("honours the override written as an inline prefix on the refused command", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `${MAIN_CHECKOUT_OVERRIDE_ENV}=1 git -C /somewhere checkout staging`,
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("honours an inline env-prefixed override", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `env ${MAIN_CHECKOUT_OVERRIDE_ENV}=1 git checkout stray-branch`,
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("honours an inline prefix on a rename too, the other act this guard refuses", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `${MAIN_CHECKOUT_OVERRIDE_ENV}=1 git branch -m feature-x`,
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });

  it("does not let an inline override on one segment cover a different segment", () => {
    expect(
      blockedMessage({
        checkMainWorktree,
        command: `${MAIN_CHECKOUT_OVERRIDE_ENV}=1 git checkout one && git checkout two`,
      }),
    ).toContain("scoped to a different segment");
  });

  it("prescribes the prefix the guard actually honours, so the message and the escape agree", () => {
    expect(blockedMessage({ checkMainWorktree, command: "git checkout stray-branch" })).toContain(
      `prefix this one command with ${MAIN_CHECKOUT_OVERRIDE_ENV}=1`,
    );
  });

  it("allows a command that is not a branch switch at all", () => {
    expect(
      evaluateMainCheckoutBranchGuard({
        allowOverride: false,
        checkMainWorktree,
        command: "git status",
        cwd: "/anywhere",
        trunkBranch: () => DEFAULT_TRUNK_BRANCH,
      }),
    ).toEqual({ block: false });
  });
});
