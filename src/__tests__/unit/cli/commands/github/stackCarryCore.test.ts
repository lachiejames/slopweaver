import { describe, expect, it } from "vitest";

import {
  githubStackCarryPlan,
  parseOrphanAbove,
  stackCarryAcknowledgementRefusal,
  stackCarryRefusalLines,
  stackCarryReportLines,
} from "../../../../../cli/commands/github/stackCarryCore.js";
import type { GithubStackSyncEntryFact } from "../../../../../cli/commands/github/stackSyncCore.js";

function entry(over: Partial<GithubStackSyncEntryFact> & { position: number }): GithubStackSyncEntryFact {
  return {
    baseBranch: `entry-${String(over.position - 1)}`,
    baseIsAncestorOfHead: true,
    branch: `entry-${String(over.position)}`,
    commits: 1,
    headSha: `sha-${String(over.position)}`,
    merged: false,
    pullRequestNumber: 100 + over.position,
    registered: true,
    stackNumber: 5,
    worktreeHeadSha: `sha-${String(over.position)}`,
    worktreePath: `/wt-${String(over.position)}`,
    ...over,
  };
}

describe("githubStackCarryPlan", () => {
  it("carries nothing when nothing is stacked above", () => {
    expect(githubStackCarryPlan({ entriesAbove: [] })).toEqual({ orphans: [], skipped: [], steps: [] });
  });

  it("carries every entry above unconditionally, even one whose base git still calls an ancestor", () => {
    const plan = githubStackCarryPlan({
      entriesAbove: [
        entry({ baseIsAncestorOfHead: true, position: 2 }),
        entry({ baseIsAncestorOfHead: true, position: 3 }),
      ],
    });
    expect(plan.orphans).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.steps).toEqual([
      {
        baseBranch: "entry-1",
        branch: "entry-2",
        headSha: "sha-2",
        position: 2,
        pullRequestNumber: 102,
        reason: "propagated",
        stackNumber: 5,
        worktreePath: "/wt-2",
      },
      {
        baseBranch: "entry-2",
        branch: "entry-3",
        headSha: "sha-3",
        position: 3,
        pullRequestNumber: 103,
        reason: "propagated",
        stackNumber: 5,
        worktreePath: "/wt-3",
      },
    ]);
  });

  it("skips a merged entry above without orphaning it", () => {
    const plan = githubStackCarryPlan({ entriesAbove: [entry({ merged: true, position: 2 })] });
    expect(plan.steps).toEqual([]);
    expect(plan.orphans).toEqual([]);
    expect(plan.skipped).toEqual(["stack #5 position 2 (PR #102) is merged"]);
  });

  it("orphans a multi-commit entry by name, quoting what GitHub reported", () => {
    const plan = githubStackCarryPlan({ entriesAbove: [entry({ commits: 2, position: 2 })] });
    expect(plan.steps).toEqual([]);
    expect(plan.orphans).toEqual([
      {
        branch: "entry-2",
        pullRequestNumber: 102,
        why:
          "stack #5 position 2 (PR #102) has 2 commit(s) — sync only rebases a PR that is exactly one commit; " +
          "refusing to plan the rest of this stack above it",
      },
    ]);
  });

  it("orphans an entry with no resolvable worktree", () => {
    const plan = githubStackCarryPlan({ entriesAbove: [entry({ position: 2, worktreePath: undefined })] });
    expect(plan.orphans[0]!.why).toBe(
      "stack #5 position 2 (PR #102) has no resolvable worktree — refusing to plan the rest of this stack above it",
    );
  });

  it("orphans an entry local stack state never registered", () => {
    const plan = githubStackCarryPlan({ entriesAbove: [entry({ position: 2, registered: false })] });
    expect(plan.orphans[0]!.why).toBe(
      "stack #5 position 2 (PR #102) is not registered in local stack state — refusing to plan the rest of this stack above it",
    );
  });

  it("orphans an entry whose worktree HEAD is not the commit GitHub reports, at PLAN time", () => {
    const plan = githubStackCarryPlan({
      entriesAbove: [entry({ position: 2, worktreeHeadSha: "stale-sha" })],
    });
    expect(plan.steps).toEqual([]);
    expect(plan.orphans[0]!.why).toBe(
      "stack #5 position 2 (PR #102)'s worktree is at stale-sha, but GitHub reports its head is sha-2 — " +
        "fetch and check out that exact commit; refusing to plan the rest of this stack above it",
    );
  });

  it("names an unreadable worktree HEAD rather than reporting it as a match", () => {
    const plan = githubStackCarryPlan({
      entriesAbove: [entry({ position: 2, worktreeHeadSha: undefined })],
    });
    expect(plan.orphans[0]!.why).toBe(
      "stack #5 position 2 (PR #102)'s worktree is at an unreadable HEAD, but GitHub reports its head is sha-2 — " +
        "fetch and check out that exact commit; refusing to plan the rest of this stack above it",
    );
  });

  it("carries the prefix below a blocked entry and orphans everything from it upward", () => {
    const plan = githubStackCarryPlan({
      entriesAbove: [entry({ position: 2 }), entry({ commits: 3, position: 3 }), entry({ position: 4 })],
    });
    expect(plan.steps.map((step) => step.pullRequestNumber)).toEqual([102]);
    expect(plan.orphans.map((orphan) => orphan.pullRequestNumber)).toEqual([103, 104]);
    expect(plan.orphans[1]!.why).toBe(
      "stack #5 position 4 (PR #104) sits above an entry this push cannot carry, so its own base will not move either",
    );
  });

  it("keeps orphaning above a blocked entry even when the higher one is itself carryable", () => {
    const plan = githubStackCarryPlan({
      entriesAbove: [entry({ position: 2, worktreePath: undefined }), entry({ commits: 1, position: 3 })],
    });
    expect(plan.steps).toEqual([]);
    expect(plan.orphans.map((orphan) => orphan.pullRequestNumber)).toEqual([102, 103]);
  });
});

