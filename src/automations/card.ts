/**
 * One automation folded into the card the Automations page shows. Pure: every input is a row a store holds,
 * already read, and every field out is derived from one of them.
 *
 * Two readings here are the scheduler's, never this module's, because a page that judged a firing differently from
 * the dispatcher would be a second opinion nobody can act on. Whether the newest firing is held, abandoned, cooling
 * or settled is `judgeSlotAttempt`'s verdict, passed in. Whether the row has gone quiet is `silentRows`'s. Which of
 * those a card leads with is `./health.ts`'s.
 *
 * **Attempt history is what the ledger keeps, said as such.** The slot ledger holds one row per FIRING and a retry
 * overwrites it, so "twelve firings recorded" is a count of firings and their final stored outcomes — not of every
 * attempt ever made. The card says "firings recorded since", never "runs ever".
 */
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RecipeDueVerdict } from "../live/automation/definitionDue.js";
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { firingReason } from "../live/automation/firingReason.js";
import type { SilentRow } from "../live/automation/silentRows.js";
import type { RecipeSlotAttempt, RecipeSlotVerdict } from "../live/automation/slotAttempt.js";
import { type UnrunSlots, unrunSlotsOf } from "../live/automation/unrunSlots.js";
import type { ResyncState } from "../live/resync/outcome.js";
import type { SyncRunView } from "../syncRun/fold.js";
import { type BrokenAccount, brokenAccountOf } from "./brokenAccount.js";
import { historyAnswersOf, runAnswersOf, syncRunsSaidOf } from "./cardAnswers.js";
import { definitionFieldsOf, holdFieldsOf, lastRunOf, purposeFieldsOf } from "./cardFields.js";
import { type AutomationHealth, healthOf, nowDoingOf, standingHoldOf, waitingOnOf } from "./health.js";
import type { AutomationOutputs } from "./outputs.js";
import type { AutomationPurpose } from "./purpose.js";
import { type RunDuration, type RunReliability, runTimingOf } from "./runStats.js";
import type { AutomationSteering } from "./steering.js";

/** One firing's final stored state, as the ledger keeps it. */
export interface FiringView {
  readonly slotIso: string;
  readonly attempt: number;
  /** When the firing was taken — for a seated row, before its session exists. */
  readonly startedAtIso: string;
  /** When a seated row's session began its run, or `null` for a row run in-process or not begun. */
  readonly runStartedAtIso: string | null;
  readonly outcome: "open" | "succeeded" | "deferred" | "failed" | "dead";
  readonly settledAtIso: string | null;
  readonly detail: string | null;
  /** The detail cut to its reason (`firingReason`) — what a person reads; `null` when the firing carries none. */
  readonly reason: string | null;
  readonly exitCode: number | null;
}

/** The firings the ledger holds for one row, counted by final stored outcome. */
interface FiringTally {
  readonly recorded: number;
  /** The oldest firing still on disk — the count covers this instant onward. */
  readonly sinceIso: string | null;
  readonly succeeded: number;
  readonly failed: number;
  readonly deferred: number;
  readonly dead: number;
  readonly open: number;
  /**
   * How many scheduled times since the oldest recorded firing went by with no firing at all (`unrunSlotsOf`), or
   * `null` when nothing is recorded to count from, the ledger would not read whole, or the cadence will not parse.
   */
  readonly unrun: UnrunSlots | null;
}

/** What the newest resync attempt recorded, when the row is a resync. */
interface ResyncView {
  readonly lastAttemptAtIso: string | null;
  readonly lastOutcome: "succeeded" | "failed" | null;
  readonly lastSuccessAtIso: string | null;
  readonly problems: readonly string[];
  readonly beforeClock: string | null;
  readonly afterClock: string | null;
}

