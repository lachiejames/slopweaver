/*
 * A worktree git has LOCKED is never removed: the hold is absolute and unwaivable at any age, the last rule asked, so
 * whatever else holds a tree is reported first and a lock still ends the walk the week-old waiver would finish.
 */
import { describe, expect, it } from "vitest";

import { classify, DAY_MS, NOW_MS } from "./harness.js";

describe("a locked worktree is never removed", () => {
  it("holds an otherwise-removable merged tree", () => {
    const verdict = classify({ locked: true });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("locked by `git worktree lock`");
  });

  it("holds a clean tree on its own pushed branch with no open pull request", () => {
    const verdict = classify({ branchOnOwnRemote: true, locked: true, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("locked by `git worktree lock`");
  });

  it("holds a dirty, unpushed tree a month old rather than salvaging it", () => {
    const verdict = classify({ dirtyCount: 3, lastActivityMs: NOW_MS - 30 * DAY_MS, locked: true, unbackedCommits: 2 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("locked by `git worktree lock`");
  });

  it("holds a tree whose board row is CLOSED", () => {
    expect(classify({ locked: true, runClosed: true }).reason).toBe("locked by `git worktree lock`");
  });

  it("holds a warm tree on the lock only after the coldness rule has spoken", () => {
    expect(classify({ lastActivityMs: NOW_MS - 60_000, locked: true }).reason).toBe("touched 0h ago");
  });

  it("reports a live reference ahead of the lock", () => {
    expect(classify({ liveRefs: ["live workspace workspace:9"], locked: true }).reason).toBe(
      "referenced by live workspace workspace:9",
    );
  });

  it("leaves an unlocked merged tree removable", () => {
    expect(classify({ locked: false }).cls).toBe("merged");
  });
});
