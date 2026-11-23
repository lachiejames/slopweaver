/**
 * The reconcile's pure classifier: what a park on a pull request that merged or closed comes to.
 */
import { describe, expect, it } from "vitest";

import { classifyParkedLanding, landedCloseSummary } from "../../../handover/parkedLanding.js";

/** A park on the run's own branch, with nothing left on it, whose pull request merged. */
const OWN_MERGED = {
  branchUnread: undefined,
  draftCount: 0,
  head: { headRefName: "acme-fix", kind: "read" },
  ownBranches: ["acme-fix"],
  prState: "MERGED",
  question: undefined,
} as const;

describe("classifyParkedLanding", () => {
  it("reads a merge of the run's own branch with no question and no drafts as landed", () => {
    expect(classifyParkedLanding(OWN_MERGED)).toEqual({ headRefName: "acme-fix", kind: "landed" });
  });

  it("reads a close of the run's own branch as closed-unmerged", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, prState: "CLOSED" })).toEqual({
      headRefName: "acme-fix",
      kind: "closed-unmerged",
    });
  });

  it("reads an open question as a hidden step whichever branch merged", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, question: "  start the next slice from main?  " })).toEqual({
      cause: "question",
      detail: 'the park asked "start the next slice from main?"',
      kind: "hiding-step",
    });
  });

  it("reads a blank question as no question", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, question: "   " }).kind).toBe("landed");
  });

  it("reads drafts left unsent as a hidden step", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, draftCount: 2 })).toEqual({
      cause: "drafts",
      detail: "the park left 2 draft(s) unsent",
      kind: "hiding-step",
    });
  });

  it("reads a merge of somebody else's branch, every own branch read, as a hidden step", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, head: { headRefName: "stack-parent", kind: "read" } })).toEqual({
      cause: "other-branch",
      detail:
        "its head stack-parent is none of this run's branches (acme-fix), so the merge unblocked this run's own work",
      kind: "hiding-step",
    });
  });

  it("claims nothing for a foreign head while one own branch is unknown", () => {
    expect(
      classifyParkedLanding({
        ...OWN_MERGED,
        branchUnread: "its worktree /wt/a is gone",
        head: { headRefName: "stack-parent", kind: "read" },
      }),
    ).toEqual({
      kind: "unknown",
      reason: "its head stack-parent is none of this run's branches (acme-fix), but its worktree /wt/a is gone",
    });
  });

  it("still reads a head matching a stated branch as landed while the worktree's branch is unknown", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, branchUnread: "its worktree /wt/a is gone" }).kind).toBe("landed");
  });

  it("claims nothing when the head did not read", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, head: { kind: "unread", reason: "rate limited" } })).toEqual({
      kind: "unknown",
      reason: "the pull request's head did not read: rate limited",
    });
  });

  it("says a run naming no branch names none", () => {
    expect(classifyParkedLanding({ ...OWN_MERGED, head: { headRefName: "x", kind: "read" }, ownBranches: [] })).toEqual(
      {
        cause: "other-branch",
        detail: "its head x is none of this run's branches (it names none), so the merge unblocked this run's own work",
        kind: "hiding-step",
      },
    );
  });
});

describe("landedCloseSummary", () => {
  it("names the pull request, its branch and the commit it merged at", () => {
    expect(
      landedCloseSummary({ headRefName: "acme-fix", mergeCommitOid: "abc123", number: 7, repo: "acme/widgets" }),
    ).toBe("acme/widgets#7 (acme-fix) merged at abc123; settled by handover wake's reconcile");
  });
});
