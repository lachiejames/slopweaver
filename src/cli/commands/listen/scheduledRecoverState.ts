/**
 * The durable cadence state a scheduled recovery sweep starts from and persists — pure rules over
 * `RecoverySweepState`, split out of `./scheduledRecover.ts` so that module keeps only the sweep itself.
 *
 * `./scheduledRecover.ts`'s own header carries the V1 → V2 migration these rules implement.
 */
import { readThreadCursors } from "../../../corpus/slack/threadCursors.js";
import { logger } from "../../../lib/logger.js";
import { ownThreadRegistrations } from "../../../live/listen/recoverOwnThreads.js";
import {
  RECOVERY_INTERVAL_MS,
  type RecoverySweepState,
  type RecoveryWindow,
} from "../../../live/listen/recoverSchedule.js";
import { type RecoveryThreadCheckpoints, seedThreadCheckpointKeys } from "../../../live/listen/recoverThreads.js";
import { readPlacementJournal } from "../../../live/slack/placementJournal.js";

/** Recovery's own thread-checkpoint inventory carried by a durable state, whichever version it is. */
function checkpointsFromState({ state }: { state: RecoverySweepState | undefined }): RecoveryThreadCheckpoints {
  return state?.version === 2 ? state.threadCheckpoints : {};
}

/**
 * Whether a durable state means recovery's checkpoint inventory has not been established yet.
 *
 * @param state the durable state, or `undefined` before any sweep has ever run
 * @returns `true` for a missing or V1 state
 */
export function isMigrating({ state }: { state: RecoverySweepState | undefined }): boolean {
  return state === undefined || state.version === 1;
}

/**
 * The next cadence state to persist. The watermark and thread checkpoints both advance only when this sweep
 * was fully complete; a partial sweep retains both — see `./scheduledRecover.ts`'s own header for why. A partial
 * MIGRATING sweep is a special case: it writes V1/missing back unchanged (never V2), so the next invocation
 * still recognises the inventory as unestablished and retries the identical wide bootstrap rather than
 * quietly settling for whatever partial checkpoint set this attempt produced.
 *
 * @param complete whether this sweep's provider walk (foreground and background alike) completed in full
 * @param latestExclusiveTs this sweep's own window upper bound — the watermark a complete sweep advances to
 * @param migrating whether this sweep was a V1 → V2 migration bootstrap
 * @param previous the durable state before this sweep, or `undefined` before any sweep has ever run
 * @param threadCheckpoints this sweep's own returned checkpoint inventory
 * @param nowMs the current instant, epoch milliseconds
 * @returns the state to persist
 */
export function nextSweepState({
  complete,
  latestExclusiveTs,
  migrating,
  previous,
  threadCheckpoints,
  nowMs,
}: {
  complete: boolean;
  latestExclusiveTs: string;
  migrating: boolean;
  previous: RecoverySweepState | undefined;
  threadCheckpoints: RecoveryThreadCheckpoints;
  nowMs: number;
}): RecoverySweepState {
  const nextDueAtIso = new Date(nowMs + RECOVERY_INTERVAL_MS).toISOString();
  if (migrating && !complete) {
    // "Writes V1/missing back unchanged" means literally that when a real V1 state already exists — its
    // own nextDueAtIso must survive a failed migration attempt untouched, not be silently replaced with a
    // freshly computed one. Only a genuinely missing prior state (the very first sweep ever) has nothing
    // to preserve, so a fresh nextDueAtIso is the only sensible value there.
    if (previous !== undefined) {
      return previous;
    }
    return { nextDueAtIso, version: 1 };
  }
  const completedThroughTs = complete ? latestExclusiveTs : previous?.completedThroughTs;
  const checkpoints = complete ? threadCheckpoints : checkpointsFromState({ state: previous });
  return {
    nextDueAtIso,
    threadCheckpoints: checkpoints,
    version: 2,
    ...(completedThroughTs === undefined ? {} : { completedThroughTs }),
  };
}

/**
 * Every thread the bot posted into recently, off the placement journal, as seed checkpoints that sit BENEATH the
 * inventory — `../../../live/listen/recoverOwnThreads.ts` says why. A journal that cannot be opened registers
 * nothing and says so on stderr: the sweep's own walk is unaffected, and the bot's threads are then only as
 * reachable as they were before the journal existed. A line that does not parse — a torn write — is named on stderr
 * by number too, because the thread it held is one this sweep cannot register.
 *
 * @param home the state home the placement journal lives under
 * @param window this sweep's own window, whose upper bound the look-back is measured from
 * @returns the registrations, possibly empty
 */
function ownThreadSeeds({ home, window }: { home: string; window: RecoveryWindow }): RecoveryThreadCheckpoints {
  const journal = readPlacementJournal({ home });
  if (journal.readFailure !== undefined) {
    logger.warn({
      msg: `listen recover: placement journal unreadable, the bot's own threads are not re-read: ${journal.readFailure}`,
    });
    return {};
  }
  if (journal.unreadable.length > 0) {
    logger.warn({
      msg:
        `listen recover: placement journal line(s) ${journal.unreadable.join(", ")} do not parse, so the threads ` +
        "they held are not re-read; every other row registers as usual",
    });
  }
  return ownThreadRegistrations({ nowTs: window.latestExclusiveTs, rows: journal.rows });
}

/**
 * The thread-checkpoint inventory a sweep should START from: recovery's own carried-forward inventory on an
 * ordinary sweep, or — on a V1 → V2 migration — an empty inventory optionally widened with corpus
 * ingestion's already-known thread KEYS (never its cursor values), each bootstrapped at this migration's own
 * wide window's lower bound. Either way the threads the bot itself posted into sit beneath it, so a reply under
 * one of its own messages reaches the sweep's ask classification after the root has left every history window.
 *
 * @param home the Slopweaver home corpus ingestion's own thread-cursor store and the placement journal live under
 * @param migrating whether this sweep is a V1 → V2 migration bootstrap
 * @param previous the durable state before this sweep, or `undefined`
 * @param window this sweep's own window
 * @returns the checkpoint inventory to scan with
 */
export function startingCheckpoints({
  home,
  migrating,
  previous,
  window,
}: {
  home: string;
  migrating: boolean;
  previous: RecoverySweepState | undefined;
  window: RecoveryWindow;
}): RecoveryThreadCheckpoints {
  const own = ownThreadSeeds({ home, window });
  if (!migrating) {
    return { ...own, ...checkpointsFromState({ state: previous }) };
  }
  const corpusKeys = Object.keys(readThreadCursors({ home }));
  return seedThreadCheckpointKeys({ bootstrapCursorTs: window.oldestExclusiveTs, corpusKeys, existing: own });
}
