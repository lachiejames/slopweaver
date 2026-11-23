/**
 * One due row's REAL sequence under `automation run-due` — admit its firing, run the row, and settle what
 * happened — split out of `./runDue.ts` along that seam: the verb there parses, narrows, judges and reports a
 * tick, and everything here happens to exactly one row. {@link runDueRow} is the row's whole step, and asks
 * whether a standing ruling holds the row (`./runDueRulingGate.ts`) before anything else.
 *
 * The three acts are one sequence per row and the ORDER is the whole guarantee — take before the effect,
 * settle after it, and never stamp except as a consequence of settling. `./slotRun.ts` owns all three. A
 * run-here effect additionally runs under `./runDueSignal.ts`'s guard, so a caller's signal retires the
 * attempt `KILLED_BY_SIGNAL` instead of leaving it for the next tick to find abandoned.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { StandingGate } from "../../../handover/rulingGate.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import { type RecipeDefinitionRun, readRecipeDefinitionRuns } from "../../../live/automation/definitionRunStore.js";
import { runShapeForDefinition } from "../../../live/automation/definitionShape.js";
import type { RecipeSlotAttempt } from "../../../live/automation/slotAttempt.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type RecipeRunDueDeps, type RowOutcome, runOneRow } from "./rowRunners.js";
import { limitOutcome } from "./runDueLimit.js";
import { rulingHeldOutcome } from "./runDueRulingGate.js";
import type { RunDueSignalGuard, RunDueSignalTrap } from "./runDueSignal.js";
import { admitSeatedRow, carriedForwardOutcome, giveBackSeatNotDue, type RowAdmission } from "./seatedAdmission.js";
import type { SlotSettlement } from "./slotDeadLetter.js";
import { type SlotRunDeps, settleSlot, takeSlot } from "./slotRun.js";

/** What one whole pass over the due rows produced, including whether any STAMP failed to persist. */
export interface DueRowsOutcome {
  readonly outcomes: readonly RowOutcome[];
  /**
   * True when a row ran and its stamp could not be written.
   *
   * Reported as a tick FAILURE rather than a diagnostic alone: an unstamped row is still due, so the next
   * tick attempts it again — for an `alert-summary` row that is a second card, and a run that sent one and
   * exited clean would be the tick lying about it. The door's own duplicate protection is the last guard
   * for the send/crash window this cannot close; the exit code is what makes it visible at all.
   */
  readonly stampFailed: boolean;
}

/**
 * One due row's step, in the order that is the guarantee: a standing ruling, then `--limit`, then the dry run,
 * then admission. A row a ruling holds comes first, so it takes no `--limit` place, no firing and no stamp.
 *
 * @param gates the unexpired standing gates the tick read, asked about this row's own id
 * @param started how many rows this tick has started so far, which is what `--limit` counts
 * @param slotIso the firing this run covers
 * @returns the row's outcomes, whether a settlement failed to persist, and whether the row was started
 */
export async function runDueRow({
  claimId,
  definition,
  deps,
  dryRun,
  gates,
  home,
  limit,
  media,
  signalTrap,
  slotDeps,
  slotIso,
  started,
}: {
  claimId: string | null;
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  gates: readonly StandingGate[];
  home: string;
  limit: number | null;
  media: readonly string[];
  signalTrap: RunDueSignalTrap;
  slotDeps: SlotRunDeps;
  slotIso: string;
  started: number;
}): Promise<DueRowsOutcome & { readonly started: boolean }> {
  const held = rulingHeldOutcome({ gates, recipeId: definition.recipeId });
  if (held !== null) {
    return { outcomes: [held], stampFailed: false, started: false };
  }
  const overLimit = limitOutcome({ definition, limit, started });
  if (overLimit !== null) {
    return { outcomes: [overLimit], stampFailed: false, started: false };
  }
  // A DRY RUN never takes the firing. It withholds the effect, so consuming an attempt would spend one of
  // the three a real run gets on a rehearsal — and the firing must stay exactly as due as it was.
  if (dryRun) {
    const rehearsed = await runOneRowSafely({ definition, deps, dryRun, home, media, slotIso });
    return { outcomes: [rehearsed], stampFailed: false, started: true };
  }
  return admitRunAndSettle({ claimId, definition, deps, home, media, signalTrap, slotDeps, slotIso });
}

