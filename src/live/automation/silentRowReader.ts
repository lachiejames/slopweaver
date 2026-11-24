/**
 * The EDGE that measures which standing recipe rows have gone quiet — the three-store join two readers share.
 *
 * It joins the recipe definitions, their run stamps and the slot ledger, and hands the result to
 * `./silentRows.ts` for the judgement. Two surfaces read it: the Fleet Briefing's gone-quiet gate
 * (`../../cli/commands/briefing/silentRowReader.ts`) and the `recipe-stopped` monitor
 * (`../../monitor/sources.ts`), which puts a floating note on the owner's screen when a row stops firing. The Automations
 * page (`../../automations/read.ts`) has already read all three stores for its cards, so it takes the judging half,
 * {@link silentRowsAmong}, over what it read rather than reading them again.
 *
 * ## Unreadable and clean are two different answers
 *
 * The earlier reader lived inside the briefing and answered the empty list for BOTH "every row is posting" and
 * "the run stamps would not open". The briefing can afford that — its gate can only ever add a refusal. A
 * monitor cannot: a monitor that reads "could not look" as "nothing is wrong" settles every open card and
 * then stays silent forever, which is exactly the silence this join exists to end. So an unreadable run-stamp
 * store is an `err`, a definition file that would not parse is carried in `rejected`, and each caller decides
 * what that means for its own surface.
 *
 * A `MISSED` row's detail is then explained from the supervisor's own tick ledger (`./supervisorStops.ts`): with no
 * clock behind it, a row stopped because no pass ran it, and the ledger says which passes saw it and what, if
 * anything, they recorded. That ledger failing to read is said in the detail and never turns this reading into an
 * `err` — whether the row stopped is already settled by the stores above.
 *
 * ## Off rows are excluded by the scheduler's own verdict
 *
 * A row is a candidate only when `judgeRecipeDue` gives it no `offReason`. That excludes a disabled row AND a
 * row under the owner's own uncleared hold, with the same precedence the scheduler applies, so a row the owner
 * has deliberately retired never reads as one that stopped on its own. A FAILURE hold — one naming a finding — is
 * set aside first: the store paused a broken row, and a broken row is exactly what this measure exists to see.
 */
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";

import type { RecipeDefinition } from "./definition.js";
import { judgeRecipeDue } from "./definitionDue.js";
import { type RecipeDefinitionRun, readRecipeDefinitionRuns } from "./definitionRunStore.js";
import { loadRecipeDefinitions } from "./definitionStore.js";
import { holderAliveFor, type ProcessAlive, recipeHolderAlive } from "./holderLiveness.js";
import { type CurrentSlotHold, type SilenceCandidate, type SilentRow, silentRows } from "./silentRows.js";
import { judgeSlotAttempt, type RecipeSlotAttempt, type RecipeSlotOutcome } from "./slotAttempt.js";
import { readSlotAttempt } from "./slotLedger.js";
import { steerFor } from "./steers.js";
import { explainSilentRows } from "./supervisorStops.js";

/** What one read of the recipe stores found. */
export interface SilentRecipeReading {
  /** How many definition files parsed, live or not — zero means there was nothing on disk to judge. */
  readonly definitions: number;
  /** How many of those are live: enabled and under no uncleared hold. */
  readonly eligibleRows: number;
  /** The live rows that have gone quiet past their own threshold, worst first. */
  readonly silent: readonly SilentRow[];
  /** Every definition file that could not become a row, as `<file>: <why>` — a row nobody can judge. */
  readonly rejected: readonly string[];
}

/**
 * One firing of one row, or `null` when nothing has attempted it or the ledger would not open.
 *
 * An unreadable ledger row reads as `null`, which costs the reason and the owner and never the signal: the row
 * still reports as silent and nobody's, with `MISSED` instead of the more specific answer. It reads the one
 * canonical file the scheduler itself reads, never a scan of the directory, so a body under any other name owns
 * nothing.
 *
 * @param home the state home whose slot ledger is read
 * @returns that firing's ledger row, or `null`
 */
export function storedSlotAttempt({
  home,
  recipeId,
  slotIso,
}: {
  home: string;
  recipeId: string;
  slotIso: string;
}): RecipeSlotAttempt | null {
  const stored = readSlotAttempt({ home, recipeId, slotIso });
  if (stored.isErr()) {
    return null;
  }
  return stored.value;
}

/**
 * How a row's current firing stands, read off its one ledger row: how it ended, and who holds it under a live lease.
 * The hold is the scheduler's own `held` verdict and nothing looser — an expired lease, a holder proved gone, or a
 * firing that settled all read `null`, so a firing nobody is running never reads as owned.
 *
 * @param stored the current firing's ledger row, or `null` when nothing has attempted it
 * @param processAlive the probe that says whether the row's holder process still runs
 * @param nowIso the instant its lease is judged at
 * @returns its outcome, and its live holder with the instant the attempt opened
 */
