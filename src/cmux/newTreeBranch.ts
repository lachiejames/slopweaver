/**
 * The branch `cmux spawn` creates a NEW worktree on — pure, so a resumed parked run lands back on its own branch.
 */
import { type ParkedEvent, parkedBranchOf } from "../handover/parkedEvent.js";
import { ownedBranches, type WorktreeInfo } from "./worktreeList.js";

/**
 * The branch a NEW tree is created on. A parked tree the hourly prune removed is rebuilt from the branch its
 * checkpoint RECORDED, ahead of the doc's declaration and the slug — a fact outranks a guess;
 * otherwise the doc's declaration, otherwise the slug. A recorded branch some tree still holds
 * is skipped: that tree was deliberately not reopened (the main checkout), and git checks a branch out once.
 *
 * @param declaredBranch the branch the handover doc declares, if any
 * @param parked the run's latest parked checkpoint, if it ever parked
 * @param worktrees every worktree git lists, whose branches are already checked out
 * @returns the branch name
 */
export function newTreeBranch({
  declaredBranch,
  parked,
  slug,
  worktrees,
}: {
  declaredBranch: string | undefined;
  parked: ParkedEvent | undefined;
  slug: string;
  worktrees: readonly WorktreeInfo[];
}): string {
  const recorded = parked === undefined ? undefined : parkedBranchOf({ parked });
  if (recorded !== undefined && !worktrees.some((tree) => ownedBranches({ worktree: tree }).includes(recorded))) {
    return recorded;
  }
  if (declaredBranch !== undefined) {
    return declaredBranch;
  }
  return slug;
}
