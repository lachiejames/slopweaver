/**
 * HOW LONG A ROW TAKES, AND HOW OFTEN IT WORKS — two of the three questions the owner asks the Automations page
 * (how long a row like Gmail takes, whether a failure like a Slack history sync failing is common). Pure: every number is
 * read off the firings the slot ledger keeps, and every sentence is built here so the page and the terminal say
 * the same thing.
 *
 * **What is timed, and from when, depends on where the row runs** (`../live/automation/definitionShape.ts`):
 *
 * - **run-here** — the firing is taken and run in one process, so take → settle IS the run.
 * - **resync** — seated in a session, whose run is stamped `runStartedAtIso` when it begins; run start → settle
 *   is the sync. Take → settle would add the wait for a seat — MEASURED up to 8,552s on a 2s run.
 * - **every other seated kind** hands its work to a session whose own time nothing records, so it is NOT TIMED
 *   and says so. MEASURED: `inbox-triage-daily` settles 2–12s after its run starts, which is the
 *   worklist being read, never the triage — a number that would answer "how long" wrongly. Repro: read
 *   `$SLOPWEAVER_HOME/ledgers/automation/slot-attempts/` through `readAllAttempts` and subtract.
 *
 * A dead firing's settle is when it was retired, never when it stopped, and a deferred one never ran — neither is a
 * duration. A failed run is the LAST run when it is newest, said as failing after so long, but never part of what is
 * usual.
 */
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { runShapeForDefinition } from "../live/automation/definitionShape.js";
import { RESYNC_KIND } from "../live/automation/kinds.js";
import type { UnrunSlots } from "../live/automation/unrunSlots.js";
import type { FiringView } from "./card.js";

/** How many of a row's newest timed successes "usually takes" is the median of, and how many outcomes a rate reads. */
const RUN_STATS_WINDOW = 10;

/** Where a row's time is measured from, or that it is not measured at all. */
export type RunTiming = "taken" | "run-started" | "hand-off";

/** One finished run's measured span. */
interface TimedRun {
  readonly ms: number;
  readonly outcome: "succeeded" | "failed";
  readonly settledAtIso: string;
}

/** How long a row takes, read off its firings. */
export interface RunDuration {
  readonly timing: RunTiming;
  /** The newest finished run that was timed, or `null` when none was. */
  readonly last: TimedRun | null;
  /**
   * Whether {@link last} is the run that finished last. `false` when a newer one was abandoned or went untimed, so the
   * words call it "the last timed run" and never "the last run".
   */
  readonly lastIsNewest: boolean;
  /** The median of the newest timed successes, or `null` with fewer than two to take it over. */
  readonly typicalMs: number | null;
  /** How many timed successes {@link typicalMs} is the median of. */
  readonly typicalSamples: number;
  /** When the run under way began, or `null` when none is under way (or the row is not timed). */
  readonly runningSinceIso: string | null;
  /** When a seated firing was taken whose session has not begun its run, or `null` when none waits. */
  readonly waitingSinceIso: string | null;
}

/** How often a row works, read off its newest finished firings. */
export interface RunReliability {
  /** How many of the newest finished firings (worked, failed or abandoned) the rate reads — at most the window. */
  readonly considered: number;
  /** Of those, how many worked. */
  readonly worked: number;
  /** Scheduled times since the oldest recorded firing that went by with no firing, or `null` when not counted. */
  readonly skipped: UnrunSlots | null;
  /** Whether the firing history read whole; when it did not, a firing may be missing from the rate. */
  readonly historyComplete: boolean;
}

/**
 * A duration in whole units a person reads at a glance. Elapsed, never projected.
 *
 * @param ms the span, in milliseconds
 * @returns `45s`, `12m` or `3h`
 */