export function currentSlotReadingOf({
  stored,
  processAlive,
  nowIso,
}: {
  readonly stored: RecipeSlotAttempt | null;
  readonly processAlive: ProcessAlive;
  readonly nowIso: string;
}): { readonly currentSlotOutcome: RecipeSlotOutcome | null; readonly currentSlotHold: CurrentSlotHold | null } {
  if (stored === null) {
    return { currentSlotHold: null, currentSlotOutcome: null };
  }
  const verdict = judgeSlotAttempt({ holderAlive: holderAliveFor({ processAlive, stored }), nowIso, stored });
  const currentSlotHold =
    verdict.kind === "held" ? { holder: verdict.holder, startedAtIso: stored.startedAtIso } : null;
  return { currentSlotHold, currentSlotOutcome: stored.outcome };
}

/**
 * How the firing the run stamp describes ended: the one whose settle instant IS the stamp's, since a settle and its
 * stamp are written from one clock reading (`../../cli/commands/automation/slotSettle.ts`). The stamp keeps the
 * newest SLOT as its watermark but the exit code of the run that finished LAST, so a join by slot paired one
 * firing's exit code with another's outcome when two settled out of order.
 *
 * Two firings can settle in the same millisecond, so among those the one whose outcome stamps the stamp's own exit
 * code wins: whichever wrote the stamp last left its code there.
 *
 * @param attempts the row's firings, in any order
 * @param run the row's run stamp
 * @returns that firing's outcome, or `null` when no firing given settled at the stamp's instant
 */
export function stampedOutcomeOf({
  attempts,
  run,
}: {
  attempts: readonly RecipeSlotAttempt[];
  run: RecipeDefinitionRun;
}): RecipeSlotOutcome | null {
  const atStamp = attempts.flatMap((attempt) =>
    attempt.outcome !== null && attempt.outcome.settledAtIso === run.lastRunAtIso ? [attempt.outcome] : [],
  );
  const wroteIt = atStamp.find((outcome) => stampedExitCodeOf({ outcome }) === run.exitCode);
  if (wroteIt !== undefined) {
    return wroteIt;
  }
  const first = atStamp[0];
  if (first === undefined) {
    return null;
  }
  return first;
}

/** The exit code a retired outcome stamps: a success's own, else 1 — `slotSettle.ts`'s `retiredExitCode`. */
function stampedExitCodeOf({ outcome }: { outcome: RecipeSlotOutcome }): number {
  if (outcome.kind === "succeeded") {
    return outcome.exitCode;
  }
  return 1;
}

/**
 * The row as this measure judges it: a FAILURE hold set aside, the owner's own hold kept.
 *
 * A failure hold is the store pausing a row that broke, not a row the owner retired — so it must still read as
 * quiet once it stops posting, or the one signal a broken row gives would go dark the moment it was held.
 */
function failureHoldIgnored({ definition }: { definition: RecipeDefinition }): RecipeDefinition {
  if (definition.hold?.finding === undefined) {
    return definition;
  }
  return { ...definition, hold: undefined };
}

/**
 * Read every live standing row and say which have gone quiet, or why the stores could not be read.
 *
 * @param home the state home whose recipe store, run stamps and slot ledger are read
 * @param nowIso the instant every row's due-ness and period are judged at
 * @param processAlive the probe a held firing's holder is checked with — the real `kill(pid, 0)` unless a test passes one
 * @returns the reading, or one line per reason the run stamps could not be read
 */
export function readSilentRecipeRows({
  home,
  nowIso,
  processAlive = recipeHolderAlive,
}: {
  home: string;
  nowIso: string;
  processAlive?: ProcessAlive | undefined;
}): Result<SilentRecipeReading> {
  const paths = stateHomePaths({ home });
  // The STORED view: a failure hold is set aside whatever its finding says, and the owner's own hold never reads
  // the board, so the lifted view would cost a board read per held row and change nothing.
  const roster = loadRecipeDefinitions({ board: null, directory: paths.live.recipe.definitionsDir });
  const runs = readRecipeDefinitionRuns({ path: paths.live.recipe.definitionRunsJson });
  if (runs.isErr()) {
    return err(runs.error);
  }
  const among = silentRowsAmong({
    definitions: roster.definitions,
    nowIso,
    processAlive,
    runs: runs.value,
    slotAttemptFor: ({ recipeId, slotIso }) => storedSlotAttempt({ home, recipeId, slotIso }),
    // One file per firing under a hashed name, so only the watermark's firing is read here: a stamp written by an
    // older firing settling late matches nothing and reads as unknown, never as worked.
    stampedOutcomeFor: ({ recipeId, run }) => {
      const stored = readSlotAttempt({ home, recipeId, slotIso: run.watermarkIso });
      if (stored.isErr() || stored.value === null) {
        return null;
      }
      return stampedOutcomeOf({ attempts: [stored.value], run });
    },
  });
  return ok({
    definitions: roster.definitions.length,
    eligibleRows: among.eligibleRows,
    rejected: roster.rejected.map((rejected) => `${rejected.file}: ${rejected.error.message}`),
    silent: explainSilentRows({ home, rows: among.silent }).rows,
  });
}