describe("stackCarryAcknowledgementRefusal", () => {
  const orphans = [
    { branch: "a", pullRequestNumber: 11, why: "why-a" },
    { branch: "b", pullRequestNumber: 12, why: "why-b" },
  ];

  it("accepts an acknowledgement naming exactly the orphans", () => {
    expect(stackCarryAcknowledgementRefusal({ accepted: [12, 11], orphans })).toBeUndefined();
  });

  it("refuses an acknowledgement that misses one", () => {
    expect(stackCarryAcknowledgementRefusal({ accepted: [11], orphans })).toEqual([
      "--orphan-above does not name #12",
      "pass --orphan-above 11,12 to accept exactly this",
    ]);
  });

  it("refuses an acknowledgement naming a pull request this push would not orphan", () => {
    expect(stackCarryAcknowledgementRefusal({ accepted: [11, 12, 99], orphans })).toEqual([
      "--orphan-above names #99, which this push would not orphan",
      "pass --orphan-above 11,12 to accept exactly this",
    ]);
  });

  it("refuses the flag entirely when there is nothing to orphan", () => {
    expect(stackCarryAcknowledgementRefusal({ accepted: [11], orphans: [] })).toEqual([
      "--orphan-above names #11, which this push would not orphan",
      "this push orphans nothing, so --orphan-above has nothing to acknowledge",
    ]);
  });

  it("accepts an absent acknowledgement when there is nothing to orphan", () => {
    expect(stackCarryAcknowledgementRefusal({ accepted: [], orphans: [] })).toBeUndefined();
  });
});

describe("stackCarryRefusalLines", () => {
  it("names every entry it would orphan, with why, and the exact flag to accept it", () => {
    expect(
      stackCarryRefusalLines({
        branch: "bottom",
        orphans: [
          { branch: "mid", pullRequestNumber: 41, why: "has 2 commit(s)" },
          { branch: "top", pullRequestNumber: 42, why: "sits above an entry this push cannot carry" },
        ],
      }),
    ).toEqual([
      "refused: pushing bottom would orphan 2 pull request(s) stacked above it, and this push cannot carry them:",
      "  #41 (mid) — has 2 commit(s)",
      "  #42 (top) — sits above an entry this push cannot carry",
      "fix what each one reports, or accept the orphaning deliberately with --orphan-above 41,42",
    ]);
  });
});

describe("stackCarryReportLines", () => {
  it("prints one line per carried entry and one per skipped one", () => {
    expect(
      stackCarryReportLines({
        plan: githubStackCarryPlan({
          entriesAbove: [entry({ position: 2 }), entry({ merged: true, position: 3 })],
        }),
      }),
    ).toEqual([
      "carry: would rebase entry-2 (PR #102, stack #5 position 2) onto entry-1 and push it",
      "carry: skipping stack #5 position 3 (PR #103) is merged",
    ]);
  });

  it("prints nothing for an empty plan", () => {
    expect(stackCarryReportLines({ plan: githubStackCarryPlan({ entriesAbove: [] }) })).toEqual([]);
  });
});

describe("parseOrphanAbove", () => {
  it("reads nothing when the flag was not passed", () => {
    const errors: string[] = [];
    expect(parseOrphanAbove({ errors, raw: undefined })).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reads a comma list, tolerating spaces", () => {
    const errors: string[] = [];
    expect(parseOrphanAbove({ errors, raw: "11, 12 ,13" })).toEqual([11, 12, 13]);
    expect(errors).toEqual([]);
  });

  it("refuses a value that is not a pull-request number", () => {
    const errors: string[] = [];
    expect(parseOrphanAbove({ errors, raw: "11,abc" })).toEqual([11]);
    expect(errors).toEqual(['--orphan-above takes pull-request numbers; "abc" is not one']);
  });

  it("refuses zero and a negative number", () => {
    const errors: string[] = [];
    expect(parseOrphanAbove({ errors, raw: "0,-3" })).toEqual([]);
    expect(errors).toEqual([
      '--orphan-above takes pull-request numbers; "0" is not one',
      '--orphan-above takes pull-request numbers; "-3" is not one',
    ]);
  });

  it("refuses an empty list", () => {
    const errors: string[] = [];
    expect(parseOrphanAbove({ errors, raw: " , " })).toEqual([]);
    expect(errors).toEqual(["--orphan-above must name at least one pull-request number"]);
  });
});
