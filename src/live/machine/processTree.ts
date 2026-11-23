/**
 * The one walk every machine reaper shares: a process and everything under it, read off a `ps` snapshot's
 * child index, in the order kills must go out in — and what that tree costs.
 *
 * Deepest first so a parent cannot fork a replacement between two signals — `./reap.ts` measured why the
 * whole tree matters. `./reap.ts`, `./devServerCensus.ts` and `./worktreeResidue.ts` each kill a tree in that
 * same order for that same reason, so the walk lives here rather than in any one of them, and none of them
 * has to import another reaper's module just to reach it. The orphaned-shell reap and the dev-server census
 * both report a tree's summed `%CPU` as what killing it gives back, so {@link treeCpu} lives beside the walk.
 *
 * Pure: a root and a child index in, an ordered pid list out; a tree and a sample in, one percentage out.
 */
import type { ProcessCpu } from "./fleetLoad.js";

/**
 * Every pid under `root`, itself included, DEEPEST FIRST — the order kills must go out in. A child the walk
 * has already visited is never queued twice, so a cycle in a racing `ps` snapshot cannot hang it.
 *
 * @param root the tree's top process
 * @param childrenByPpid the snapshot's child index, from `./fleetLoad.ts`'s `childIndexOf`
 * @returns the whole tree, root last
 */
export function treeDeepestFirst({
  root,
  childrenByPpid,
}: {
  root: number;
  childrenByPpid: ReadonlyMap<number, number[]>;
}): readonly number[] {
  const order: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift()!; // the loop condition proves the queue is non-empty
    order.push(pid);
    // A childless pid is the common case, so the absence is an early continue rather than an empty literal.
    const children = childrenByPpid.get(pid);
    if (children === undefined) {
      continue;
    }
    for (const child of children) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return order.toReversed();
}

/** One pid's `%CPU` from the sample, or zero when the sample did not carry it. */
function cpuOf({ cpuByPid, pid }: { cpuByPid: ReadonlyMap<number, number>; pid: number }): number {
  const measured = cpuByPid.get(pid);
  if (measured === undefined) {
    return 0;
  }
  return measured;
}

/**
 * One tree's summed `%CPU`, rounded to one decimal, or `undefined` when no sample was taken — never 0 for an
 * unmeasured tree. Inside a sample that WAS taken, a pid the sample does not carry contributes zero.
 *
 * @param cpuByPid the sample's `%CPU` indexed by pid
 * @param cpuRows the sample itself, read only to tell "no sample taken" from "sample taken"
 * @param treePids every pid in the tree, from {@link treeDeepestFirst}
 * @returns the tree's summed `%CPU`, or `undefined` when there was no sample
 */
export function treeCpu({
  cpuByPid,
  cpuRows,
  treePids,
}: {
  cpuByPid: ReadonlyMap<number, number>;
  cpuRows: readonly ProcessCpu[];
  treePids: readonly number[];
}): number | undefined {
  if (cpuRows.length === 0) {
    return undefined;
  }
  return Math.round(treePids.reduce((sum, pid) => sum + cpuOf({ cpuByPid, pid }), 0) * 10) / 10;
}
