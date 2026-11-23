/*
 * `classifyWorktree`'s safety rules, one test per rule that could delete work — plus the ORDER they fire in,
 * because the order is the contract a reader of the plan depends on.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree } from "../../../../worktree/pruneClassify.js";
import { classify, DAY_MS, facts, NOW_MS, OLDER_THAN_MS } from "./harness.js";

describe("classifyWorktree", () => {
  it("clears a merged, clean, unreferenced, cold worktree for tree AND branch removal", () => {
    const verdict = classify();
    expect(verdict.cls).toBe("merged");
    expect(verdict.deleteBranch).toBe(true);
    expect(verdict.reason).toBe("merged into the trunk, clean, unreferenced and cold");
  });

  it("holds the main checkout ahead of every other consideration", () => {
    const verdict = classify({ isMainCheckout: true });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("the repository's own main checkout");
  });

  it("holds a worktree a live reference points at, naming every reference", () => {
    const verdict = classify({ liveRefs: ["open session gmail-phase-a", "live workspace workspace:388"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("referenced by open session gmail-phase-a, live workspace workspace:388");
  });

  it("holds a worktree with uncommitted changes, and says how many", () => {
    const verdict = classify({ dirtyCount: 129 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("129 uncommitted change(s)");
  });

  it("calls an all-deletions tree whose work is in the trunk an interrupted removal, and finishes it", () => {
    const verdict = classify({ deletionsOnly: true, dirtyCount: 129 });
    expect(verdict.cls).toBe("interrupted");
    expect(verdict.deleteBranch).toBe(true);
    expect(verdict.reason).toBe(
      "129 deleted file(s) and nothing else — an interrupted removal of work that is in the trunk",
    );
  });

  it("holds an all-deletions tree whose work is NOT in the trunk — that is a deletion to investigate", () => {
    const verdict = classify({ deletionsOnly: true, dirtyCount: 5, mergedIntoTrunk: false, unbackedCommits: 0 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe(
      "5 deleted file(s), and its work is neither in the trunk nor on its own remote branch — investigate before removing",
    );
  });

  it("holds an all-deletions tree a live session references, however absorbed its branch is", () => {
    expect(classify({ deletionsOnly: true, dirtyCount: 5, liveRefs: ["open session x"] }).cls).toBe("hold");
  });

  it("holds an all-deletions tree that is still warm, rather than finishing it under the threshold", () => {
    const verdict = classify({ deletionsOnly: true, dirtyCount: 5, lastActivityMs: NOW_MS - 3_600_000 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 1h ago");
  });

  it("does not read a MIXED dirty tree as interrupted just because it also has deletions", () => {
    expect(classify({ deletionsOnly: false, dirtyCount: 5 }).reason).toBe("5 uncommitted change(s)");
  });

  it("holds a worktree whose working tree could not be read, rather than reading silence as clean", () => {
    const verdict = classify({ dirtyCount: null });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("its working tree could not be read");
  });

  it("HOLDS a clean, cold branch carrying commits no remote has", () => {
    const verdict = classify({ mergedIntoTrunk: false, unbackedCommits: 3 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("3 commit(s) on no remote");
  });

  it("names the earlier hold when an unpushed branch is also dirty or live", () => {
    expect(classify({ dirtyCount: 2, mergedIntoTrunk: false, unbackedCommits: 3 }).reason).toBe(
      "2 uncommitted change(s)",
    );
    expect(classify({ liveRefs: ["open session x"], mergedIntoTrunk: false, unbackedCommits: 3 }).reason).toBe(
      "referenced by open session x",
    );
    expect(classify({ lastActivityMs: NOW_MS - 3_600_000, mergedIntoTrunk: false, unbackedCommits: 3 }).cls).toBe(
      "hold",
    );
    expect(classify({ mergedIntoTrunk: null, unbackedCommits: 3 }).cls).toBe("hold");
  });

  it("holds when the remotes could not be consulted at all", () => {
    const verdict = classify({ mergedIntoTrunk: false, unbackedCommits: null });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("its commits could not be checked against the remotes");
  });

  it("holds a worktree touched more recently than the threshold, in hours", () => {
    const verdict = classify({ lastActivityMs: NOW_MS - 3 * 3_600_000, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 3h ago");
  });

  it("renders an age of two days or more in days, and under that in hours", () => {
    const cold = { branch: "landed-work", mergedIntoTrunk: false };
    const at = ({ ms }: { ms: number }) =>
      classifyWorktree({
        facts: facts({ ...cold, lastActivityMs: NOW_MS - ms }),
        nowMs: NOW_MS,
        nukeAfterMs: 400 * DAY_MS,
        olderThanMs: 30 * DAY_MS,
      }).reason;
    expect(at({ ms: 5 * DAY_MS })).toBe("touched 5d ago");
    expect(at({ ms: 47 * 3_600_000 })).toBe("touched 47h ago");
    expect(at({ ms: 48 * 3_600_000 })).toBe("touched 2d ago");
  });

  it("treats a worktree exactly at the threshold as cold, not as touched", () => {
    expect(classify({ lastActivityMs: NOW_MS - OLDER_THAN_MS, mergedIntoTrunk: false }).cls).toBe("pushed");
    expect(classify({ lastActivityMs: NOW_MS - OLDER_THAN_MS + 1, mergedIntoTrunk: false }).cls).toBe("hold");
  });

  it("holds a detached HEAD no remote carries, whether the ref is absent or git could not be asked", () => {
    const verdict = classify({ branch: null, mergedIntoTrunk: null, unbackedCommits: null });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("a detached HEAD on no remote, so nothing could recreate this tree");
    // The sha resolving while the containing ref does not is the same hold: the witness is the REF.
    const noRef = classify({ branch: null, headSha: "abc1234", mergedIntoTrunk: null, unbackedCommits: null });
    expect(noRef.cls).toBe("hold");
    expect(noRef.reason).toBe("a detached HEAD on no remote, so nothing could recreate this tree");
  });

  it("clears a detached HEAD a remote still carries, printing the command that recreates it", () => {
    const verdict = classify({
      branch: null,
      headOnRemoteRef: "origin/main",
      headSha: "9f1c2ab",
      mergedIntoTrunk: null,
      unbackedCommits: 0,
    });
    expect(verdict.cls).toBe("detached");
    expect(verdict.deleteBranch).toBe(false);
    expect(verdict.reason).toBe(
      "a detached HEAD carried by origin/main — recreate with `git worktree add --detach 9f1c2ab`",
    );
  });

  it("still holds a remote-carried detached HEAD that is dirty, live-referenced or warm", () => {
    const carried = { branch: null, headOnRemoteRef: "origin/main", headSha: "9f1c2ab", mergedIntoTrunk: null };
    expect(classify({ ...carried, dirtyCount: 4, unbackedCommits: 0 }).cls).toBe("hold");
    expect(classify({ ...carried, liveRefs: ["live workspace workspace:7"], unbackedCommits: 0 }).cls).toBe("hold");
    expect(classify({ ...carried, lastActivityMs: NOW_MS - 3_600_000, unbackedCommits: 0 }).cls).toBe("hold");
    expect(classify({ ...carried, lastActivityMs: null, unbackedCommits: 0 }).cls).toBe("hold");
  });

  it("lets a CLOSED board row make a warm worktree cold, and disarms NOTHING else", () => {
    const warm = { lastActivityMs: NOW_MS - 3_600_000 };
    expect(classify(warm).cls).toBe("hold");
    expect(classify({ ...warm, runClosed: true }).cls).toBe("merged");
    // Every other hold survives a closed row, because the row says the WORK is done, not that the tree is clean.
    expect(classify({ ...warm, dirtyCount: 7, runClosed: true }).reason).toBe("7 uncommitted change(s)");
    expect(classify({ ...warm, liveRefs: ["open session x"], runClosed: true }).reason).toBe(
      "referenced by open session x",
    );
    expect(classify({ ...warm, isMainCheckout: true, runClosed: true }).reason).toBe(
      "the repository's own main checkout",
    );
    expect(classify({ ...warm, mergedIntoTrunk: null, runClosed: true }).reason).toBe(
      "its merge state against the trunk could not be determined",
    );
  });

  it("an open pull request re-arms coldness on a closed run", () => {
    const verdict = classify({
      lastActivityMs: NOW_MS - 3_600_000,
      openPullRequests: ["open pull request o/r#9"],
      runClosed: true,
    });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 1h ago, with open pull request o/r#9 on its branch");
  });

  it("holds when the merge state is undecidable", () => {
    const verdict = classify({ mergedIntoTrunk: null });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("its merge state against the trunk could not be determined");
  });

  it("puts a clean, fully-pushed, unmerged worktree in the pushed class and keeps its branch", () => {
    const verdict = classify({ mergedIntoTrunk: false, unbackedCommits: 0 });
    expect(verdict.cls).toBe("pushed");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("calls a registration whose directory is gone a stale record, without asking about its tree", () => {
    const verdict = classify({ dirtyCount: null, lastActivityMs: null, missing: true, unbackedCommits: null });
    expect(verdict.cls).toBe("gone");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("still holds a stale record a live session references", () => {
    expect(classify({ liveRefs: ["open session x"], missing: true }).cls).toBe("hold");
  });

  it("reports a live reference ahead of uncommitted changes — the reference is what a human acts on", () => {
    expect(classify({ dirtyCount: 4, liveRefs: ["open session x"] }).reason).toBe("referenced by open session x");
  });
});
