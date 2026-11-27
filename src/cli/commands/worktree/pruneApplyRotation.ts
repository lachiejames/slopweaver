/**
 * `worktree prune`'s removal ROTATION: the paced, deadline-bounded walk over every classified tree that the
 * apply half (`./pruneApplyPass.ts`) runs first. Split out of that file along the per-tree seam, so the decision
 * taken before each tree ({@link nextRemovalStep}) is a pure function of its injected brakes and is tested as one.
 */
import { slopweaverHome } from "../../../config.js";
import { loadDenylistResult } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { applyVerdict, type PruneOutcome, renderOutcome } from "../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import {
  type ApplyAttempt,
  type ApplyMemory,
  applyOrder,
  type RepoPlan,
  type RepoVerdict,
} from "../../../worktree/pruneOrder.js";
import type { RemovalPacer } from "../../../worktree/prunePacing.js";
import { PRUNE_REMOTE } from "../../../worktree/pruneRemote.js";
import { runSalvage } from "../../../worktree/pruneSalvage.js";
import { reclaimTrashDir } from "../../../worktree/reclaimTrash.js";
import { recyclePoolDir } from "../../../worktree/recyclePool.js";
import { recordSalvage } from "../../../worktree/salvageLedger.js";
import { gitSalvageEdges, salvageScanDecline } from "../../../worktree/salvageScan.js";
import { productionGithubPushDeps } from "../github/pushPrimitives.js";
import type { RemovalCandidate } from "./pruneLiveState.js";

/** What a bounded apply pass got through, and what it left for the next run. */
export interface ApplyPass {
  readonly removed: number;
  /** Removals that started and could not finish, each printed FAILED as it happened. */
  readonly failed: number;
  readonly remaining: readonly RepoVerdict[];
  /** Every tree the scan offered this pass, in the order it walked them. */
  readonly candidates: number;
  /**
   * The trees still owed once the pass ended: every candidate it did not remove, so one it reached and KEPT (a
   * session took it since the scan, a removal failed) stays owed beside the ones it never reached.
   */
  readonly owedAfter: number;
}

/**
 * The activity window a verdict asks the apply to judge again, or null when its scan asked no age of the tree.
 *
 * Absent BY DESIGN on every class but a `merged` or `pushed` one whose coldness window applied, so this is an `if`
 * that returns rather than a fallback value.
 */
function activityFloorOf({ verdict }: { verdict: PruneVerdict }): number | null {
  if (verdict.activityFloorMs === undefined) {
    return null;
  }
  return verdict.activityFloorMs;
}

/**
 * What the rotation does with the tree it is standing on: stop before it (the tree stays owed), keep it and move
 * on, or remove it.
 */
export type RemovalStep = { readonly kind: "stop" } | { readonly kind: "keep" } | { readonly kind: "remove" };

/**
 * Decide what happens to the next tree, asking each brake in the order that keeps nothing slow between the last
 * read and the removal itself.
 *
 * The pacer goes first and may wait; a stop it answers is printed and leaves the tree owed. The live-state read
 * goes next, and nothing which takes time sits between it and the removal, nor between
 * the deadline read and the removal. The gate and the live-state read both take time, and a
 * gate held under pressure can release moments before the deadline, so the deadline is read once more last.
 * The apply lock is read last of all: a lock taken over is unfenced, so a run that was
 * stopped past `APPLY_LEASE_MS` and resumed would otherwise remove beside the run that took it. It
 * is read first too, so a run that has already seen its lock go ends before another back-off.
 *
 * @param path the tree's own path, which the live registers are asked about
 * @param branch the tree's branch, which an open pull request may hold it on
 * @param activityFloorMs the verdict's activity window, which a touch since the scan now holds it under; null for none
 * @param deadlineMs the epoch instant no removal may start after
 * @param pace the brakes between trees
 * @param heldNow why a tree may not be removed right now, read fresh; null when nothing holds it
 * @param nowMs the wall clock, injected so a test can stand at either side of the deadline
 * @param lockHeld whether this run still holds the apply lock, false once another run took it over
 * @returns the step the rotation takes for this tree
 * @internal
 */
