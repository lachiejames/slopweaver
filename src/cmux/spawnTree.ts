/**
 * Which existing worktree a spawn reopens, from the already-read worktree list — split out of `./plan.ts`, which
 * decides everything else about a spawn. Pure: no filesystem, no git.
 */

import type { ParkedEvent } from "../handover/parkedEvent.js";
import { fleetWorktrees, parkedWorktreeOf } from "./parkedReseat.js";
import { findWorktreeAtPath, findWorktreeForBranch, type WorktreeInfo } from "./worktreeList.js";

/**
 * The worktree a spawn should REUSE, by either key a registered worktree can match on: the branch it holds
 * (wherever it lives), or — when no candidate branch has a home — being the worktree already registered at
 * the exact path the spawn would otherwise create.
 *
 * The second key is the fix for `cmux-spawn-existing-worktree-collision`: a closed session's worktree kept on
 * disk at the conventional path, checked out on a branch no slug guess names (`local-15786`), was invisible
 * to the branch lookup, so the plan said "create" and `git worktree add` died on the directory. Branch first
 * so the earlier live discovery (a branch living under a NON-conventional directory name) keeps winning; path
 * second so the conventional directory is opened rather than fought over. Exported for `live/automation/plan.ts`,
 * whose two planners fall back to a conventional path the same way and would fail the same way.
 *
 * @param worktrees the repository's current worktrees, already read
 * @param candidates branch names in priority order, as `branchCandidates` produces them
 * @param conventionalPath the directory the spawn would create if nothing is reused
 * @returns the worktree to reuse, or `undefined` when one must be created at {@link conventionalPath}
 */
export function findExistingWorktree({
  worktrees,
  candidates,
  conventionalPath,
}: {
  worktrees: readonly WorktreeInfo[];
  candidates: readonly string[];
  conventionalPath: string;
}): WorktreeInfo | undefined {
  const present = findWorktreeForBranch({ candidates, worktrees });
  if (present === undefined) {
    return findWorktreeAtPath({ path: conventionalPath, worktrees });
  }
  return present;
}

/**
 * The worktree a spawn reopens. The parked tree is asked for ALONE first: the candidate search lets the
 * earliest-LISTED worktree win a tie, so a doc's declared branch held elsewhere would otherwise reopen a tree the
 * parked seat never used. A parked run's reseat searches the fleet's trees only, in BOTH lookups: the main
 * checkout holding the declared branch would otherwise answer once the parked tree was gone.
 *
 * @param candidates branch names in priority order, for the search after the parked tree
 * @param conventionalPath the directory the spawn would create if nothing is reused
 * @param parked the run's latest parked checkpoint, when it was parked this cycle
 * @param repoRoot the main checkout, which a parked run's reseat never reopens
 * @returns the worktree to reuse, or `undefined` when one must be created
 */
export function existingSpawnTree({
  candidates,
  conventionalPath,
  parked,
  repoRoot,
  worktrees,
}: {
  candidates: readonly string[];
  conventionalPath: string;
  parked: ParkedEvent | undefined;
  repoRoot: string;
  worktrees: readonly WorktreeInfo[];
}): WorktreeInfo | undefined {
  if (parked === undefined) {
    return findExistingWorktree({ candidates, conventionalPath, worktrees });
  }
  const fleet = fleetWorktrees({ repoRoot, worktrees });
  const parkedTree = parkedWorktreeOf({ parked, worktrees: fleet });
  if (parkedTree !== undefined) {
    return parkedTree;
  }
  return findExistingWorktree({ candidates, conventionalPath, worktrees: fleet });
}
