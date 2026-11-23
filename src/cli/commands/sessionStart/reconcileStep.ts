/**
 * `session-start`'s last step: diff this run against the last one and record it as the next one's baseline —
 * unless the list was cut short at its `--deadline`, when it does neither.
 */
import { logger } from "../../../lib/logger.js";
import type { Ranking } from "../../../sessionStart/rank.js";
import { type Movement, reconcileRuns, snapshotOf } from "../../../sessionStart/reconcile.js";
import { latestSnapshot, parseSnapshots, readRunStore, recordRun } from "../../../sessionStart/runStore.js";

/** Why a list cut short at its `--deadline` reports no movement: a leg it skipped would read as every row gone. */
export const CUT_SHORT_UNRECONCILED =
  "what moved since the last run is not reported, and this run is not recorded as the next one's baseline: the list is cut short";

/** What the reconcile step hands the emitters. */
export interface Reconciled {
  readonly movements: readonly Movement[];
  readonly sinceIso: string | undefined;
  readonly couldNotSee: readonly string[];
}

/**
 * Diff this run against the last one, and record it as the next one's baseline.
 *
 * The read happens BEFORE the write, which is the whole ordering: recording first would make every run diff
 * against itself and report that nothing ever moves.
 *
 * @param ranking what this run ranked
 * @param home the state home holding the store
 * @param nowIso the run's own instant
 * @param record whether this run becomes the next one's baseline
 * @returns what moved, and when the run it moved since happened
 */
function reconcileAgainstLastRun({
  ranking,
  home,
  nowIso,
  record,
}: {
  ranking: Ranking;
  home: string;
  nowIso: string;
  record: boolean;
}): { movements: readonly Movement[]; sinceIso: string | undefined } {
  const snapshot = snapshotOf({ nowIso, ranking });
  const previous = latestSnapshot({ snapshots: parseSnapshots({ text: readRunStore({ home }) }) });
  const movements = reconcileRuns({ current: snapshot, previous });
  if (record) {
    const recorded = recordRun({ home, snapshot });
    if (recorded.isErr()) {
      // A snapshot that could not be written costs the NEXT run its baseline, so it is said out loud rather
      // than swallowed. It does not invalidate this run's own list, so it is not a failure exit.
      recorded.error.forEach((error) => {
        logger.error({ msg: `session-start: could not record this run, so the next one has no baseline: ${error}` });
      });
    }
  }
  return { movements, sinceIso: previous?.atIso };
}

/**
 * Reconcile a whole list against the last run; leave a list cut short undiffed and unrecorded.
 *
 * A cut list is neither diffed nor recorded: every row of a leg it skipped would read as gone now, and again on
 * the next run's diff against it. It says so in one `couldNotSee` line rather than reporting nothing.
 *
 * @param cut the parts this run skipped at its deadline, empty for a whole run
 * @param ranking what this run ranked
 * @param home the state home holding the run store
 * @param nowIso the run's own instant
 * @param record whether a whole run becomes the next one's baseline
 * @returns what moved, since when, and the line a cut list carries
 */
export function reconcileUnlessCut({
  cut,
  ranking,
  home,
  nowIso,
  record,
}: {
  cut: readonly string[];
  ranking: Ranking;
  home: string;
  nowIso: string;
  record: boolean;
}): Reconciled {
  if (cut.length > 0) {
    return { couldNotSee: [CUT_SHORT_UNRECONCILED], movements: [], sinceIso: undefined };
  }
  return { ...reconcileAgainstLastRun({ home, nowIso, ranking, record }), couldNotSee: [] };
}
