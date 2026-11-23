/**
 * The three removal witnesses, each read against the facts it must refuse: every clause an exact reading,
 * and a `null` fact never let through as though it were the answer.
 */
import { describe, expect, it } from "vitest";

import type { WorktreeFacts } from "../../../worktree/pruneClassify.js";
import { headOnOwnRemote, recreatableDetached, resumableFromItsBranch } from "../../../worktree/pruneWitness.js";

/** A clean tree on a branch its own remote branch carries whole. */
const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  branch: "parked",
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
  lastActivityMs: 0,
  liveRefs: [],
  locked: false,
  mergedIntoTrunk: false,
  missing: false,
  openPullRequests: [],
  path: "/repo/.claude/worktrees/parked",
  runClosed: false,
  stashes: 0,
  unbackedCommits: 0,
  ...over,
});

describe("headOnOwnRemote", () => {
  it("holds for a gutted tree whatever its dirt, once the remote branch carries every commit", () => {
    expect(headOnOwnRemote({ facts: facts({ deletionsOnly: true, dirtyCount: 130 }) })).toBe(true);
  });

  it("refuses an unread remote, an unbacked commit, a hidden edit or a detached HEAD", () => {
    expect(headOnOwnRemote({ facts: facts({ branchOnOwnRemote: null }) })).toBe(false);
    expect(headOnOwnRemote({ facts: facts({ unbackedCommits: 1 }) })).toBe(false);
    expect(headOnOwnRemote({ facts: facts({ hiddenFromStatus: null }) })).toBe(false);
    expect(headOnOwnRemote({ facts: facts({ branch: null }) })).toBe(false);
  });
});

describe("resumableFromItsBranch", () => {
  it("holds only for a CLEAN tree, where headOnOwnRemote also takes a dirty one", () => {
    expect(resumableFromItsBranch({ facts: facts() })).toBe(true);
    expect(resumableFromItsBranch({ facts: facts({ dirtyCount: 1 }) })).toBe(false);
    expect(resumableFromItsBranch({ facts: facts({ dirtyCount: null }) })).toBe(false);
  });
});

describe("recreatableDetached", () => {
  it("holds for a present detached HEAD a remote ref names, and for nothing short of that", () => {
    const detached = { branch: null, headOnRemoteRef: "origin/feature", headSha: "abc" };

    expect(recreatableDetached({ facts: facts(detached) })).toBe(true);
    expect(recreatableDetached({ facts: facts({ ...detached, headOnRemoteRef: null }) })).toBe(false);
    expect(recreatableDetached({ facts: facts({ ...detached, missing: true }) })).toBe(false);
    expect(recreatableDetached({ facts: facts({ ...detached, branch: "feature" }) })).toBe(false);
  });
});