/** Everything the page says about one automation. */
export interface AutomationCard {
  readonly recipeId: string;
  /** Its plain name, or `null` when nothing in this build names it — the page then falls back to its id. */
  readonly name: string | null;
  /** What it is for, in one sentence, or `null` when nothing in this build says. */
  readonly forWhat: string | null;
  /** The five answers a broken or paused row owes the owner, or `null` for one that is neither. */
  readonly account: BrokenAccount | null;
  /** The board row whose fix lifts a standing failure hold, or `null` when none stands. */
  readonly fixRow: string | null;
  /**
   * Why it is paused: the owner's recorded reason when the hold carries their words naming it, else the hold's note quoted
   * under UNOWNED; `null` when no owner hold stands.
   */
  readonly pauseReason: string | null;
  /**
   * Whether the row is switched on, whenever it next runs: enabled, not disabled by the verdict, and not paused by
   * the owner. A standing fix hold leaves it on — the fleet's hold over a failure, not the owner's switch. What the
   * console's sidebar counts as an active automation: switched on, and pausing it stops it counting. Never read off {@link health}: a disabled
   * row cooling after a failed attempt reads `failed`, not `off`.
   */
  readonly switchedOn: boolean;
  readonly kind: string;
  readonly kindSummary: string | null;
  readonly effect: string;
  readonly destination: string;
  readonly cadence: string;
  /** What the row asks for, in its own words: an investigation's question, a verb's argv. */
  readonly what: string;
  readonly health: AutomationHealth;
  /** One sentence a person can act on, built from the rows. */
  readonly why: string;
  readonly nowDoing: string;
  /** Who or what the row is waiting on, or `null` when nothing is. */
  readonly waitingOn: string | null;
  readonly lastRunAtIso: string | null;
  readonly lastExitCode: number | null;
  /** When a firing of this row last settled as a success. */
  readonly lastSucceededIso: string | null;
  /** When a firing last failed or died, newest first — "last broke". */
  readonly lastBrokeIso: string | null;
  /**
   * When every firing on disk settled failed or dead, newest first. The page counts these past the moment the owner last
   * looked, so a failure is read there rather than pushed at them as a floating note.
   */
  readonly brokeAtIsos: readonly string[];
  readonly newestFailure: { readonly atIso: string; readonly detail: string } | null;
  readonly firings: FiringTally;
  /** How long it takes, read off its firings — `./runStats.ts`. */
  readonly duration: RunDuration;
  /**
   * The answer to "how long does it take?", in plain sentences — empty when the slot ledger did not read whole and
   * holds nothing to answer from, never a zero; {@link firingsGap} says why.
   */
  readonly durationWords: string;
  /** How often it works, read off its newest finished firings — `./runStats.ts`. */
  readonly reliability: RunReliability;
  /** The answer to "is a failure common?", in plain sentences — empty on the same terms as {@link durationWords}. */
  readonly reliabilityWords: string;
  /** Both answers in a few words, for a folded card, leaving out a half an unread ledger gives no evidence for. */
  readonly glanceWords: string;
  /**
   * The newest firings, each with its run time by the rule {@link duration} uses — `null` when not timed — and its
   * reason in plain words (`saidPlainlyOf`), what the timeline above the Technical detail fold quotes, and whether it
   * is the run under way (`underWayFiringOf`): an open firing behind a later finished run is not. A firing that failed
   * or died also carries what went wrong in one plain sentence, as the visible session that ran it explained that
   * firing, or `null` when none did.
   */
  readonly recentFirings: readonly (FiringView & {
    readonly plainly: string | null;
    readonly runMs: number | null;
    readonly said: string | null;
    readonly underWay: boolean;
  })[];
  /**
   * Why the firing history above may be missing rows — the slot ledger would not list, or a file in it would not
   * decode — or `null` when it read whole. The tally, the last break and the health then say so rather than read empty.
   */
  readonly firingsGap: string | null;
  /** Why its corpus source's sync runs would not read, or `null` when they read (or it syncs no corpus source). */
  readonly syncRunsGap: string | null;
  readonly resync: ResyncView | null;
  /** The corpus source this row syncs, when it is a corpus resync. */
  readonly syncSource: string | null;
  /** That source's newest runs from the sync-run ledger, newest first, each with its first error in plain words. */
  readonly syncRuns: readonly (SyncRunView & { readonly said: string | null })[];
  /** What each recent firing posted or filed, and the readings and floating notes the row left. */
  readonly outputs: AutomationOutputs;
  /** Every steer sent about the row, its answer, and the dated timeline from its earliest trace. */
  readonly steering: AutomationSteering;
}