/**
 * One row's whole real sequence — admit the firing, run the row, settle what happened — and what it cost.
 *
 * @param claimId the token this process holds, which is what admits a spawn-shaped row
 * @param media the graded captures a seated session took for a shots row, empty on an ordinary tick
 * @param signalTrap the tick's trap a run-here effect is armed under; a seated row's attempt is never armed
 * @param slotIso the firing this run covers
 * @returns the row's outcomes, whether a settlement failed to persist, and whether the row was started
 */
export async function admitRunAndSettle({
  claimId,
  definition,
  deps,
  home,
  media,
  signalTrap,
  slotDeps,
  slotIso,
}: {
  claimId: string | null;
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  home: string;
  media: readonly string[];
  signalTrap: RunDueSignalTrap;
  slotDeps: SlotRunDeps;
  slotIso: string;
}): Promise<DueRowsOutcome & { readonly started: boolean }> {
  // A signal retirement already under way means this process has decided to exit: taking another firing now
  // would start an attempt the exit abandons. Wait on it instead — in production it never returns. Nothing
  // between this read and the run-here take below awaits, so no signal is dispatched in between.
  const retiring = signalTrap.retiring();
  if (retiring !== null) {
    await retiring;
    return { outcomes: [], stampFailed: false, started: false };
  }
  const gated = await admitRow({ claimId, definition, home, slotDeps, slotIso });
  if (gated.kind === "refused") {
    return { outcomes: [gated.outcome], stampFailed: gated.outcome.failed, started: false };
  }
  // Only a RUN-HERE attempt is this process's own to retire on a signal. A spawn-shaped row's attempt was
  // taken by the seat that opened this session, and it belongs to that seat rather than to this effect.
  let trapped: RunDueSignalTrap | null = null;
  if (runShapeForDefinition({ definition }) !== "spawn") {
    trapped = signalTrap;
  }
  const ran = await runAndSettle({
    attempt: gated.attempt,
    carriedFrom: gated.carriedFrom,
    definition,
    deps,
    home,
    media,
    signalTrap: trapped,
    slotDeps,
    slotIso,
  });
  return { ...ran, started: true };
}

/**
 * Run one admitted row and settle the firing it holds — the two acts that always happen together.
 *
 * Settling is NOT conditional on the row having reached its verb. A row that refused its own plan has
 * failed this attempt at this firing exactly as a row whose verb exited 1 has, and both must come back:
 * that is what _"if it fails then it's picked up again"_ means. The attempt count on the record is what
 * keeps coming back bounded.
 *
 * A run-here effect runs under `./runDueSignal.ts`'s guard: a SIGHUP, SIGINT or SIGTERM arriving while it
 * runs retires the attempt `KILLED_BY_SIGNAL` and exits, and that retirement REPLACES the ordinary
 * settlement — settling it afterwards would overwrite the dead letter with whatever the killed effect
 * happened to return.
 *
 * @param attempt the attempt this process holds on the firing
 * @param carriedFrom the firing the seat took, when this session was moved off it, so the transcript says so
 * @param definition the row to run
 * @param deps the injected edges
 * @param home the state home this tick is running over
 * @param media the graded captures a seated session took for a shots row, empty on an ordinary tick
 * @param signalTrap the tick's trap a run-here effect is armed under, or `null` for a seated row's attempt
 * @param slotDeps the take/settle edges
 * @param slotIso the firing this run covers
 * @returns the run's outcome and the settlement's, and whether anything failed to persist
 */
