/**
 * The plain-words answers one card carries about its runs: when it last worked and broke, how long it takes, how
 * often it works, the recent-runs timeline, and what each sync run said. Pure — folded from rows `./card.ts` has already read, by the rules in
 * `./runStats.ts` and `./brokenAccount.ts`.
 */
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { explanationKey } from "../live/automation/failureExplanation.js";
import type { UnrunSlots } from "../live/automation/unrunSlots.js";
import type { SyncRunView } from "../syncRun/fold.js";
import type { AutomationCard, FiringView } from "./card.js";
import {
  durationWords,
  finishedBySettleOf,
  firingRunMsOf,
  glanceWords,
  type RunTiming,
  reliabilityWords,
  runDurationOf,
  runReliabilityOf,
  underWayFiringOf,
} from "./runStats.js";
import { saidPlainlyOf } from "./saidPlainly.js";

/** How many of a row's newest firings the card lists. */
export const RECENT_FIRINGS = 10;

/**
 * When the row last worked and when it broke, each by when a firing SETTLED and never by its slot: two firings can
 * finish in either order.
 *
 * @param firings every firing the ledger holds for the row, newest slot first
 * @param run its run stamp, which breaks a same-millisecond tie
 * @returns every break newest first, the newest one's own detail, and the last break and last success
 */
export function historyAnswersOf({
  firings,
  run,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
}): Pick<AutomationCard, "brokeAtIsos" | "lastBrokeIso" | "lastSucceededIso" | "newestFailure"> {
  const finished = finishedBySettleOf({ firings, run });
  const broken = finished.filter((firing) => firing.outcome === "failed" || firing.outcome === "dead");
  const succeeded = finished.find((firing) => firing.outcome === "succeeded");
  const newest = broken[0];
  return {
    brokeAtIsos: broken.map((firing) => firing.settledAtIso!),
    lastBrokeIso: newest === undefined ? null : newest.settledAtIso,
    lastSucceededIso: succeeded === undefined ? null : succeeded.settledAtIso,
    newestFailure: newest === undefined ? null : { atIso: newest.settledAtIso!, detail: String(newest.detail) },
  };
}

/**
 * What went wrong with one firing that failed or died, in one plain sentence: the one the visible session that ran it
 * recorded about that exact firing, or `null` for a firing that did not fail or that no session explained. Never read
 * off the record's own text (`./brokenAccount.ts` § plainlyOf says why).
 */
function firingPlainlyOf({
  firing,
  explanations,
}: {
  firing: FiringView;
  explanations: ReadonlyMap<string, string>;
}): string | null {
  if (firing.outcome !== "failed" && firing.outcome !== "dead") {
    return null;
  }
  const explanation = explanations.get(explanationKey(firing));
  if (explanation === undefined) {
    return null;
  }
  return explanation;
}

/**
 * The card's answers to "how long does it take?" and "is a failure common?", and the timeline under them.
 *
 * @param firings every firing the ledger holds for the row, newest slot first
 * @param run its run stamp, which breaks a same-millisecond tie
 * @param timing where its time is measured from
 * @param historyComplete whether the slot ledger read whole, so no answer claims a zero an unread ledger may hide
 * @param skipped the scheduled times that went by with no firing, as the card's tally counted them
 * @param nowIso the instant a run under way is timed to
 * @param explanations what a visible session said went wrong, per firing (`explanationKey`)
 * @returns the readings, their sentences, the glance and the recent firings
 */
export function runAnswersOf({
  firings,
  run,
  timing,
  historyComplete,
  skipped,
  nowIso,
  explanations,
}: {
  firings: readonly FiringView[];
  run: RecipeDefinitionRun | undefined;
  timing: RunTiming;
  historyComplete: boolean;
  skipped: UnrunSlots | null;
  nowIso: string;
  explanations: ReadonlyMap<string, string>;
}): Pick<
  AutomationCard,
  "duration" | "durationWords" | "glanceWords" | "recentFirings" | "reliability" | "reliabilityWords"
> {
  const duration = runDurationOf({ firings, run, timing });
  const reliability = runReliabilityOf({ firings, historyComplete, run, skipped });
  const underWay = underWayFiringOf({ firings });
  return {
    duration,
    durationWords: durationWords({ duration, historyComplete, nowIso }),
    glanceWords: glanceWords({ duration, reliability }),
    recentFirings: firings.slice(0, RECENT_FIRINGS).map((firing) => ({
      ...firing,
      plainly: firingPlainlyOf({ explanations, firing }),
      runMs: firingRunMsOf({ firing, nowIso, timing, underWay }),
      // An abandoned run said nothing: its reason is the scheduler's bookkeeping about the attempt, which stays in
      // Technical detail, and the timeline's own headline already says it died.
      said: firing.outcome === "dead" ? null : saidPlainlyOf({ raw: firing.reason }),
      // An open firing behind a later run that finished is not under way, so the timeline never calls it Running.
      underWay: firing === underWay,
    })),
    reliability,
    reliabilityWords: reliabilityWords({ reliability }),
  };
}

/**
 * What a sync run that did not finish said, in plain words: its first error without the runner's framing, else what
 * became of a run killed part way, else `null`. Never the fold's `why`, which carries instants, a pid and the raw
 * error — the record the Technical detail fold holds.
 */
function syncRunSaid({ view }: { view: SyncRunView }): string | null {
  const first = view.errors.at(0);
  const said = first === undefined ? null : saidPlainlyOf({ raw: first });
  if (said !== null) {
    return said;
  }
  if (view.state === "ended-unfinished") {
    return "It was stopped or crashed before it finished; the next refresh reads the same window again.";
  }
  return null;
}

/**
 * Each of a source's sync runs with what it said in plain words.
 *
 * @param syncRuns the source's newest runs, newest first
 * @returns the same runs, each carrying its words
 */
export function syncRunsSaidOf({ syncRuns }: { syncRuns: readonly SyncRunView[] }): AutomationCard["syncRuns"] {
  return syncRuns.map((view) => ({ ...view, said: syncRunSaid({ view }) }));
}