export async function nextRemovalStep({
  path,
  branch,
  activityFloorMs,
  deadlineMs,
  pace,
  heldNow,
  nowMs,
  lockHeld,
}: {
  path: string;
  branch: string | null;
  activityFloorMs: number | null;
  deadlineMs: number;
  pace: Pick<RemovalPacer, "waitUntilReady">;
  heldNow: (args: RemovalCandidate) => Promise<string | null>;
  nowMs: () => number;
  lockHeld: () => boolean;
}): Promise<RemovalStep> {
  // First as well as last, so a run that has lost its lock never sits out another back-off.
  if (!lockHeld()) {
    logger.out({ line: `  removals stopped: ${LOCK_LOST_LINE}` });
    return { kind: "stop" };
  }
  const stop = await pace.waitUntilReady({ deadlineMs });
  if (stop !== null) {
    logger.out({ line: `  removals paused: ${stop}` });
    return { kind: "stop" };
  }
  const held = await heldNow({ activityFloorMs, branch, path });
  if (held !== null) {
    logger.out({ line: `  kept ${path} — ${held}` });
    return { kind: "keep" };
  }
  if (nowMs() >= deadlineMs) {
    return { kind: "stop" };
  }
  if (!lockHeld()) {
    logger.out({ line: `  removals stopped: ${LOCK_LOST_LINE}` });
    return { kind: "stop" };
  }
  return { kind: "remove" };
}

/** Why a run stops once another run has taken its apply lock over. */
const LOCK_LOST_LINE = "another run took this run's apply lock over, so that run removes the rest";

/**
 * Carry out the removals in rotation until the deadline, printing each outcome as it happens.
 *
 * The deadline is checked BEFORE each removal, never during one: a `git worktree remove` interrupted
 * part-way is the gutted tree the `interrupted` class exists to finish, so a bounded run stops between
 * removals or not at all.
 *
 * **The live registers are read AGAIN before every removal**, because the scan's copy can be a whole
 * `--scan-budget` plus `--budget` old by the last one, and `git worktree remove` deletes a directory a live
 * process is standing in and exits 0. A tree a session, workspace or process took since the scan
 * is kept, so is a tree an open pull request of the owner's is on while that tree is still warm, and so is every tree
 * while the registers cannot be read. What remains is one read's width: a session
 * opening in a day-cold tree between that read and the removal, which only a lock shared with every session
 * launch would close.
 *
 * **Paced, because a removal is millions of unlinks.** The pacer is asked before every tree and BACKS OFF while the
 * load is at the hold or fseventsd at its bar or unreadable, then carries on; that wait is the only one between
 * trees (`../../../worktree/prunePacing.ts`). No count stops a pass, and no warm reading either: its deadline does.
 * No trash batch is emptied here — the tail does that, after the mirrors (`./pruneApplyPass.ts`).
 *
 * @param plans every repository's classified verdicts, in sweep order
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes
 * @param deadlineMs the epoch instant this pass may not start another removal after
 * @param memory what earlier applies attempted — a kept tree is tried after every other one
 * @param remember where each attempt is recorded, before it starts and again once it returns
 * @param heldNow why a tree may not be removed right now, read fresh; null when nothing holds it
 * @param pace the brakes between trees: why to stop before the next one, and the wait after a removal
 * @param lockHeld whether this run still holds the apply lock, read before every removal
 * @returns how many trees went, and the removals the budget did not reach
 */
export async function applyInRotation({
  plans,
  mergedOnly,
  deadlineMs,
  memory,
  remember,
  heldNow,
  pace,
  lockHeld,
}: {
  plans: readonly RepoPlan[];
  mergedOnly: boolean;
  deadlineMs: number;
  memory: ApplyMemory;
  remember: (args: { attempt: ApplyAttempt }) => void;
  heldNow: (args: RemovalCandidate) => Promise<string | null>;
  pace: Pick<RemovalPacer, "waitUntilReady">;
  lockHeld: () => boolean;
}): Promise<ApplyPass> {
  const order = applyOrder({ memory, mergedOnly, plans });
  // Read once for the run: every salvage's secrets scan applies the same list (`worktree/salvageScan.ts`).
  const denylist = loadDenylistResult();
  let removed = 0;
  let failed = 0;
  let index = 0;
  while (index < order.length && Date.now() < deadlineMs) {
    const item = order[index]!;
    const step = await nextRemovalStep({
      activityFloorMs: activityFloorOf({ verdict: item.verdict }),
      branch: item.verdict.branch,
      deadlineMs,
      heldNow,
      lockHeld,
      nowMs: Date.now,
      pace,
      path: item.verdict.path,
    });
    // A stop leaves this tree in what the run reports it still owes.
    if (step.kind === "stop") {
      break;
    }
    index += 1;
    if (step.kind === "keep") {
      continue;
    }
    const outcome = attemptRemoval({ denylist, item, lockHeld, remember });
    removed += Number(outcome.treeRemoved);
    // Counted and carried on past: one tree that cannot be removed must not stop the sweep freeing the rest.
    failed += Number(outcome.failed);
  }
  return {
    candidates: order.length,
    failed,
    owedAfter: order.length - removed,
    remaining: order.slice(index),
    removed,
  };
}

