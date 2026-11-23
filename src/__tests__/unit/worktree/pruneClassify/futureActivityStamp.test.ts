/*
 * An activity stamp ahead of the clock: the worktree is held, and its age never renders negative.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree } from "../../../../worktree/pruneClassify.js";
import { DAY_MS } from "./harness.js";

describe("an activity stamp ahead of the clock", () => {
  it("holds the worktree and never renders a negative age", () => {
    const held = classifyWorktree({
      facts: {
        branch: "future",
        deletionsOnly: false,
        freshSnapshot: false,
        diskKib: null,
        dirtyCount: 0,
        hiddenFromStatus: 0,
        headOnRemoteRef: null,
        headSha: null,
        ignoredWork: [],
        isMainCheckout: false,
        lastActivityMs: 4_000,
        liveRefs: [],
        locked: false,
        mergedIntoTrunk: true,
        missing: false,
        openPullRequests: [],
        path: "/repo/.claude/worktrees/future",
        runClosed: false,
        branchOnOwnRemote: false,
        stashes: 0,
        unbackedCommits: 0,
      },
      nowMs: 1_000,
      nukeAfterMs: 7 * DAY_MS,
      olderThanMs: 86_400_000,
    });
    expect(held.cls).toBe("hold");
    expect(held.reason).toBe("touched 0h ago");
  });
});
