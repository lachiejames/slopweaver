/** What a seat close decides about the worktree it leaves behind: remove it, or keep it and say why. */
import { describe, expect, it } from "vitest";

import {
  decideSeatPrune,
  renderSeatPrune,
  repoOwningWorktree,
  type SeatPruneDecision,
} from "../../../sessions/closeDonePrune.js";
import type { PruneVerdict, WorktreeFacts } from "../../../worktree/pruneClassify.js";

/**
 * The removal arm, or a throw. A throwing unwrap rather than a ternary in the assertion, on
 * `.claude/rules/testing.md`'s rule: a `decision.kind === "remove" ? … : ""` passes for any input.
 */
function removal({ decision }: { decision: SeatPruneDecision }): PruneVerdict {
  if (decision.kind !== "remove") {
    throw new Error(`expected a removal, got a keep: ${decision.reason}`);
  }
  return decision.verdict;
}

/** The keep arm's decisive reason, or a throw. */
function keepReason({ decision }: { decision: SeatPruneDecision }): string {
  if (decision.kind !== "keep") {
    throw new Error(`expected a keep, got a removal of ${decision.verdict.path}`);
  }
  return decision.reason;
}

const NOW_MS = Date.parse("2026-09-19T04:00:00.000Z");

/**
 * One just-closed seat's worktree: clean, cold, absorbed into the trunk, and zero seconds old — which is the
 * whole point, since the age hold is the one rule this path waives.
 */
const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  branch: "seat-branch",
  deletionsOnly: false,
  freshSnapshot: false,
  dirtyCount: 0,
  hiddenFromStatus: 0,
  diskKib: 120_000,
  headOnRemoteRef: null,
  headSha: null,
  ignoredWork: [],
  isMainCheckout: false,
  lastActivityMs: NOW_MS,
  liveRefs: [],
  locked: false,
  mergedIntoTrunk: true,
  missing: false,
  openPullRequests: [],
  path: "/repo/.claude/worktrees.noindex/seat",
  runClosed: false,
  branchOnOwnRemote: false,
  stashes: 0,
  unbackedCommits: 0,
  ...over,
});

describe("decideSeatPrune", () => {
  it("removes a merged worktree whose seat closed seconds ago — the age hold is waived", () => {
    const decision = decideSeatPrune({ facts: facts(), nowMs: NOW_MS });
    expect(decision.kind).toBe("remove");
    expect(removal({ decision }).cls).toBe("merged");
  });

  it("deletes the branch with a merged tree, which is what makes the tree recreatable", () => {
    const decision = decideSeatPrune({ facts: facts(), nowMs: NOW_MS });
    expect(removal({ decision }).deleteBranch).toBe(true);
  });

  it("removes a PUSHED but unmerged worktree — its commits are on the remote", () => {
    const decision = decideSeatPrune({ facts: facts({ mergedIntoTrunk: false }), nowMs: NOW_MS });
    expect(decision.kind).toBe("remove");
    expect(removal({ decision }).cls).toBe("pushed");
  });

  it("KEEPS a tree carrying commits on no remote, because they are committed nowhere else", () => {
    const decision = decideSeatPrune({
      facts: facts({ mergedIntoTrunk: false, unbackedCommits: 3 }),
      nowMs: NOW_MS,
    });
    expect(keepReason({ decision })).toBe("3 commit(s) on no remote");
  });

  it("KEEPS a tree holding an ignored file no build writes again, or a stash made from it", () => {
    expect(keepReason({ decision: decideSeatPrune({ facts: facts({ stashes: 1 }), nowMs: NOW_MS }) })).toBe(
      "1 stash(es) made from it",
    );
    expect(
      keepReason({ decision: decideSeatPrune({ facts: facts({ ignoredWork: [".slopweaver/x"] }), nowMs: NOW_MS }) }),
    ).toBe("1 ignored file(s) no build writes again, such as .slopweaver/x");
  });

  it("removes a detached HEAD a remote still carries, and prints the command that recreates it", () => {
    const decision = decideSeatPrune({
      facts: facts({
        branch: null,
        headOnRemoteRef: "origin/seat-branch",
        headSha: "a1b2c3d4e5f6",
        mergedIntoTrunk: null,
        unbackedCommits: 0,
      }),
      nowMs: NOW_MS,
    });
    expect(decision.kind).toBe("remove");
    expect(removal({ decision }).cls).toBe("detached");
    expect(removal({ decision }).reason).toContain("git worktree add --detach a1b2c3d4e5f6");
  });

  it("deletes no branch for a detached tree, because there is none to delete", () => {
    const decision = decideSeatPrune({
      facts: facts({
        branch: null,
        headOnRemoteRef: "origin/seat-branch",
        headSha: "a1b2c3d4e5f6",
        mergedIntoTrunk: null,
        unbackedCommits: 0,
      }),
      nowMs: NOW_MS,
    });
    expect(removal({ decision }).deleteBranch).toBe(false);
  });

  it("HOLDS when the unbacked-commit count could not be determined at all", () => {
    const decision = decideSeatPrune({
      facts: facts({ mergedIntoTrunk: false, unbackedCommits: null }),
      nowMs: NOW_MS,
    });
    expect(decision.kind).toBe("keep");
  });

  it("HOLDS a tree another live session still points at", () => {
    const decision = decideSeatPrune({
      facts: facts({ liveRefs: ["cmux workspace ws-9"] }),
      nowMs: NOW_MS,
    });
    expect(decision.kind).toBe("keep");
    expect(keepReason({ decision })).toContain("ws-9");
  });

  it("HOLDS a dirty tree", () => {
    const decision = decideSeatPrune({ facts: facts({ dirtyCount: 4 }), nowMs: NOW_MS });
    expect(decision.kind).toBe("keep");
  });

  it("HOLDS a tree whose working state could not be read", () => {
    const decision = decideSeatPrune({ facts: facts({ dirtyCount: null }), nowMs: NOW_MS });
    expect(decision.kind).toBe("keep");
  });

  it("HOLDS a detached HEAD no remote carries — the boundary the removable one sits against", () => {
    const decision = decideSeatPrune({ facts: facts({ branch: null, headOnRemoteRef: null }), nowMs: NOW_MS });
    expect(decision.kind).toBe("keep");
    expect(keepReason({ decision })).toContain("a detached HEAD on no remote");
  });

  it("NEVER touches the repository's own main checkout", () => {
    const decision = decideSeatPrune({ facts: facts({ isMainCheckout: true }), nowMs: NOW_MS });
    expect(decision.kind).toBe("keep");
  });

  it("leaves a GONE registration to the daily row, and says so", () => {
    const decision = decideSeatPrune({ facts: facts({ missing: true }), nowMs: NOW_MS });
    expect(decision.kind).toBe("keep");
    expect(keepReason({ decision })).toContain("left to the daily");
  });

  it("leaves an INTERRUPTED removal to the daily row rather than forcing it here", () => {
    const decision = decideSeatPrune({
      facts: facts({ deletionsOnly: true, dirtyCount: 12 }),
      nowMs: NOW_MS,
    });
    expect(decision.kind).toBe("keep");
    expect(keepReason({ decision })).toContain("left to the daily");
  });
});

