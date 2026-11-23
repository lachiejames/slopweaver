/**
 * Which run of an automation finished last, and the one plain sentence a broken card may lead with about it. Split out
 * of `./brokenAccount.ts`, which reads the same end-of-run order for the card's detail and its stand-in line.
 */
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { explanationKey } from "../live/automation/failureExplanation.js";
import type { SyncRunView } from "../syncRun/fold.js";
import type { FiringView } from "./card.js";
import { finishedBySettleOf, wroteRunStampOf } from "./runStats.js";

/**
 * When a sync run ended: when it finished, else its last row, else never.
 *
 * @returns the instant in epoch milliseconds, `-Infinity` for one with neither, `NaN` for one that does not parse
 */
export function syncEndMs({ run }: { run: SyncRunView }): number {
  if (run.finishedAtIso !== null) {
    return Date.parse(run.finishedAtIso);
  }
  if (run.lastActivityIso !== null) {
    return Date.parse(run.lastActivityIso);
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * Every sync run that has ended, the one that ended LAST first, by when it finished or, for one that stopped
 * unfinished, its last row. The store lists runs by when they STARTED, and two can overlap, so start order is not end
 * order.
 *
 * @returns the ended runs, last to end first
 */
export function endedSyncsOf({ syncRuns }: { syncRuns: readonly SyncRunView[] }): SyncRunView[] {
  return syncRuns
    .filter((run) => run.state !== "running")
    .toSorted((a, b) => syncEndMs({ run: b }) - syncEndMs({ run: a }));
}

/**
 * Whether a sync that ended unfinished may have stopped at or after an instant. Its last row is not its end: its process
 * was killed or crashed some time after that row (`../syncRun/fold.ts`), and the only bound on when is the next run of
 * the same source starting, since that run needed the refresh slot the dead one held. With no later
 * run of its source, it may have died at any time up to now; a start that does not parse bounds nothing.
 *
 * @returns true when some unfinished sync's death is not provably before `atMs`
 */
function unfinishedMayEndAfter({ syncRuns, atMs }: { syncRuns: readonly SyncRunView[]; atMs: number }): boolean {
  return syncRuns.some((one) => {
    if (one.state !== "ended-unfinished") {
      return false;
    }
    if (one.startedAtIso === null) {
      return true;
    }
    const startMs = Date.parse(one.startedAtIso);
    const laterStarts = syncRuns
      .filter((other) => other !== one && other.source === one.source && other.startedAtIso !== null)
      .map((other) => Date.parse(other.startedAtIso!))
      .filter((ms) => ms > startMs);
    return Number.isNaN(startMs) || laterStarts.length === 0 || Math.min(...laterStarts) >= atMs;
  });
}

/**
 * Whether a run stamp written in the failure's own millisecond might belong to another run, so the failure is not
 * known to be last. Either its exit code says this failure could not have written it, or it names a slot
 * (`watermarkIso`, a running max) that is neither this failure's nor any readable firing's: a same-instant firing
 * whose own settle never reached the ledger. A held-back watermark naming a readable slot is only the
 * max, and proves nothing either way.
 *
 * @returns true when the stamp is not this failure's to claim
 */
function sameInstantStampUnclaimed({
  firings,
  last,
  run,
}: {
  firings: readonly FiringView[];
  last: FiringView;
  run: RecipeDefinitionRun | undefined;
}): boolean {
  if (run === undefined) {
    return false;
  }
  if (!wroteRunStampOf({ firing: last, run })) {
    return true;
  }
  // A firing still open in the ledger may have finished in this millisecond and stamped the run with its settle lost,
  // its slot hidden behind a newer watermark: the stamp is no proof this failure was last.
  if (firings.some((one) => one !== last && one.outcome === "open")) {
    return true;
  }
  return run.watermarkIso !== last.slotIso && !firings.some((one) => one.slotIso === run.watermarkIso);
}

/**
 * Whether a DEAD firing's place in end order is unknown. Its settle is when it was retired, never when it stopped
 * (`./runStats.ts`), so it really stopped somewhere between its start and that settle: any other firing that settled,
 * any sync that ended, or a run stamp written after it started may have finished after it. Its own stamp
 * is not one: a dead-letter retirement stamps the run at its settle with exit 1 (`slotDeadLetter.ts`), and a different
 * run stamping that same millisecond is `sameInstantStampUnclaimed`'s to refuse, checked first.
 *
 * @returns true when something else ended after the dead firing began, or its start does not parse
 */
function deadOrderUnknown({
  firings,
  last,
  run,
  syncRuns,
}: {
  firings: readonly FiringView[];
  last: FiringView;
  run: RecipeDefinitionRun | undefined;
  syncRuns: readonly SyncRunView[];
}): boolean {
  const startMs = Date.parse(last.startedAtIso);
  const ends = [
    ...firings.flatMap((one) => (one === last || one.settledAtIso === null ? [] : [Date.parse(one.settledAtIso)])),
    ...endedSyncsOf({ syncRuns }).map((one) => syncEndMs({ run: one })),
    ...(run === undefined || wroteRunStampOf({ firing: last, run }) ? [] : [Date.parse(run.lastRunAtIso)]),
  ];
  return Number.isNaN(startMs) || ends.some((ms) => ms >= startMs);
}

/**
 * The firing that finished last, while it failed or died, judged on end instants alone: a sync that ended after every
 * settled run is the last run, and no firing is; a run stamp later than every readable firing means the run that
 * finished last is not in the ledger.
 *
 * @returns the failed or dead firing that ended last with its end and the run stamp's instant, read once, or `null`
 */
function lastEndedFailure({
  firings,
  run,
  syncRuns,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
  syncRuns: readonly SyncRunView[];
}): { last: FiringView; firingEndMs: number; stampMs: number } | null {
  // An instant that does not parse orders nothing, so which run finished last is unknown and no sentence is named.
  const instants = [
    ...firings.flatMap((one) => (one.settledAtIso === null ? [] : [Date.parse(one.settledAtIso)])),
    ...syncRuns.map((one) => syncEndMs({ run: one })),
    ...(run === undefined ? [] : [Date.parse(run.lastRunAtIso)]),
  ];
  if (instants.some((ms) => Number.isNaN(ms))) {
    return null;
  }
  const last = finishedBySettleOf({ firings, run }).at(0);
  const firingEndMs = last === undefined ? Number.NEGATIVE_INFINITY : Date.parse(last.settledAtIso!);
  const stampMs = run === undefined ? Number.NEGATIVE_INFINITY : Date.parse(run.lastRunAtIso);
  const lastSync = endedSyncsOf({ syncRuns })[0];
  // A sync ending in the same millisecond is ambiguous, so it counts as last: no sentence on a tie.
  const syncEndedLast = lastSync !== undefined && syncEndMs({ run: lastSync }) >= Math.max(firingEndMs, stampMs);
  if (syncEndedLast || stampMs > firingEndMs) {
    return null;
  }
  if (last === undefined || (last.outcome !== "failed" && last.outcome !== "dead")) {
    return null;
  }
  return { firingEndMs, last, stampMs };
}

/**
 * Whether nothing else could have ended at or after the failure that looks last: no same-instant run stamp it cannot
 * claim, no other firing ending inside a dead firing's unknown window, no unfinished sync that may have died later,
 * and no other firing settled in the same millisecond.
 *
 * @returns true when the failure is provably the run that finished last
 */
function provablyAlone({
  firings,
  last,
  firingEndMs,
  stampMs,
  run,
  syncRuns,
}: {
  firings: readonly FiringView[];
  last: FiringView;
  firingEndMs: number;
  stampMs: number;
  run: RecipeDefinitionRun | undefined;
  syncRuns: readonly SyncRunView[];
}): boolean {
  if (stampMs === firingEndMs && sameInstantStampUnclaimed({ firings, last, run })) {
    return false;
  }
  if (last.outcome === "dead" && deadOrderUnknown({ firings, last, run, syncRuns })) {
    return false;
  }
  if (unfinishedMayEndAfter({ atMs: firingEndMs, syncRuns })) {
    return false;
  }
  // Another firing that settled in the same millisecond could as well be the run that finished last (the run stamp
  // tells a success from a failure, never one failure from another), so neither one's sentence speaks for the row.
  // Compared as instants, never as text: two spellings of one millisecond are a tie.
  return !firings.some(
    (one) => one !== last && one.settledAtIso !== null && Date.parse(one.settledAtIso) === firingEndMs,
  );
}

/**
 * What went wrong with the run that finished last, in one plain sentence, while that run failed or died: the sentence
 * the visible session that ran it (or, unwatched, the next one to pick its card up) recorded about that exact firing, or `null`. Nothing is read off the record's own
 * text: a failure is one free string, and a code's name or a status inside it can as easily deny the cause as name it,
 * so the one reader who knows why is the session that watched it fail. Which
 * run finished last is decided as the card's detail decides it (`lastEndedFailure`, `provablyAlone`).
 *
 * @param explanations each firing's sentence by `explanationKey`, as the visible sessions recorded them
 * @returns the sentence, or `null`
 */
export function plainlyOf({
  firings,
  run,
  syncRuns,
  explanations,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
  syncRuns: readonly SyncRunView[];
  explanations: ReadonlyMap<string, string>;
}): string | null {
  const ended = lastEndedFailure({ firings, run, syncRuns });
  if (ended === null || !provablyAlone({ ...ended, firings, run, syncRuns })) {
    return null;
  }
  const explanation = explanations.get(explanationKey(ended.last));
  if (explanation === undefined) {
    return null;
  }
  return explanation;
}