export function spanWords({ ms }: { ms: number }): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${String(minutes)}m`;
  }
  return `${String(Math.round(minutes / 60))}h`;
}

/**
 * Where this row's run time is measured from.
 *
 * @param definition the row
 * @returns `taken` for a row run in this process, `run-started` for a resync, `hand-off` for every other seated row
 */
export function runTimingOf({ definition }: { definition: RecipeDefinition }): RunTiming {
  if (runShapeForDefinition({ definition }) === "run-here") {
    return "taken";
  }
  if (definition.kind === RESYNC_KIND) {
    return "run-started";
  }
  return "hand-off";
}

/** When this firing's run began, by the row's timing — `null` when it never began or the row is not timed. */
function runStartOf({ firing, timing }: { firing: FiringView; timing: RunTiming }): string | null {
  if (timing === "taken") {
    return firing.startedAtIso;
  }
  if (timing === "run-started") {
    return firing.runStartedAtIso;
  }
  return null;
}

/** One firing's run as a timed span, or `null` when it is not one: unfinished, abandoned, deferred or unstamped. */
function timedRunOf({ firing, timing }: { firing: FiringView; timing: RunTiming }): TimedRun | null {
  const start = runStartOf({ firing, timing });
  if (start === null || firing.settledAtIso === null) {
    return null;
  }
  if (firing.outcome !== "succeeded" && firing.outcome !== "failed") {
    return null;
  }
  const ms = Date.parse(firing.settledAtIso) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }
  return { ms, outcome: firing.outcome, settledAtIso: firing.settledAtIso };
}

/**
 * The firing whose run is under way: the newest open one, unless a newer firing has since run to an end. An open
 * firing behind a newer finished run is a record nothing settled, never a run still going — MEASURED:
 * `bump-drive-acme-admin` carried an open firing from weeks earlier under 77 later successes and read "Running now, 326h so
 * far". Repro: `slopweaver automation status --json` and compare a card's `recentFirings` order. A newer DEFERRED
 * firing does not end it, since a run holding its lock is exactly what defers the next slot.
 *
 * @param firings every firing the ledger holds for the row, newest slot first
 * @returns the firing under way, or `null` when none is
 */
export function underWayFiringOf({ firings }: { firings: readonly FiringView[] }): FiringView | null {
  for (const firing of firings) {
    if (firing.outcome === "open") {
      return firing;
    }
    // Dead is finished too, exactly as the rate counts it.
    if (firing.outcome === "succeeded" || firing.outcome === "failed" || firing.outcome === "dead") {
      return null;
    }
  }
  return null;
}

/**
 * One firing's run time by the same rule as {@link runDurationOf}, so a timeline bullet never disagrees with the
 * answer above it: a finished run's span, the run under way's time so far, else `null` — not timed, never began,
 * abandoned, deferred, or open but not the one under way.
 *
 * @param timing where the row's time is measured from
 * @param nowIso the page's reading instant, for a run under way
 * @param underWay the row's firing under way, from {@link underWayFiringOf}
 * @returns milliseconds, or `null`
 */
export function firingRunMsOf({
  firing,
  timing,
  nowIso,
  underWay,
}: {
  firing: FiringView;
  timing: RunTiming;
  nowIso: string;
  underWay: FiringView | null;
}): number | null {
  if (firing.outcome === "open") {
    if (firing !== underWay) {
      return null;
    }
    const start = runStartOf({ firing, timing });
    if (start === null) {
      return null;
    }
    return Math.max(0, Date.parse(nowIso) - Date.parse(start));
  }
  const run = timedRunOf({ firing, timing });
  return run === null ? null : run.ms;
}

/** The middle value of a non-empty list, the mean of the two middle ones for an even count. */
function medianOf({ values }: { values: readonly number[] }): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Whether this firing wrote the run stamp: it settled at the stamp's instant and stamps the stamp's exit code — a
 * success its own, anything else 1 (`../cli/commands/automation/slotSettle.ts`'s `retiredExitCode`) — and, for a dead
 * firing's stamp, is the slot that stamp names. What breaks a tie between two firings that settled in the same
 * millisecond.
 *
 * @param run the row's run stamp, absent when the row has never run
 * @returns `true` only for the firing the stamp was written for
 */
export function wroteRunStampOf({
  firing,
  run,
}: {
  firing: FiringView;
  run: RecipeDefinitionRun | undefined;
}): boolean {
  if (run === undefined || firing.settledAtIso !== run.lastRunAtIso) {
    return false;
  }
  // A dead firing's stamp names its own slot, so no other slot's firing wrote it, whatever instant it shares.
  if (run.failureSlotIso !== undefined && firing.slotIso !== run.failureSlotIso) {
    return false;
  }
  const stamped = firing.outcome === "succeeded" ? firing.exitCode : 1;
  return stamped === run.exitCode;
}

/**
 * The firings that ran to an end — worked, failed or abandoned — newest SETTLED first. Two firings can finish in
 * either order (`../live/automation/definitionRunStore.ts`), so "the last run" is the one that finished last, never
 * the newest slot. Two can settle in the same millisecond, so a tie goes to the one that wrote the run
 * stamp — it settled at the stamp's instant and stamps its exit code, a success its own and anything else 1 — and
 * otherwise keeps slot order.
 *
 * @param firings every firing the ledger holds for the row, newest slot first
 * @param run the row's run stamp, which names the run written last; absent when the row has never run
 * @returns the finished ones, the most recently settled first
 */
export function finishedBySettleOf({
  firings,
  run,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
}): FiringView[] {
  const wroteStamp = (firing: FiringView): number => (wroteRunStampOf({ firing, run }) ? 1 : 0);
  return firings
    .filter(
      (firing) =>
        firing.settledAtIso !== null &&
        (firing.outcome === "succeeded" || firing.outcome === "failed" || firing.outcome === "dead"),
    )
    .toSorted((a, b) => Date.parse(b.settledAtIso!) - Date.parse(a.settledAtIso!) || wroteStamp(b) - wroteStamp(a));
}

/**
 * How long this row takes.
 *
 * @param firings every firing the ledger holds for it, newest slot first
 * @param run its run stamp, which breaks a same-millisecond tie ({@link finishedBySettleOf})
 * @param timing where its time is measured from, from {@link runTimingOf}
 * @returns the reading — "last" and "usual" read the runs that finished most recently
 */
export function runDurationOf({
  firings,
  run,
  timing,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
  timing: RunTiming;
}): RunDuration {
  const finished = finishedBySettleOf({ firings, run });
  const newestFinished = finished[0];
  const timed = finished.flatMap((firing) => {
    const timedRun = timedRunOf({ firing, timing });
    return timedRun === null ? [] : [timedRun];
  });
  const typical = timed
    .filter((timedRun) => timedRun.outcome === "succeeded")
    .slice(0, RUN_STATS_WINDOW)
    .map((timedRun) => timedRun.ms);
  const open = underWayFiringOf({ firings });
  let runningSinceIso: string | null = null;
  let waitingSinceIso: string | null = null;
  if (open !== null && timing !== "hand-off") {
    runningSinceIso = runStartOf({ firing: open, timing });
    if (runningSinceIso === null) {
      waitingSinceIso = open.startedAtIso;
    }
  }
  let last: TimedRun | null = null;
  if (timed[0] !== undefined) {
    last = timed[0];
  }
  return {
    last,
    lastIsNewest: newestFinished !== undefined && timedRunOf({ firing: newestFinished, timing }) !== null,
    runningSinceIso,
    timing,
    typicalMs: typical.length >= 2 ? medianOf({ values: typical }) : null,
    typicalSamples: typical.length,
    waitingSinceIso,
  };
}

/**
 * How often this row works.
 *
 * @param firings every firing the ledger holds for it, newest slot first
 * @param run its run stamp, which breaks a same-millisecond tie ({@link finishedBySettleOf})
 * @param skipped the scheduled times that went by with no firing, as the card's tally counted them
 * @param historyComplete whether the firing history read whole
 * @returns the reading
 */
export function runReliabilityOf({
  firings,
  run,
  skipped,
  historyComplete,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
  skipped: UnrunSlots | null;
  historyComplete: boolean;
}): RunReliability {
  const finished = finishedBySettleOf({ firings, run }).slice(0, RUN_STATS_WINDOW);
  return {
    considered: finished.length,
    historyComplete,
    skipped,
    worked: finished.filter((firing) => firing.outcome === "succeeded").length,
  };
}

/** What the run under way, or the seat being waited for, adds ahead of the answer — nothing when neither. */
function underWayWords({ duration, nowIso }: { duration: RunDuration; nowIso: string }): string {
  if (duration.runningSinceIso !== null) {
    const ms = Math.max(0, Date.parse(nowIso) - Date.parse(duration.runningSinceIso));
    return `Running now, ${spanWords({ ms })} so far. `;
  }
  if (duration.waitingSinceIso !== null) {
    const ms = Math.max(0, Date.parse(nowIso) - Date.parse(duration.waitingSinceIso));
    return `Waiting ${spanWords({ ms })} so far for its session to start. `;
  }
  return "";
}

/**
 * The answer to "how long does it take?", in one or two plain sentences. Over a history that did not read whole, no
 * timed run is no evidence of none, so that half is left unsaid — a reader shows the ledger's staleness instead.
 *
 * @param duration the reading
 * @param nowIso the instant the page reads at, for a run under way
 * @param historyComplete whether the firing history read whole
 * @returns the sentences, empty when an unread history leaves nothing to say
 */
export function durationWords({
  duration,
  nowIso,
  historyComplete,
}: {
  duration: RunDuration;
  nowIso: string;
  historyComplete: boolean;
}): string {
  if (duration.timing === "hand-off") {
    return "Not timed: it hands its work to a session, and that session's time is not recorded.";
  }
  const ahead = underWayWords({ duration, nowIso });
  const { last, lastIsNewest, typicalMs } = duration;
  if (last === null && !historyComplete) {
    return ahead.trimEnd();
  }
  if (last === null) {
    return `${ahead}No run has finished yet to time.`;
  }
  const which = lastIsNewest ? "the last run" : "the last timed run";
  let lastWords = `${which} took ${spanWords({ ms: last.ms })}`;
  if (last.outcome === "failed") {
    lastWords = `${which} failed after ${spanWords({ ms: last.ms })}`;
  }
  if (typicalMs === null) {
    return `${ahead}${capitalised({ text: lastWords })}; too few runs have worked to say what is usual.`;
  }
  return `${ahead}Usually takes ${spanWords({ ms: typicalMs })}; ${lastWords}.`;
}

/** How many of its recent finished runs worked, as one sentence. */
function rateSentence({ reliability }: { reliability: RunReliability }): string {
  const { considered, worked } = reliability;
  if (considered === 0) {
    return "No run has finished yet.";
  }
  if (considered === 1) {
    return worked === 1 ? "Its one finished run worked." : "Its one finished run failed.";
  }
  if (worked === considered) {
    return `Worked every one of its last ${String(considered)} runs.`;
  }
  if (worked === 0) {
    return `Failed every one of its last ${String(considered)} runs.`;
  }
  return `Worked ${String(worked)} of its last ${String(considered)} runs.`;
}

/** How many scheduled times went by with no run, as one sentence. */
function skippedSentence({ skipped }: { skipped: UnrunSlots }): string {
  const floor = skipped.bound === "at-least" ? "at least " : "";
  const times = skipped.count === 1 ? "time" : "times";
  return `${capitalised({ text: `${floor}${String(skipped.count)}` })} scheduled ${times} passed with no run.`;
}

/**
 * The answer to "is a failure common?", in one or two plain sentences. Over a history that did not read whole, no
 * finished run is no evidence of none, so that sentence is left unsaid; the history's staleness is the reader's to
 * show beside what is said, never a sentence here.
 *
 * @param reliability the reading
 * @returns the sentences, empty when an unread history leaves nothing to say
 */
export function reliabilityWords({ reliability }: { reliability: RunReliability }): string {
  const { skipped, historyComplete, considered } = reliability;
  const parts: string[] = [];
  if (considered > 0 || historyComplete) {
    parts.push(rateSentence({ reliability }));
  }
  if (skipped !== null && skipped.count > 0) {
    parts.push(skippedSentence({ skipped }));
  }
  return parts.join(" ");
}

/**
 * Both answers at a glance, for a folded card: what is usual (else the last run), then the recent rate.
 *
 * @param duration the duration reading
 * @param reliability the reliability reading
 * @returns e.g. `usually 4m · 9/10 worked`; a half an unread history leaves no evidence for is left out
 */
export function glanceWords({ duration, reliability }: { duration: RunDuration; reliability: RunReliability }): string {
  const { historyComplete } = reliability;
  let took: string | undefined = "not timed";
  if (duration.typicalMs !== null) {
    took = `usually ${spanWords({ ms: duration.typicalMs })}`;
  } else if (duration.last !== null) {
    const which = duration.lastIsNewest ? "last" : "last timed";
    took = `${which} ${spanWords({ ms: duration.last.ms })}`;
  } else if (duration.timing !== "hand-off") {
    took = historyComplete ? "no timed run" : undefined;
  }
  let rate: string | undefined = historyComplete ? "no finished run" : undefined;
  if (reliability.considered > 0) {
    rate = `${String(reliability.worked)}/${String(reliability.considered)} worked`;
  }
  return [took, rate].filter((half) => half !== undefined).join(" · ");
}

/** The text with its first letter upper-cased. */
function capitalised({ text }: { text: string }): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}
