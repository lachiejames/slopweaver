/**
 * What a `worktree prune --apply` spends its window on, and whether free disk is under the prune floor
 * (`./pruneFloor.ts`: the owner's 100 GB, or capacity's disk hold, whichever is higher).
 *
 * **The window goes to unique bytes, and a `node_modules` holds almost none.** MEASURED on this
 * repository, counting single-link files with `find <dir> -type f -ls` (field 4 is the link count):
 *
 * - a queued tree outside `node_modules`: 33,222 files, 0.284 GB, every file single-link;
 * - the reclaim-trash batch the running apply was emptying (one tree's `node_modules`): 157,727 files, 4 of them
 *   single-link, 0.0004 GB unique — the rest are hardlinks into yarn's store;
 * - a gone worktree's plugin mirror root: 14,508 files, 0.126 GB, every file single-link.
 *
 * Again: a trash batch `du` reads at 2.0 GB held 332 KB in single-link files
 * (`find <batch> -type f -links 1 -print0 | xargs -0 du -ck | tail -1`).
 *
 * The governed delete runs at about 1,000 entries per 3.5 s (the apply's `rm` children sampled every 0.5 s), so
 * the one trash batch a routine run used to empty after each removal cost about nine minutes of a fifteen-minute
 * window and freed nothing; that is why five threshold runs removed 7, 4, 0, 2 and 4 trees. So EVERY apply now
 * removes trees, then frees gone mirrors, then spends only what is left on the trash. Dropping a kept tree's
 * `node_modules` is the same hardlinks, so only a routine run, off pressure, does it.
 */
import { thresholdPruneOwed } from "./pruneTrigger.js";

/** Which inode-only phase an apply runs, decided afresh when the phase would start. */
export interface PressureReclaimPolicy {
  /** Drop kept trees' `node_modules` after the removals. */
  readonly runDepsPass: boolean;
}

/**
 * The phases an apply runs given whether free disk is under the prune floor right now.
 *
 * @param diskPressure whether free disk is under the prune floor at this decision
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes, which never drops dependencies
 * @returns the phases to run
 */
export function pressureReclaimPolicy({
  diskPressure,
  mergedOnly,
}: {
  diskPressure: boolean;
  mergedOnly: boolean;
}): PressureReclaimPolicy {
  return { runDepsPass: !diskPressure && !mergedOnly };
}

/**
 * Whether free disk is under the prune floor, from one `df` read. An unreadable volume is not pressure: the
 * routine brakes are the safe side.
 *
 * @param availableKib free KiB on the volume, or null when it could not be read
 * @param floorGb the prune floor, `worktreePruneFloorGb`
 * @returns true under the floor
 */
export function diskPressureFrom({ availableKib, floorGb }: { availableKib: number | null; floorGb: number }): boolean {
  if (availableKib === null) {
    return false;
  }
  return thresholdPruneOwed({ availableKib, floorGb });
}
