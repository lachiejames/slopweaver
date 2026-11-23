/**
 * `worktree prune`'s APPLY half: carry the classified plans out in rotation under the removal budget, capture
 * each `salvaged` tree's work first, then drop kept trees' dependencies and report the free space that came
 * back. Split out of `./pruneRun.ts` along the same seam as `./pruneScanPass.ts`; the rails are that file's. The
 * removal rotation itself is `./pruneApplyRotation.ts`.
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { freeKib, pruneStaleRecords } from "../../../worktree/pruneApply.js";
import { type DepsPass, depsClause, dropDepsInRotation } from "../../../worktree/pruneDeps.js";
import { worktreePruneFloorGb } from "../../../worktree/pruneFloor.js";
import {
  type ApplyAttempt,
  type ApplyMemory,
  backlogLine,
  nextApplyMemory,
  type RepoPlan,
} from "../../../worktree/pruneOrder.js";
import { machineLoadStop, machinePacer, type Pacer, type RemovalPacer } from "../../../worktree/prunePacing.js";
import {
  diskPressureFrom,
  type PressureReclaimPolicy,
  pressureReclaimPolicy,
} from "../../../worktree/prunePressure.js";
import { pruneProgressLine } from "../../../worktree/pruneProgress.js";
import { mirrorPassDeadlineMs } from "../../../worktree/pruneSweep.js";
import { emptyReclaimTrash, reclaimTrashDir } from "../../../worktree/reclaimTrash.js";
import { runMirrorPass } from "./mirrorPruneRun.js";
import { forgetGoneTrees, readApplyMemory, writeApplyMemory } from "./pruneApplyMemory.js";
import { type ApplyPass, applyInRotation } from "./pruneApplyRotation.js";
import { coldByLiveState, heldByLiveState, readLiveState } from "./pruneLiveState.js";
import { probePath } from "./pruneScanPass.js";

/**
 * Record one attempt into the memory as it stands on disk NOW, never into a copy this process read earlier.
 *
 * An apply whose lease lapsed mid-attempt can return beside the apply that took the lease over; writing its
 * own earlier copy back would erase every attempt the newer one recorded in between, and a kept tree would
 * lead the next rotation again as though never tried. Re-reading before each write merges the
 * two. What remains is two writes landing inside one read-merge-write, which the lease makes a stalled
 * holder's residue.
 *
 * @param attempt the attempt to record
 * @param listed the repositories whose worktree list this run read
 * @param registered the `memoryKey` of every worktree of those repositories
 * @param load the memory as it stands now
 * @param persist where the merged memory is written
 * @internal
 */
export function rememberAttempt({
  attempt,
  listed,
  registered,
  load,
  persist,
}: {
  attempt: ApplyAttempt;
  listed: ReadonlySet<string>;
  registered: ReadonlySet<string>;
  load: () => ApplyMemory;
  persist: (args: { memory: ApplyMemory }) => void;
}): void {
  persist({ memory: nextApplyMemory({ attempted: [attempt], listed, previous: load(), registered }) });
}

/**
 * Whether free disk on the state home's volume is under the prune floor right now — the owner's 100 GB or
 * capacity's disk hold, whichever is higher — with `df` read afresh for every tree and every phase, so a run
 * that climbs back over it returns to routine pacing (`../../../worktree/pruneFloor.ts`). `worktree mirror-prune`
 * builds the same reading from the same pieces (`./mirrorPruneRun.ts`), which imports nothing from here
 * because this module imports its mirror pass.
 */
function diskPressureNow({ home }: { home: string }): boolean {
  return diskPressureFrom({ availableKib: freeKib({ path: home }), floorGb: worktreePruneFloorGb() });
}

/** Clear each repository's stale registrations, reporting any that git refused. */
function clearStaleRecords({ plans }: { plans: readonly RepoPlan[] }): void {
  for (const plan of plans) {
    const refusal = pruneStaleRecords({ repoRoot: plan.repoRoot });
    if (refusal !== null) {
      logger.error({ msg: `worktree prune: ${plan.repoRoot} stale records not cleared — ${refusal}` });
    }
  }
}

/**
 * Free the plugin mirrors of removed worktrees, until `tailDeadlineMs`. It runs after the removals, so a tree this
 * run removed loses its mirror in the same run. It has a floor of its own ({@link mirrorPassDeadlineMs}), because a
 * removal backlog that spends the whole window must not starve the mirrors, and it takes the apply's own pacer, so
 * under disk pressure it lifts the cap and load gate exactly as the removals do.
 */
