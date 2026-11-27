/**
 * Work or context committed nowhere holds the tree: an untracked file, an ignored file no
 * build writes again, a stash made from the tree and a commit on no remote. Each hold, its fail-closed twin
 * when the read failed, and which of them the week-old waiver may reach.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree, type WorktreeFacts } from "../../../worktree/pruneClassify.js";

const NOW_MS = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const WEEK_OLD = NOW_MS - 10 * DAY_MS;

/** A clean, cold, pushed tree that would otherwise be removed, so each hold below is the only one. */
const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  branch: "feature",
  branchOnOwnRemote: true,
  deletionsOnly: false,
  freshSnapshot: false,
  diskKib: 500_000,
  dirtyCount: 0,
  headOnRemoteRef: null,
  headSha: null,
  hiddenFromStatus: 0,
  ignoredWork: [],
  isMainCheckout: false,
  lastActivityMs: NOW_MS - 3 * DAY_MS,
  liveRefs: [],
  locked: false,
  mergedIntoTrunk: false,
  missing: false,
  openPullRequests: [],
  path: "/repo/.claude/worktrees/feature",
  runClosed: false,
  stashes: 0,
  unbackedCommits: 0,
  ...over,
});

const classify = (over: Partial<WorktreeFacts> = {}) =>
  classifyWorktree({ facts: facts(over), nowMs: NOW_MS, nukeAfterMs: 7 * DAY_MS, olderThanMs: DAY_MS });

describe("work committed nowhere holds the tree", () => {
  it("removes the baseline tree, so every hold below comes from the one fact it changes", () => {
    expect(classify().cls).toBe("pushed");
  });

  it("holds an untracked file, which status reports as an uncommitted change", () => {
    expect(classify({ dirtyCount: 1 }).reason).toBe("1 uncommitted change(s)");
  });

  it("holds an ignored file no build writes again, naming one", () => {
    const verdict = classify({ ignoredWork: [".slopweaver/run.json", ".env.local"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("2 ignored file(s) no build writes again, such as .slopweaver/run.json");
  });

  it("holds a stash made from the tree", () => {
    const verdict = classify({ stashes: 2 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("2 stash(es) made from it");
  });

  it("holds a commit on no remote", () => {
    const verdict = classify({ branchOnOwnRemote: false, unbackedCommits: 3 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("3 commit(s) origin does not carry");
  });

  it("holds a merged tree with ignored work or a stash too, since the trunk carries neither", () => {
    expect(classify({ ignoredWork: ["notes.md"], mergedIntoTrunk: true }).cls).toBe("hold");
    expect(classify({ mergedIntoTrunk: true, stashes: 1 }).cls).toBe("hold");
  });

  it("holds a gutted tree with ignored work or a stash rather than finishing it", () => {
    const gutted = { deletionsOnly: true, dirtyCount: 40 };
    expect(classify(gutted).cls).toBe("interrupted");
    expect(classify({ ...gutted, ignoredWork: ["notes.md"] }).cls).toBe("hold");
    expect(classify({ ...gutted, stashes: 1 }).cls).toBe("hold");
  });
});

describe("a read that failed holds the tree", () => {
  it("holds when the ignored files could not be listed", () => {
    expect(classify({ ignoredWork: null }).reason).toBe("its ignored files could not be listed");
  });

  it("holds when the stashes could not be listed", () => {
    expect(classify({ stashes: null }).reason).toBe("its stashes could not be listed");
  });

  it("holds when the commits could not be checked against the remotes", () => {
    expect(classify({ unbackedCommits: null }).reason).toBe("its commits could not be checked against the remotes");
  });

  it("does not ask a registration whose directory is gone, which frees a record and deletes no file", () => {
    const gone = { ignoredWork: null, missing: true, stashes: null, unbackedCommits: 3 };
    expect(classify(gone).cls).toBe("gone");
  });
});

describe("the week-old waiver reaches only what the salvage can carry", () => {
  it("still holds ignored work and stashes past the week, because a salvage pushes neither", () => {
    expect(classify({ ignoredWork: [".slopweaver/x"], lastActivityMs: WEEK_OLD }).cls).toBe("hold");
    expect(classify({ lastActivityMs: WEEK_OLD, stashes: 1 }).cls).toBe("hold");
    expect(classify({ ignoredWork: null, lastActivityMs: WEEK_OLD }).cls).toBe("hold");
    expect(classify({ lastActivityMs: WEEK_OLD, stashes: null }).cls).toBe("hold");
  });

  it("salvages commits on no remote past the week, since the salvage pushes them and confirms them first", () => {
    const verdict = classify({ branchOnOwnRemote: false, lastActivityMs: WEEK_OLD, unbackedCommits: 3 });
    expect(verdict.cls).toBe("salvaged");
    expect(verdict.reason).toContain("3 commit(s) origin does not carry");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("salvages an untracked file past the week, since the salvage commits it with add -A", () => {
    expect(classify({ dirtyCount: 1, lastActivityMs: WEEK_OLD }).cls).toBe("salvaged");
  });
});