async function runAndSettle({
  attempt,
  carriedFrom,
  definition,
  deps,
  home,
  media,
  signalTrap,
  slotDeps,
  slotIso,
}: {
  attempt: RecipeSlotAttempt;
  carriedFrom: string | null;
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  home: string;
  media: readonly string[];
  signalTrap: RunDueSignalTrap | null;
  slotDeps: SlotRunDeps;
  slotIso: string;
}): Promise<DueRowsOutcome> {
  const carried = carriedFrom === null ? [] : [carriedForwardOutcome({ carriedFrom, definition, slotIso })];
  let guard: RunDueSignalGuard | null = null;
  if (signalTrap !== null) {
    guard = signalTrap.arm({ attempt, definition, deps: slotDeps, home });
  }
  try {
    const outcome = await runOneRowSafely({ definition, deps, dryRun: false, home, media, slotIso });
    const settlement = await settleUnlessKilled({ attempt, definition, guard, home, outcome, slotDeps });
    return {
      outcomes: [
        ...carried,
        outcome,
        {
          detail: [],
          exitCode: null,
          failed: settlement.failed,
          line: settlement.line,
          ran: false,
          recipeId: definition.recipeId,
        },
      ],
      stampFailed: settlement.failed,
    };
  } finally {
    if (guard !== null) {
      guard.disarm();
    }
  }
}

/**
 * The ordinary settlement of a finished effect — or, when a signal was dispatched while it ran, the retirement
 * that signal already started, and nothing else. Settling after a signal would overwrite `KILLED_BY_SIGNAL` with
 * whatever the interrupted effect returned.
 */
async function settleUnlessKilled({
  attempt,
  definition,
  guard,
  home,
  outcome,
  slotDeps,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  guard: RunDueSignalGuard | null;
  home: string;
  outcome: RowOutcome;
  slotDeps: SlotRunDeps;
}): Promise<SlotSettlement> {
  // Synchronous from the effect resolving to the choice, so no signal is dispatched in between: one dispatched
  // before it interrupted a running effect, one after it waits for the settlement.
  const interrupted = guard === null ? null : guard.chooseSettlement();
  if (interrupted !== null) {
    return interrupted;
  }
  const settlement = await settleSlot({
    attempt,
    definition,
    deps: slotDeps,
    detail: outcome.line,
    exitCode: outcome.exitCode,
    home,
  });
  if (guard !== null) {
    // A signal that arrived while a `spawnSync` blocked the loop is only QUEUED — Node reads it on a later poll
    // phase, and a tick with nothing left to await exits before one. So pass one turn while this guard still
    // holds the phase: the queued signal waits on the settlement just written, and `disarm` exits with it.
    // MEASURED, SIGTERM 0.3s into a run-due of `dev build` in a throwaway home: without this turn it
    // exited 0 with no line; the signal was simply never read.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  return settlement;
}

/**
 * Take one due row's firing, by whichever route its run shape calls for.
 *
 * A RUN-HERE row takes the firing right here, which is the half a tick must not skip: a tick that
 * only READ a claim for such a row and never took one, so two concurrent ticks both ran it
 * (measured — two `slopweaver automation run-due --home <tmp>` both printed `· ran ·` for slot
 * a fixed slot instant on one `verb-run` row). A SPAWN-shaped row was taken by the seat that opened
 * this session, so it is read rather than taken.
 *
 * @param claimId the token this process holds, which is what admits a spawn-shaped row
 * @param definition the due row
 * @param home the state home the ledger lives under
 * @param slotDeps the take/settle edges
 * @param slotIso the firing this run covers
 * @returns the attempt this row will run under, or the outcome to report instead
 */
async function admitRow({
  claimId,
  definition,
  home,
  slotDeps,
  slotIso,
}: {
  claimId: string | null;
  definition: RecipeDefinition;
  home: string;
  slotDeps: SlotRunDeps;
  slotIso: string;
}): Promise<RowAdmission> {
  if (runShapeForDefinition({ definition }) === "spawn") {
    return admitSeatedRow({ claimId, definition, home, slotDeps, slotIso });
  }
  // THIS process runs the effect, so its pid goes on the attempt: if it dies before settling — a caller's
  // `timeout` can kill one — the next tick reads the attempt abandoned instead of HELD all day.
  const taken = await takeSlot({
    definition,
    deps: slotDeps,
    holder: "recipe run-due",
    holderPid: process.pid,
    home,
    slotIso,
  });
  if (taken.kind === "taken") {
    return { attempt: taken.attempt, carriedFrom: null, kind: "admitted" };
  }
  return {
    kind: "refused",
    outcome: {
      detail: [],
      exitCode: null,
      failed: taken.failed,
      line: taken.line,
      ran: false,
      recipeId: definition.recipeId,
    },
  };
}

/** Stands in for a record the store could not produce — see {@link priorRunOf}. */
const UNREADABLE_PRIOR_RUN: RecipeDefinitionRun = { exitCode: 0, lastRunAtIso: "", watermarkIso: "" };

/**
 * The row's run record as the store holds it NOW — read per row, so a stamp an earlier row of this same tick (or a
 * concurrent tick) wrote is seen.
 *
 * An unreadable store answers "has run" rather than "never ran": the only thing this decides is whether a card
 * opens with its day-one intro, and re-introducing a post to a channel that has had it for weeks is the worse
 * mistake. The tick itself already refused to start on an unreadable store, so this is the narrow race after.
 *
 * @param home the state home this tick is running over
 * @param recipeId the row being run
 * @returns the row's record, or undefined when no firing of it has ever settled
 */
function priorRunOf({ home, recipeId }: { home: string; recipeId: string }): RecipeDefinitionRun | undefined {
  const runs = readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson });
  if (runs.isErr()) {
    return UNREADABLE_PRIOR_RUN;
  }
  return runs.value[recipeId];
}