async function freeGoneMirrors({ tailDeadlineMs, pace }: { tailDeadlineMs: number; pace: Pacer }): Promise<void> {
  runMirrorPass({
    apply: true,
    budgetMs: Math.max(0, tailDeadlineMs - Date.now()),
    json: false,
    live: await readLiveState(),
    pace,
  });
}

/**
 * Spend what the mirror window left on the reclaim trash of every repository this run was asked to sweep: the
 * batches the removals moved aside, deleted behind the mirrors because they free inodes rather than bytes.
 *
 * Every ASKED repository, never only the ones that planned: this tail is the trash's only deleter (`session
 * close-done` settles it and deletes nothing), so a checkout whose git could not be read this run would otherwise
 * keep its batches for as long as it stayed unreadable. A batch needs no git to delete.
 *
 * @param repos every main checkout this run sweeps, read or not, whose trash roots are emptied
 * @param tailDeadlineMs the instant no further batch starts after; a window already spent visits no batch
 * @param paused why no further batch may be deleted now, or null
 */
function emptyTrashInTail({
  repos,
  tailDeadlineMs,
  paused,
}: {
  repos: readonly string[];
  tailDeadlineMs: number;
  paused: () => string | null;
}): void {
  // A spent window walks no batch at all: `emptyReclaimTrash` settles every pending batch it visits before it reads
  // its own deadline, which is bookkeeping rather than a delete, but none of it is owed here.
  const budgetMs = tailDeadlineMs - Date.now();
  if (budgetMs <= 0) {
    return;
  }
  const roots = [...new Set(repos.map((repoRoot) => reclaimTrashDir({ repoRoot })))];
  emptyReclaimTrash({
    budgetMs,
    maxDeletes: Number.POSITIVE_INFINITY,
    paused,
    roots,
  });
}

/**
 * Drop kept trees' dependencies in rotation, on a routine run only — under disk pressure the policy skips it, and
 * the window goes to the mirrors and the trash instead. Each tree re-reads the live registers right before its
 * drop, never the scan's copy.
 *
 * @param policy the pressure policy read at the moment the pass would start
 * @param olderThanMs the eligibility age each kept tree is re-checked against
 * @returns what the pass dropped, or undefined when the policy skipped it
 */
async function depsPassUnlessPressed({
  policy,
  plans,
  deadlineMs,
  olderThanMs,
  pace,
  paused,
}: {
  policy: PressureReclaimPolicy;
  plans: readonly RepoPlan[];
  deadlineMs: number;
  olderThanMs: number;
  pace: Pacer;
  paused: () => string | null;
}): Promise<DepsPass | undefined> {
  if (!policy.runDepsPass) {
    return undefined;
  }
  const print = ({ line }: { line: string }): void => {
    logger.out({ line });
  };
  return dropDepsInRotation({ deadlineMs, pace, paused, plans, print, stillCold: coldByLiveState({ olderThanMs }) });
}

/**
 * The brakes every phase of one apply shares, each reading free disk afresh: the removal pacer, why a background
 * delete must pause, and the pressure policy.
 *
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes, which the policy keeps routine
 * @returns the pacer, the pause and the policy reader
 */
function applyBrakes({ mergedOnly }: { mergedOnly: boolean }): {
  readonly pace: RemovalPacer;
  readonly paused: () => string | null;
  readonly policyNow: () => PressureReclaimPolicy;
} {
  const home = slopweaverHome();
  const pressureNow = (): boolean => diskPressureNow({ home });
  return {
    pace: machinePacer({ diskPressureNow: pressureNow }),
    paused: (): string | null => machineLoadStop({ diskPressure: pressureNow() }),
    policyNow: (): PressureReclaimPolicy => pressureReclaimPolicy({ diskPressure: pressureNow(), mergedOnly }),
  };
}