/**
 * Remove one tree, recording the attempt either side of it.
 *
 * The attempt is recorded as KEPT before it starts, so an attempt that never returns is still behind every
 * fresh tree for whichever apply runs next, once this one's lease has lapsed. No trash batch is
 * emptied here: a batch is hardlinks that free almost nothing (`../../../worktree/prunePressure.ts`), and the
 * nine minutes one cost after every removal is what held a routine run to a handful of trees.
 *
 * @param item the tree to remove and the repository it belongs to
 * @param denylist the run's secrets denylist, read once for every salvage's scan
 * @param remember where each attempt is recorded
 * @param lockHeld whether this run still holds the apply lock, read again right before git removes the tree
 * @returns what happened to that tree
 */
function attemptRemoval({
  item,
  denylist,
  remember,
  lockHeld,
}: {
  item: RepoVerdict;
  denylist: ReturnType<typeof loadDenylistResult>;
  remember: (input: { attempt: ApplyAttempt }) => void;
  lockHeld: () => boolean;
}): PruneOutcome {
  const attempt = { atMs: Date.now(), path: item.verdict.path, removed: false, repoRoot: item.repoRoot };
  remember({ attempt });
  const outcome = applyOne({ denylist, item, lockHeld });
  remember({ attempt: { ...attempt, removed: outcome.treeRemoved } });
  logger.out({ line: renderOutcome({ outcome }) });
  return outcome;
}

/**
 * Carry out one removal, salvaging first where the verdict calls for it, and record where a salvage went.
 *
 * @param item the tree to remove and the repository it belongs to
 * @param denylist the run's secrets denylist, read once for every salvage's scan
 * @param lockHeld whether this run still holds the apply lock
 * @returns what happened to that tree
 */
function applyOne({
  item,
  denylist,
  lockHeld,
}: {
  item: RepoVerdict;
  denylist: ReturnType<typeof loadDenylistResult>;
  lockHeld: () => boolean;
}): PruneOutcome {
  const outcome = applyVerdict({
    lockHeld,
    // Its `node_modules` is renamed into the trash before git removes the rest, so the bulk is deleted at
    // background priority under the load gate rather than by git in place at full speed (`prunePacing.ts`).
    bulkTrash: reclaimTrashDir({ repoRoot: item.repoRoot }),
    // And its root `node_modules` is kept for the next worktree provisioned here, when the pool has room.
    recyclePool: recyclePoolDir({ repoRoot: item.repoRoot }),
    repoRoot: item.repoRoot,
    salvage: ({ verdict }) =>
      runSalvage({
        deps: productionGithubPushDeps(),
        denylist,
        home: slopweaverHome(),
        // The remote the scan judged "on no remote" against, so the tree it excused is pushed where it was measured.
        remote: PRUNE_REMOTE,
        scan: ({ path, sha, target, url }) =>
          salvageScanDecline({ denylist, edges: gitSalvageEdges({ cwd: path, sha, url }), refName: target }),
        verdict,
      }),
    verdict: item.verdict,
  });
  // Written BEFORE the count, and for the tree whose own board row has long since closed: most of what
  // the week-old waiver reaches is weeks old, so "update that row of the board" has no row to update and
  // the branch would be discoverable only in a log that scrolls away; the owner's salvage rule asks that it be findable.
  if (outcome.salvagedTo !== null) {
    recordSalvage({
      branch: outcome.salvagedTo,
      home: slopweaverHome(),
      remote: PRUNE_REMOTE,
      repoRoot: item.repoRoot,
      worktreePath: outcome.path,
    });
  }
  return outcome;
}
