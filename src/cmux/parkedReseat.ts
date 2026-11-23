/**
 * Which tree a parked seat's reseat reopens. Pure, like `./plan.ts`, whose `spawnWorktree` asks it first
 * whenever the run's current cycle carries a parked checkpoint; its own module so the planner stays a shape.
 */
import type { ParkedEvent } from "../handover/parkedEvent.js";
import { standsIn } from "../handover/parkPolicy.js";
import { worktreePathKey } from "../worktree/location.js";
import { findWorktreeForBranch, type WorktreeInfo } from "./worktreeList.js";

/**
 * The worktree a parked seat was closed in: the one holding the journalled PATH, else the one holding the
 * journalled branch. The path leads because a seat named with `--workspace` may stand in a tree on another
 * branch than the run recorded, and a branch lookup then reopens the writer's tree instead. The caller passes the fleet's trees only (see {@link fleetWorktrees}), so a seat parked in the main
 * checkout is reseated into its run's own tree.
 *
 * @param parked the checkpoint the park journalled
 * @param worktrees the fleet's worktrees, the main checkout already removed
 * @returns the worktree, or `undefined` when neither key finds one
 */
export function parkedWorktreeOf({
  parked,
  worktrees,
}: {
  parked: ParkedEvent;
  worktrees: readonly WorktreeInfo[];
}): WorktreeInfo | undefined {
  // The DEEPEST tree holding the path: fleet trees sit beneath the main checkout, and a seat opened in a
  // subdirectory journals that subdirectory.
  const holding = worktrees
    .filter((worktree) => standsIn({ directory: parked.worktree, tree: worktree.path }))
    .toSorted((a, b) => worktreePathKey({ path: b.path }).length - worktreePathKey({ path: a.path }).length)[0];
  if (holding !== undefined) {
    return holding;
  }
  return findWorktreeForBranch({ candidates: [parked.branch], worktrees });
}

/**
 * Every worktree but the main checkout, which a reseat never opens by any lookup — a run parked on the branch
 * main holds reopened it by branch once the path lookup refused it.
 *
 * Two keys, because one is lexical. `git worktree list` always names the main worktree FIRST, whatever path
 * spells it, so the first entry goes. The doc's `repo:` goes too, compared as a path key, since that key does
 * not resolve a symlink: a `repo:` reached through one still named git's physical main.
 *
 * @param repoRoot the main checkout as the doc names it
 * @param worktrees every worktree currently on disk, in `git worktree list` order
 * @returns the rest
 */
export function fleetWorktrees({
  repoRoot,
  worktrees,
}: {
  repoRoot: string;
  worktrees: readonly WorktreeInfo[];
}): readonly WorktreeInfo[] {
  const rootKey = worktreePathKey({ path: repoRoot });
  return worktrees.slice(1).filter((worktree) => worktreePathKey({ path: worktree.path }) !== rootKey);
}