/**
 * Carry out every plan under the run's budget, free the plugin mirrors of removed worktrees, then report how much
 * free space came back. The mirror pass is `worktree/pluginMirrors.ts`'s criterion, under `mirrorPassDeadlineMs`.
 * A routine run drops kept trees' dependencies before the mirrors and a run under disk pressure does not; either
 * spends what the mirror window leaves on the trash (`worktree/prunePressure.ts`).
 *
 * @param repos the repositories being swept, the first of which the free-space probe reads, and every one of
 *   whose reclaim trash the tail empties
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes
 * @param olderThanMs the eligibility age the dependency pass re-checks each kept tree against, and the window an
 *   open pull request holds a tree for at its removal
 * @param deadlineMs the epoch instant no further removal or drop starts after
 * @param registered every worktree path of the repositories in `listed`, scanned this run or not
 * @param listed the repositories whose worktree list this run read
 * @param scanComplete whether the scan read every asked repository and reached every tree, which alone lets the
 *   progress line's zero stand as caught up (`../../../worktree/pruneProgress.ts`)
 * @param lockHeld whether this run still holds the apply lock; once another run took it over, nothing more is
 *   removed, dropped or emptied here
 * @returns how many removals failed part-way, which the caller exits non-zero on
 */
export async function applyPlans({
  plans,
  repos,
  mergedOnly,
  olderThanMs,
  deadlineMs,
  registered,
  listed,
  scanComplete,
  lockHeld,
}: {
  lockHeld: () => boolean;
  plans: readonly RepoPlan[];
  registered: ReadonlySet<string>;
  listed: ReadonlySet<string>;
  repos: readonly string[];
  mergedOnly: boolean;
  olderThanMs: number;
  deadlineMs: number;
  scanComplete: boolean;
}): Promise<{ readonly failed: number }> {
  const probe = probePath({ repos });
  const before = freeKib({ path: probe });
  const home = slopweaverHome();
  const { pace, paused, policyNow } = applyBrakes({ mergedOnly });
  const load = (): ApplyMemory => readApplyMemory({ home });
  const persist = ({ memory }: { memory: ApplyMemory }): void => {
    writeApplyMemory({ home, memory });
  };
  const pass = await applyInRotation({
    deadlineMs,
    heldNow: heldByLiveState({ olderThanMs }),
    lockHeld,
    memory: load(),
    mergedOnly,
    pace,
    plans,
    remember: ({ attempt }) => {
      rememberAttempt({ attempt, listed, load, persist, registered });
    },
  });
  const progress = pruneProgressLine({
    progress: { candidates: pass.candidates, owedAfter: pass.owedAfter, removed: pass.removed, scanComplete },
  });
  // The tail deletes too, so a run whose lock was taken over leaves all of it to the run that took it.
  if (!lockHeld()) {
    logger.out({ line: progress });
    return { failed: pass.failed };
  }
  const deps = await depsPassUnlessPressed({ deadlineMs, olderThanMs, pace, paused, plans, policy: policyNow() });
  clearStaleRecords({ plans });
  forgetGoneTrees({ home, repos: listed });
  const tailDeadlineMs = mirrorPassDeadlineMs({ deadlineMs, nowMs: Date.now() });
  await freeGoneMirrors({ pace, tailDeadlineMs });
  emptyTrashInTail({ paused, repos, tailDeadlineMs });
  reportApplied({ after: freeKib({ path: probe }), before, deps, pass });
  logger.out({ line: progress });
  return { failed: pass.failed };
}

/**
 * Print what an apply did: the removals and the free space that came back, any failures, and the backlog.
 *
 * @param pass what the rotation got through
 * @param deps what the dependency pass dropped, absent when it did not run
 * @param before free KiB before the run, or `null` when unreadable
 * @param after free KiB after the run, or `null` when unreadable
 */
function reportApplied({
  pass,
  deps,
  before,
  after,
}: {
  pass: ApplyPass;
  deps: DepsPass | undefined;
  before: number | null;
  after: number | null;
}): void {
  const delta = before === null || after === null ? null : after - before;
  logger.out({
    line:
      delta === null
        ? `removed ${String(pass.removed)} worktree(s)${depsClause({ deps })}; free space could not be read`
        : `removed ${String(pass.removed)} worktree(s)${depsClause({ deps })}; free space rose ${(delta / 1_000_000).toFixed(1)} GB during this run` +
          " (anything else writing to the disk moves this number too)",
  });
  if (pass.failed > 0) {
    logger.error({
      msg: `worktree prune: ${String(pass.failed)} removal(s) FAILED part-way and left a directory behind — each is printed above with its path`,
    });
  }
  const backlog = backlogLine({ remaining: pass.remaining });
  if (backlog !== undefined) {
    logger.out({ line: backlog });
  }
}
