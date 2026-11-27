/**
 * The one free-disk floor the worktree prune reclaims to: the owner's fixed 100 GB, or `machine capacity`'s disk
 * hold, whichever is higher.
 *
 * The two answer different questions — 100 GB is "start reclaiming early", the hold is "is the next seat safe" —
 * and the hold sits well under it (`diskFloorFor`, `../live/machine/capacityHolds.ts`). The `max` stays as an
 * invariant guard: a prune that read itself relieved below the hold would leave the fleet held with nothing
 * reclaiming. MEASURED, the failure the guard exists for, when the hold still scaled with live sessions: 16 put
 * it at 100.8 GB while the prune judged pressure against a fixed 100 GB; the apply crossed 100 GB, stopped at
 * the routine cap with 260 removals owed, and the fleet sat held on disk (`$SLOPWEAVER_HOME/worktree-bundles/
 * auto-prune.log` beside `slopweaver machine capacity`).
 */
import { diskFloorFor } from "../live/machine/capacityHolds.js";
import { WORKTREE_PRUNE_TRIGGER_FREE_GB } from "./pruneTrigger.js";

/**
 * The free-disk floor, in GB, under which the prune is under pressure and the threshold trigger launches one.
 *
 * @returns the higher of the prune's own trigger and capacity's fixed disk hold
 */
export function worktreePruneFloorGb(): number {
  return Math.max(WORKTREE_PRUNE_TRIGGER_FREE_GB, diskFloorFor().gb);
}