/**
 * Judge which of some already-read rows have gone quiet — the pure half of {@link readSilentRecipeRows}, for a
 * caller that has read the definitions, run stamps and slot ledger once already and must not read them again.
 *
 * @param definitions the rows as stored; a failure hold is set aside here
 * @param runs every row's newest run stamp
 * @param nowIso the instant every row's due-ness and period are judged at
 * @param processAlive the probe a held firing's holder is checked with
 * @param slotAttemptFor one firing of one row, or `null` when nothing has attempted it or it will not read
 * @param stampedOutcomeFor how the firing a row's run stamp describes ended ({@link stampedOutcomeOf}), or `null`
 *   when it cannot be found
 * @returns how many rows are live, and the live rows that have gone quiet, worst first
 */
export function silentRowsAmong({
  definitions,
  runs,
  nowIso,
  processAlive,
  slotAttemptFor,
  stampedOutcomeFor,
}: {
  definitions: readonly RecipeDefinition[];
  runs: Readonly<Record<string, RecipeDefinitionRun>>;
  nowIso: string;
  processAlive: ProcessAlive;
  slotAttemptFor: (args: { recipeId: string; slotIso: string }) => RecipeSlotAttempt | null;
  stampedOutcomeFor: (args: { recipeId: string; run: RecipeDefinitionRun }) => RecipeSlotOutcome | null;
}): { eligibleRows: number; silent: readonly SilentRow[] } {
  const ids = definitions.map((definition) => definition.recipeId);
  const shared = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  const candidates = definitions.flatMap((definition) => {
    const candidate = silenceCandidateOf({
      definition,
      nowIso,
      processAlive,
      runs,
      slotAttemptFor,
      stampedOutcomeFor,
    });
    if (candidate === null) {
      return [];
    }
    // The slot ledger keys a firing by recipe id and slot alone, so a hold on an id two definitions share cannot
    // say whose firing it is: it owns neither, and both fall loud, as a supervisor hold on a shared id does
    if (shared.has(definition.recipeId)) {
      return [{ ...candidate, currentSlotHold: null }];
    }
    return [candidate];
  });
  return { eligibleRows: candidates.length, silent: silentRows({ candidates, nowIso }) };
}

/** One row as the silence measure reads it, or `null` when the row is off and so cannot go quiet. */
function silenceCandidateOf({
  definition,
  runs,
  nowIso,
  processAlive,
  slotAttemptFor,
  stampedOutcomeFor,
}: {
  definition: RecipeDefinition;
  runs: Readonly<Record<string, RecipeDefinitionRun>>;
  nowIso: string;
  processAlive: ProcessAlive;
  slotAttemptFor: (args: { recipeId: string; slotIso: string }) => RecipeSlotAttempt | null;
  stampedOutcomeFor: (args: { recipeId: string; run: RecipeDefinitionRun }) => RecipeSlotOutcome | null;
}): SilenceCandidate | null {
  const stored = runs[definition.recipeId];
  // Named with an `if` rather than coalesced: a row with no stamp has NEVER RUN, which is one of the
  // reasons this measure reports, and reading it as a substituted default is exactly what made a row
  // nobody had ever run indistinguishable from a healthy one.
  let run: RecipeDefinitionRun | null = null;
  if (stored !== undefined) {
    run = stored;
  }
  const verdict = judgeRecipeDue({ definition: failureHoldIgnored({ definition }), nowIso, run });
  if (verdict.offReason !== undefined) {
    return null;
  }
  const steer = steerFor({ definition });
  // One read of the current firing serves both its outcome and its holder.
  const current =
    verdict.slotIso === null ? null : slotAttemptFor({ recipeId: definition.recipeId, slotIso: verdict.slotIso });
  return {
    ...(steer === undefined ? {} : { steerId: steer.id }),
    ...currentSlotReadingOf({ nowIso, processAlive, stored: current }),
    cadence: definition.cadence,
    deferredSlotIso: verdict.deferredSlotIso,
    firingsSinceWatermark: verdict.firingsSinceWatermark,
    lastExitCode: run === null ? null : run.exitCode,
    lastRunSlotOutcome: run === null ? null : stampedOutcomeFor({ recipeId: definition.recipeId, run }),
    lastRunAtIso: verdict.lastRunAtIso,
    recipeId: definition.recipeId,
    reach: { destination: definition.destination.kind, effect: definition.effect, kind: definition.kind },
  };
}