/** One stored attempt as a firing view. */
function firingViewOf({ attempt }: { attempt: RecipeSlotAttempt }): FiringView {
  const { outcome } = attempt;
  if (outcome === null) {
    return {
      attempt: attempt.attempt,
      detail: null,
      exitCode: null,
      outcome: "open",
      reason: null,
      runStartedAtIso: attempt.runStartedAtIso,
      settledAtIso: null,
      slotIso: attempt.slotIso,
      startedAtIso: attempt.startedAtIso,
    };
  }
  const base = {
    attempt: attempt.attempt,
    runStartedAtIso: attempt.runStartedAtIso,
    settledAtIso: outcome.settledAtIso,
    slotIso: attempt.slotIso,
    startedAtIso: attempt.startedAtIso,
  };
  const { recipeId } = attempt;
  switch (outcome.kind) {
    case "succeeded":
      return { ...base, detail: null, exitCode: outcome.exitCode, outcome: "succeeded", reason: null };
    case "deferred": {
      const reason = firingReason({ detail: outcome.detail, recipeId });
      return { ...base, detail: outcome.detail, exitCode: null, outcome: "deferred", reason };
    }
    case "failed": {
      const reason = firingReason({ detail: outcome.detail, recipeId });
      return { ...base, detail: outcome.detail, exitCode: outcome.exitCode, outcome: "failed", reason };
    }
    case "dead": {
      const reason = `${outcome.reason}: ${firingReason({ detail: outcome.detail, recipeId })}`;
      return { ...base, detail: `${outcome.reason}: ${outcome.detail}`, exitCode: null, outcome: "dead", reason };
    }
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * Every stored firing of one row as a view, newest slot first — the order every card list reads in.
 *
 * @param attempts every firing row the ledger holds for the row, any order
 * @returns the views
 */
export function firingViewsOf({ attempts }: { attempts: readonly RecipeSlotAttempt[] }): FiringView[] {
  return attempts.toSorted((a, b) => b.slotIso.localeCompare(a.slotIso)).map((attempt) => firingViewOf({ attempt }));
}

/**
 * Count firings by final stored outcome, and the scheduled times between them that never ran — the unrun count only
 * when the ledger read whole, since a missing firing row would read as a skipped time.
 */
function tallyFirings({
  firings,
  cadence,
  firingsGap,
  nowIso,
}: {
  firings: readonly FiringView[];
  cadence: string;
  firingsGap: string | null;
  nowIso: string;
}): FiringTally {
  const count = ({ outcome }: { outcome: FiringView["outcome"] }): number =>
    firings.filter((firing) => firing.outcome === outcome).length;
  const oldest = firings.at(-1);
  const slotIsos = firings.map((firing) => firing.slotIso);
  return {
    dead: count({ outcome: "dead" }),
    deferred: count({ outcome: "deferred" }),
    failed: count({ outcome: "failed" }),
    open: count({ outcome: "open" }),
    recorded: firings.length,
    sinceIso: oldest === undefined ? null : oldest.slotIso,
    succeeded: count({ outcome: "succeeded" }),
    unrun: firingsGap === null ? unrunSlotsOf({ cadence, nowIso, slotIsos }) : null,
  };
}

/** The resync record as the card shows it. */
function resyncViewOf({ state }: { state: ResyncState | undefined }): ResyncView | null {
  if (state === undefined) {
    return null;
  }
  const last = state.lastAttempt;
  return {
    afterClock: last === null ? null : last.afterClock,
    beforeClock: last === null ? null : last.beforeClock,
    lastAttemptAtIso: last === null ? null : last.finishedAtIso,
    lastOutcome: last === null ? null : last.outcome,
    lastSuccessAtIso: state.lastSuccessAtIso,
    problems: last === null ? [] : last.problems,
  };
}

/** Everything one card is folded from, each read once by `./read.ts`. */
interface CardInputs {
  /** What its recent firings produced, from `./outputs.ts`. */
  outputs: AutomationOutputs;
  /** Its steers and timeline, from `./steering.ts`. */
  steering: AutomationSteering;
  /** The row as the lifted view reads it. */
  definition: RecipeDefinition;
  /** The kind's one-line summary, or `null` for a kind this build does not register. */
  kindSummary: string | null;
  /** Its plain name and what it is for, from `./purpose.ts`. */
  purpose: AutomationPurpose | null;
  /** The due verdict for the row. */
  verdict: RecipeDueVerdict;
  /** The row's newest run stamp, when it has one. */
  run: RecipeDefinitionRun | undefined;
  /** Why the run stamps file would not read, or `null` when it read. */
  runsGap: string | null;
  /** Every firing row the ledger holds for it, any order. */
  attempts: readonly RecipeSlotAttempt[];
  /** Why the ledger may be missing some of its firings, or `null` when it read whole. */
  firingsGap: string | null;
  /** The scheduler's verdict on the newest firing, or `null` when it has none. */
  slotVerdict: RecipeSlotVerdict | null;
  /** The silence reading for this row, when it is silent. */
  silent: SilentRow | undefined;
  /** Its resync record, when it is a resync row. */
  resync: ResyncState | undefined;
  /** Its corpus source's newest runs, newest first — empty for anything else. */
  syncRuns: readonly SyncRunView[];
  /** Why those runs would not read, or `null` when they read. */
  syncRunsGap: string | null;
  /** The instant the report reads at, up to which unrun scheduled times are counted. */
  nowIso: string;
  /** What a visible session said went wrong with each of its firings (`automation explain`). */
  explanations: ReadonlyMap<string, string>;
}

/** The account a card leads with when it is broken or stopped, from `./brokenAccount.ts`. */
function cardAccountOf({
  inputs,
  firings,
  health,
  hold,
}: {
  inputs: CardInputs;
  firings: readonly FiringView[];
  health: AutomationHealth;
  hold: ReturnType<typeof standingHoldOf>;
}): BrokenAccount | null {
  return brokenAccountOf({
    explanations: inputs.explanations,
    firings,
    health,
    historyGaps: [inputs.firingsGap, inputs.syncRunsGap, inputs.runsGap],
    hold,
    purpose: inputs.purpose,
    recipeId: inputs.definition.recipeId,
    resync: inputs.resync,
    run: inputs.run,
    silent: inputs.silent,
    slotVerdict: inputs.slotVerdict,
    syncRuns: inputs.syncRuns,
  });
}

/**
 * Fold one automation's rows into its card.
 *
 * @param inputs every reading the card is folded from, each field described on `CardInputs`
 * @returns the card
 */
export function automationCard(inputs: CardInputs): AutomationCard {
  const { explanations, definition, kindSummary, purpose, verdict, run, attempts, firingsGap } = inputs;
  const { slotVerdict, silent, resync, syncRuns, syncRunsGap, outputs, steering, nowIso } = inputs;
  const firings = firingViewsOf({ attempts });
  const latest = firings[0];
  const runningSync = syncRuns.find((view) => view.state === "running");
  const hold = standingHoldOf({ definition });
  const waitingOn = waitingOnOf({ latest, resync });
  const healthInputs = { definition, firingsGap, hold, latest, runningSync, silent, slotVerdict, verdict, waitingOn };
  const { health, why } = healthOf(healthInputs);
  const account = cardAccountOf({ firings, health, hold, inputs });
  const tally = tallyFirings({ cadence: definition.cadence, firings, firingsGap, nowIso });
  const timing = runTimingOf({ definition });
  return {
    account,
    ...historyAnswersOf({ firings, run }),
    ...definitionFieldsOf({ definition, hold, verdict }),
    firings: tally,
    firingsGap,
    health,
    kindSummary,
    ...lastRunOf({ run }),
    ...purposeFieldsOf({ purpose }),
    nowDoing: nowDoingOf({ hold, latest, runningSync, slotVerdict, verdict }),
    outputs,
    ...holdFieldsOf({ hold, recipeId: definition.recipeId }),
    ...runAnswersOf({
      explanations,
      firings,
      historyComplete: firingsGap === null,
      nowIso,
      run,
      skipped: tally.unrun,
      timing,
    }),
    resync: resyncViewOf({ state: resync }),
    steering,
    syncRuns: syncRunsSaidOf({ syncRuns }),
    syncRunsGap,
    waitingOn,
    why,
  };
}