/**
 * {@link runOneRow}, with a THROW from one row turned into that row's own failure.
 *
 * The exit-code paths already keep one bad row from sinking the tick; a rejected promise did not, and an
 * alert-summary row reaches a network client, which is where an unexpected throw actually comes from. So
 * the isolation is per row, never around the whole loop — around the loop it would abandon every row after
 * the first bad one, which is the behaviour this exists to prevent.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold this row's effect
 * @param home the state home this tick is running over
 * @returns what happened, ready to print
 */
export async function runOneRowSafely({
  definition,
  deps,
  dryRun,
  home,
  media,
  slotIso,
}: {
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  media: readonly string[];
  slotIso: string;
}): Promise<RowOutcome> {
  try {
    const priorRun = priorRunOf({ home, recipeId: definition.recipeId });
    return await runOneRow({ definition, deps, dryRun, home, media, priorRun, slotIso });
  } catch (error: unknown) {
    return {
      detail: [],
      exitCode: null,
      failed: true,
      line: `recipe ${definition.recipeId} · THREW · ${errorMessage({ error })}`,
      ran: false,
      recipeId: definition.recipeId,
    };
  }
}

/**
 * Give back every seated firing whose LIVE row the tick judged not due — deferred to its successor, already
 * current, or unschedulable — so the seat's attempt is removed now rather than read abandoned at its lease.
 * A held or disabled row is passed over: its attempt stays unstarted so the seat's firing is retaken once the
 * row is back on. With no seat token, or on a dry run, nothing is touched. `./seatedAdmission.ts#giveBackSeatNotDue`
 * carries the incident.
 *
 * @param claimId the token this seated process was given, or `null` for an unseated tick
 * @param definitions the rows this tick judged, paired with `verdicts` by position
 * @param dryRun whether this tick only reports, writing nothing
 * @param home the state home the ledger lives under
 * @param nowIso the reference instant
 * @param verdicts one verdict per row, in the same order
 * @returns one outcome per firing given back or left alone
 */
export function seatGiveBacks({
  claimId,
  definitions,
  dryRun,
  home,
  nowIso,
  verdicts,
}: {
  claimId: string | null;
  definitions: readonly RecipeDefinition[];
  dryRun: boolean;
  home: string;
  nowIso: string;
  verdicts: readonly RecipeDueVerdict[];
}): readonly RowOutcome[] {
  if (claimId === null || dryRun) {
    return [];
  }
  return definitions.flatMap((definition, index) => {
    const verdict = verdicts[index]!;
    const liveButNotDue = !verdict.due && verdict.offReason === undefined;
    if (!liveButNotDue || runShapeForDefinition({ definition }) !== "spawn") {
      return [];
    }
    const outcome = giveBackSeatNotDue({ claimId, definition, home, nowIso });
    return outcome === null ? [] : [outcome];
  });
}
