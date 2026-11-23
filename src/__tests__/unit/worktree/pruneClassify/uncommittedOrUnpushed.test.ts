/*
 * A tree is held only for uncommitted or unpushed work: a cold gutted tree whose own remote branch carries it whole
 * is finished with its branch kept, and held whenever that remote, a hidden edit, warmth or a non-deletion says
 * the work could still be lost.
 */
import { describe, expect, it } from "vitest";

import type { WorktreeFacts } from "../../../../worktree/pruneClassify.js";
import { classify, DAY_MS, NOW_MS } from "./harness.js";

describe("a tree is held only for uncommitted or unpushed work", () => {
  /** anthropic-usage-limit-monitor's shape: every change a deleted checkout file, its commit landed revised. */
  const gutted: Partial<WorktreeFacts> = {
    branchOnOwnRemote: true,
    deletionsOnly: true,
    dirtyCount: 130,
    lastActivityMs: NOW_MS - 3 * DAY_MS,
    mergedIntoTrunk: false,
    unbackedCommits: 0,
  };

  it("finishes a cold gutted tree whose branch its own remote carries whole, and KEEPS the branch", () => {
    const verdict = classify(gutted);
    expect(verdict.cls).toBe("interrupted");
    expect(verdict.deleteBranch).toBe(false);
    expect(verdict.reason).toBe(
      "130 deleted file(s) and nothing else, on a branch its own remote carries whole — finished, and the branch KEPT",
    );
  });

  it("still deletes the branch of a gutted tree the trunk absorbed, whether or not it is also pushed", () => {
    const verdict = classify({ ...gutted, mergedIntoTrunk: true });
    expect(verdict.cls).toBe("interrupted");
    expect(verdict.deleteBranch).toBe(true);
  });

  it("finishes it past the week too, rather than salvaging a branch whose only content is deletions", () => {
    const verdict = classify({ ...gutted, lastActivityMs: NOW_MS - 10 * DAY_MS });
    expect(verdict.cls).toBe("interrupted");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("holds it when its own remote branch is absent, unreadable, or behind the local branch", () => {
    const investigate =
      "130 deleted file(s), and its work is neither in the trunk nor on its own remote branch — investigate before removing";
    expect(classify({ ...gutted, branchOnOwnRemote: false }).reason).toBe(investigate);
    expect(classify({ ...gutted, branchOnOwnRemote: null }).reason).toBe(investigate);
    expect(classify({ ...gutted, unbackedCommits: 2 }).reason).toBe(investigate);
  });

  it("holds it when a file hidden from status carries an edit HEAD does not hold", () => {
    const verdict = classify({ ...gutted, hiddenFromStatus: 1 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe(
      "1 file(s) hidden from status by --assume-unchanged or --skip-worktree carry edits status does not report",
    );
  });

  it("holds it while it is warm, since a gutted tree's clock is its last commit", () => {
    expect(classify({ ...gutted, lastActivityMs: NOW_MS - 3_600_000 }).reason).toBe("touched 1h ago");
  });

  it("holds a pushed tree carrying any change that is not a deletion — that is uncommitted work", () => {
    const verdict = classify({ ...gutted, deletionsOnly: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("130 uncommitted change(s)");
  });

  it("removes a clean pushed tree untouched for days and keeps its branch", () => {
    const verdict = classify({ branchOnOwnRemote: true, lastActivityMs: NOW_MS - 3 * DAY_MS, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("pushed");
    expect(verdict.deleteBranch).toBe(false);
  });
});
