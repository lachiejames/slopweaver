/**
 * `handover register --branch`'s warning when the branch it names is checked out in a tree ANOTHER row's unclosed
 * run or parked seat holds — the registration half of `../cmux/spawnTreeGate.ts`'s refusal.
 *
 * A warning, never a refusal: registering is how the work is captured, and refusing it would lose the row while
 * preventing nothing — the spawn is where a second session would actually open, and the spawn refuses. The warning
 * is there so the registering session learns NOW that seating this row as declared will be refused, and can
 * register it with no branch key instead, rather than finding out when the spawn says so.
 */

import { scanTreeHolders } from "../../../cmux/treeHolderScan.js";
import { type TreeHolder, treeOccupancy } from "../../../cmux/treeOccupancy.js";
import { listWorktrees } from "../../../cmux/worktree.js";
import { findWorktreeForBranch } from "../../../cmux/worktreeList.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * The warning's words for one foreign holder: the branch, the tree, the holding row — structured fields only.
 *
 * @param branch the branch `--branch` named
 * @param holder the other row's holding of the tree
 * @param slug the row being registered
 * @param tree the worktree the branch is checked out in
 * @returns one line for stderr
 */
export function branchHoldWarning({
  branch,
  holder,
  slug,
  tree,
}: {
  branch: string;
  holder: TreeHolder;
  slug: string;
  tree: string;
}): string {
  return `handover register: --branch ${branch} is checked out in ${tree}, which row ${holder.slug} holds — \`cmux spawn ${slug}\` will refuse to open a second session there; registered anyway, and a row with no --branch is seated in a tree of its own`;
}

/**
 * The warning for a row about to be registered, or `undefined` when its branch is in no tree another row holds.
 *
 * @param branch what `--branch` named, or `undefined` when it was absent
 * @param home the state home whose run journals are read
 * @param repo the checkout the row records, or `undefined` when it records none
 * @param slug the row being registered
 * @returns the line to print to stderr, or `undefined`
 */
export function registerBranchHold({
  branch,
  home,
  repo,
  slug,
}: {
  branch: string | undefined;
  home: string;
  repo: string | undefined;
  slug: string;
}): string | undefined {
  if (branch === undefined || repo === undefined) {
    return undefined;
  }
  const worktrees = listWorktrees({ repoRoot: repo });
  const tree = findWorktreeForBranch({ candidates: [branch], worktrees });
  if (tree === undefined) {
    return undefined;
  }
  const { holders } = scanTreeHolders({ runsDir: stateHomePaths({ home }).runs, tree: tree.path });
  const verdict = treeOccupancy({
    holders,
    // git lists the main checkout first, which is shared by design and never warned about.
    mainCheckouts: worktrees.slice(0, 1).map((worktree) => worktree.path),
    slug,
    tree: tree.path,
    worktrees: worktrees.map((worktree) => worktree.path),
  });
  return verdict.kind === "foreign"
    ? branchHoldWarning({ branch, holder: verdict.holder, slug, tree: tree.path })
    : undefined;
}
