/*
 * A kept tree drops its dependencies only when nobody is using it: `dropsDeps` and `depsDroppable` mark a cold
 * held tree, never one an apply removes, the main checkout, a missing, live, unstamped or warm one.
 */
import { describe, expect, it } from "vitest";

import { depsDroppable, type WorktreeFacts } from "../../../../worktree/pruneClassify.js";
import { classify, DAY_MS, facts, NOW_MS, OLDER_THAN_MS } from "./harness.js";

describe("a kept tree drops its dependencies only when nobody is using it", () => {
  const coldDirty = { dirtyCount: 3, lastActivityMs: NOW_MS - 2 * DAY_MS, mergedIntoTrunk: false };
  const droppable = (over: Partial<WorktreeFacts>): boolean =>
    depsDroppable({ facts: facts(over), nowMs: NOW_MS, olderThanMs: OLDER_THAN_MS });

  it("marks a cold held tree, dirt and all, because node_modules is not the work", () => {
    const verdict = classify(coldDirty);
    expect(verdict.cls).toBe("hold");
    expect(verdict.dropsDeps).toBe(true);
  });

  it("never marks a tree an apply removes anyway", () => {
    expect(classify().dropsDeps).toBe(false);
  });

  it("keeps the main checkout, a missing tree, a live one, an unreadable stamp and a warm one", () => {
    expect(droppable({ ...coldDirty, isMainCheckout: true })).toBe(false);
    expect(droppable({ ...coldDirty, missing: true })).toBe(false);
    expect(droppable({ ...coldDirty, liveRefs: ["open session x"] })).toBe(false);
    expect(droppable({ ...coldDirty, locked: true })).toBe(false);
    expect(droppable({ ...coldDirty, lastActivityMs: null })).toBe(false);
    expect(droppable({ ...coldDirty, lastActivityMs: NOW_MS - OLDER_THAN_MS + 1 })).toBe(false);
  });

  it("is not disarmed by a closed run or a pushed branch, and counts the exact threshold as cold", () => {
    expect(droppable({ ...coldDirty, lastActivityMs: NOW_MS - 3_600_000, runClosed: true })).toBe(false);
    expect(droppable({ ...coldDirty, branchOnOwnRemote: true, lastActivityMs: NOW_MS - 3_600_000 })).toBe(false);
    expect(droppable({ ...coldDirty, lastActivityMs: NOW_MS - OLDER_THAN_MS })).toBe(true);
  });

  it("drops deps from a cold tree whose branch has an open pull request", () => {
    const verdict = classify({ ...coldDirty, openPullRequests: ["open pull request o/r#9"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.dropsDeps).toBe(true);
  });

  it("keeps deps on a warm one", () => {
    const warm = { ...coldDirty, lastActivityMs: NOW_MS - 3_600_000, openPullRequests: ["open pull request o/r#9"] };
    expect(droppable(warm)).toBe(false);
  });
});