describe("repoOwningWorktree", () => {
  it("answers the declared checkout whose worktree home holds the path", () => {
    const owner = repoOwningWorktree({
      mainCheckouts: ["/dev/acme-admin", "/dev/slopweaver"],
      path: "/dev/slopweaver/.claude/worktrees.noindex/seat-1",
    });
    expect(owner).toBe("/dev/slopweaver");
  });

  it("answers undefined for a path under no declared checkout, which is what bounds the sweep", () => {
    const owner = repoOwningWorktree({
      mainCheckouts: ["/dev/slopweaver"],
      path: "/tmp/somebody-elses-checkout",
    });
    expect(owner).toBeUndefined();
  });

  it("answers undefined when nothing is declared at all", () => {
    expect(repoOwningWorktree({ mainCheckouts: [], path: "/dev/slopweaver/x" })).toBeUndefined();
  });

  it("answers undefined for the main checkout itself, which is not one of its own worktrees", () => {
    expect(repoOwningWorktree({ mainCheckouts: ["/dev/slopweaver"], path: "/dev/slopweaver" })).toBeUndefined();
  });
});

describe("renderSeatPrune", () => {
  it("says RECLAIMED with the reason when a tree went", () => {
    const line = renderSeatPrune({
      dryRun: false,
      outcome: { name: "seat-1", path: "/repo/wt/seat", reason: "absorbed into the trunk", removed: true },
    });
    expect(line).toBe("reclaimed /repo/wt/seat — absorbed into the trunk");
  });

  it("says WOULD reclaim on a dry run, so a report can never be read as an act", () => {
    const line = renderSeatPrune({
      dryRun: true,
      outcome: { name: "seat-1", path: "/repo/wt/seat", reason: "absorbed into the trunk", removed: true },
    });
    expect(line).toBe("would reclaim /repo/wt/seat — absorbed into the trunk");
  });

  it("says KEPT with the decisive reason, on a dry run too", () => {
    const line = renderSeatPrune({
      dryRun: true,
      outcome: { name: "seat-1", path: "/repo/wt/seat", reason: "3 commits are on no remote", removed: false },
    });
    expect(line).toBe("kept /repo/wt/seat — 3 commits are on no remote");
  });
});
