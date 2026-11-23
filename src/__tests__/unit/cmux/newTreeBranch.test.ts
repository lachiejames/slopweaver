/**
 * Which branch `cmux spawn` creates a new worktree on — every input built inline.
 */
import { describe, expect, it } from "vitest";

import { newTreeBranch } from "../../../cmux/newTreeBranch.js";
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";

const PARKED: ParkedEvent = {
  atIso: "2026-10-09T12:00:00.000Z",
  branch: "the-recorded-branch",
  kind: "parked",
  screenTail: "❯ ",
  sessionId: "session-parked",
  workspaceRef: "workspace:7",
  worktree: "/wt/a-doc",
};

/** A worktree holding the branch named. */
function tree({ branch }: { branch: string }): WorktreeInfo {
  return { branch, path: `/wt/${branch}` };
}

describe("newTreeBranch", () => {
  it("rebuilds a parked run on the branch its checkpoint recorded, ahead of the doc's declaration", () => {
    expect(newTreeBranch({ declaredBranch: "declared", parked: PARKED, slug: "a-doc", worktrees: [] })).toBe(
      "the-recorded-branch",
    );
  });

  it("skips a recorded branch another tree still holds, falling to the declaration", () => {
    const held = [tree({ branch: "the-recorded-branch" })];
    expect(newTreeBranch({ declaredBranch: "declared", parked: PARKED, slug: "a-doc", worktrees: held })).toBe(
      "declared",
    );
  });

  it("skips a recorded branch a detached tree's bisect still holds beside a rebase, falling to the declaration", () => {
    const held: WorktreeInfo[] = [
      { branch: null, heldBranches: ["other", "the-recorded-branch"], path: "/wt/mid-rebase" },
    ];
    expect(newTreeBranch({ declaredBranch: "declared", parked: PARKED, slug: "a-doc", worktrees: held })).toBe(
      "declared",
    );
  });

  it("uses the slug when nothing was recorded or declared", () => {
    expect(newTreeBranch({ declaredBranch: undefined, parked: undefined, slug: "a-doc", worktrees: [] })).toBe("a-doc");
  });
});
