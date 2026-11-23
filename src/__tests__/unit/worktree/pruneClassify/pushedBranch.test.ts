/*
 * A pushed branch is resumable from its branch: a clean tree on its own remote branch is removed while its run is
 * open once it is past the two-hour activity floor, an open pull request holds it until `--older-than`, and nothing
 * but the coldness rule is narrowed.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree } from "../../../../worktree/pruneClassify.js";
import { classify, facts, NOW_MS, NUKE_AFTER_MS, OLDER_THAN_MS } from "./harness.js";

const HOUR_MS = 3_600_000;

describe("a pushed branch is resumable from its branch, whatever its run's state", () => {
  const coolPushed = {
    branchOnOwnRemote: true,
    lastActivityMs: NOW_MS - 3 * HOUR_MS,
    mergedIntoTrunk: false,
    unbackedCommits: 0,
  };

  it("removes a clean tree on its own remote branch past the floor while its run is still open, keeping the branch", () => {
    const verdict = classify(coolPushed);
    expect(verdict.cls).toBe("pushed");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("holds a clean tree on its own remote branch while it has an open pull request", () => {
    const verdict = classify({ ...coolPushed, openPullRequests: ["open pull request o/r#9"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 3h ago, with open pull request o/r#9 on its branch");
  });

  it("removes that tree once it is colder than --older-than despite the open pull request", () => {
    const verdict = classify({
      ...coolPushed,
      lastActivityMs: NOW_MS - OLDER_THAN_MS,
      openPullRequests: ["open pull request o/r#9"],
    });
    expect(verdict.cls).toBe("pushed");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("keeps the whole --older-than when the branch has no remote branch of its own, or git could not say", () => {
    expect(classify({ ...coolPushed, branchOnOwnRemote: false }).reason).toBe("touched 3h ago");
    expect(classify({ ...coolPushed, branchOnOwnRemote: null }).reason).toBe("touched 3h ago");
  });

  it("narrows the coldness rule and touches nothing else", () => {
    expect(classify({ ...coolPushed, liveRefs: ["live workspace workspace:9"] }).reason).toBe(
      "referenced by live workspace workspace:9",
    );
    expect(classify({ ...coolPushed, dirtyCount: 2 }).reason).toBe("2 uncommitted change(s)");
    expect(classify({ ...coolPushed, hiddenFromStatus: 1 }).reason).toBe(
      "1 file(s) hidden from status by --assume-unchanged or --skip-worktree carry edits status does not report",
    );
    expect(classify({ ...coolPushed, mergedIntoTrunk: null }).reason).toBe(
      "its merge state against the trunk could not be determined",
    );
  });
});

describe("a freshly pushed tree with no open pull request is not cold", () => {
  // MEASURED: auto-prune.log on this machine removed a clean, fully pushed, unmerged tree with no open pull request
  // 12 minutes after its newest commit, while a seat whose cwd was another worktree was still working in it.
  const justPushed = {
    branchOnOwnRemote: true,
    lastActivityMs: NOW_MS - 12 * 60_000,
    mergedIntoTrunk: false,
    unbackedCommits: 0,
  };

  it("holds the measured tree, touched 12 minutes ago, while its run is open", () => {
    const verdict = classify(justPushed);
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 0h ago");
  });

  it("holds it one millisecond short of two hours", () => {
    const verdict = classify({ ...justPushed, lastActivityMs: NOW_MS - 2 * HOUR_MS + 1 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 1h ago");
  });

  it("removes it at exactly two hours, keeping the branch", () => {
    const verdict = classify({ ...justPushed, lastActivityMs: NOW_MS - 2 * HOUR_MS });
    expect(verdict.cls).toBe("pushed");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("keeps a caller's narrower --older-than narrower", () => {
    const verdict = classifyWorktree({
      facts: facts({ ...justPushed, lastActivityMs: NOW_MS - 45 * 60_000 }),
      nowMs: NOW_MS,
      nukeAfterMs: NUKE_AFTER_MS,
      olderThanMs: 30 * 60_000,
    });
    expect(verdict.cls).toBe("pushed");
  });

  it("still removes it at once when its board row is CLOSED", () => {
    expect(classify({ ...justPushed, runClosed: true }).cls).toBe("pushed");
  });

  it("carries the floor on the verdict so the apply judges the tree again, and none for a CLOSED row", () => {
    const pastFloor = { ...justPushed, lastActivityMs: NOW_MS - 3 * HOUR_MS };
    expect(classify(pastFloor).activityFloorMs).toBe(2 * HOUR_MS);
    expect(classify({ ...pastFloor, runClosed: true }).activityFloorMs).toBe(undefined);
  });
});
