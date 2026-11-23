/**
 * {@link looksLikeMainCheckoutWrite} and {@link evaluateMainCheckoutDirtyGuard}.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateMainCheckoutDirtyGuard,
  looksLikeMainCheckoutWrite,
  MAIN_CHECKOUT_WRITE_OVERRIDE_ENV,
} from "../../../admit/mainCheckoutDirtyGuard.js";

describe("looksLikeMainCheckoutWrite", () => {
  it("flags a commit", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git commit -m wip" })).toBe(true);
  });

  it("flags staging a file", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git add src/index.ts" })).toBe(true);
  });

  it("allows a status read", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git status" })).toBe(false);
  });

  it("allows a log read", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git log --oneline -5" })).toBe(false);
  });

  it("allows a diff read", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git diff origin/main" })).toBe(false);
  });

  it("allows a fetch, which never touches the working tree", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git fetch origin main" })).toBe(false);
  });

  it("allows a fast-forward-only merge, the sanctioned way to bring the checkout current", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git merge --ff-only origin/main" })).toBe(false);
  });

  it("flags a merge without --ff-only, which can create a merge commit", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git merge origin/main" })).toBe(true);
  });

  it("allows a fast-forward-only pull", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git pull --ff-only" })).toBe(false);
  });

  it("flags a plain pull, which can create a merge commit", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git pull" })).toBe(true);
  });

  it("allows a hard reset, which leaves the tree clean at the new HEAD", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git reset --hard origin/main" })).toBe(false);
  });

  it("flags a plain (mixed) reset, which can leave the old diff showing as unstaged", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git reset HEAD~1" })).toBe(true);
  });

  it("flags a soft reset, which can leave the old diff showing as staged", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git reset --soft HEAD~1" })).toBe(true);
  });

  it("flags a file-restore checkout, which is a write even though it is not a branch switch", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git checkout main -- src/index.ts" })).toBe(true);
  });

  it("allows a plain branch checkout, which is the branch guard's own job", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git checkout main" })).toBe(false);
  });

  it("flags a bare stash, which defaults to push", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git stash" })).toBe(true);
  });

  it("flags stash pop", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git stash pop" })).toBe(true);
  });

  it("allows stash list, which never touches the working tree", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git stash list" })).toBe(false);
  });

  it("flags rm", () => {
    expect(looksLikeMainCheckoutWrite({ command: "rm -rf build" })).toBe(true);
  });

  it("flags output redirected to a file", () => {
    expect(looksLikeMainCheckoutWrite({ command: "echo hi > notes.txt" })).toBe(true);
  });

  it("flags output appended to a file", () => {
    expect(looksLikeMainCheckoutWrite({ command: "echo hi >> notes.txt" })).toBe(true);
  });

  it("flags a numbered stream redirected to a file", () => {
    expect(looksLikeMainCheckoutWrite({ command: "cat file 2> err.log" })).toBe(true);
  });

  it("allows a stream duplicated onto another stream, which never touches a file", () => {
    expect(looksLikeMainCheckoutWrite({ command: "cat file 2>&1" })).toBe(false);
  });

  it("redirecting stderr to /dev/null is not a write", () => {
    expect(looksLikeMainCheckoutWrite({ command: "grep -rl x /path 2>/dev/null" })).toBe(false);
  });

  it("redirecting stderr to a real file is still a write", () => {
    expect(looksLikeMainCheckoutWrite({ command: "cat file 2>/dev/null 1>real.log" })).toBe(true);
  });

  it("flags an in-place sed edit", () => {
    expect(looksLikeMainCheckoutWrite({ command: "sed -i 's/a/b/' file.ts" })).toBe(true);
  });

  it("allows a sed read to stdout", () => {
    expect(looksLikeMainCheckoutWrite({ command: "sed 's/a/b/' file.ts" })).toBe(false);
  });

  it("allows an unrelated read command", () => {
    expect(looksLikeMainCheckoutWrite({ command: "yarn test" })).toBe(false);
  });

  it("flags the write half of a chained command even when the first half is safe", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git fetch origin main && rm -rf build" })).toBe(true);
  });

  it("allows a chained sanctioned fetch + fast-forward-only merge", () => {
    expect(looksLikeMainCheckoutWrite({ command: "git fetch origin main && git merge --ff-only origin/main" })).toBe(
      false,
    );
  });

  it("flags a commit behind an env-var prefix", () => {
    expect(looksLikeMainCheckoutWrite({ command: "env FOO=bar git commit -m wip" })).toBe(true);
  });
});

describe("evaluateMainCheckoutDirtyGuard", () => {
  const checkMainWorktree = (): boolean => true;

  /** Assert a call blocks and return its message (throws otherwise — keeps assertions unconditional). */
  function blockedMessage({ command }: { command: string }): string {
    const decision = evaluateMainCheckoutDirtyGuard({
      allowOverride: false,
      checkMainWorktree,
      command,
      cwd: "/anywhere",
    });
    if (!decision.block) {
      throw new Error(`expected blocked for: ${command}`);
    }
    return decision.message;
  }

  it("blocks a write in the main checkout", () => {
    expect(blockedMessage({ command: "git commit -m wip" })).toContain(MAIN_CHECKOUT_WRITE_OVERRIDE_ENV);
  });

  it("allows a read in the main checkout", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: false,
        checkMainWorktree,
        command: "git status",
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });

  it("allows the same write when it is not the main worktree", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: false,
        checkMainWorktree: () => false,
        command: "git commit -m wip",
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });

  it("allows under the override", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: true,
        checkMainWorktree,
        command: "git commit -m wip",
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });

  it("allows an inline override prefixed to the write segment even with a trailing unrelated command", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 git commit -m wip\necho done`,
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });

  it("allows an inline override on the write segment after an unrelated cd", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `cd ../other && ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 git commit -m wip`,
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });

  it("still blocks when the override is scoped to a different, non-write segment", () => {
    const message = blockedMessage({
      command: `${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 git status && git commit -m wip`,
    });
    expect(message).toContain(MAIN_CHECKOUT_WRITE_OVERRIDE_ENV);
    expect(message).toContain("scoped to a different segment");
  });

  it("does not add the elsewhere-scoped hint when no override is present anywhere", () => {
    expect(blockedMessage({ command: "git commit -m wip" })).not.toContain("scoped to a different segment");
  });

  it("generalises an export override to every later chained segment", () => {
    expect(
      evaluateMainCheckoutDirtyGuard({
        allowOverride: false,
        checkMainWorktree,
        command: `export ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 && git add file.ts && git commit -m wip`,
        cwd: "/anywhere",
      }),
    ).toEqual({ block: false });
  });
});
