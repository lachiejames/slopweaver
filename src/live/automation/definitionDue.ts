/**
 * Which rows in the in-repo definition store are DUE, and which cadence SLOT a run of each one covers — the
 * `next` half of what Work Console's `alerts next/claim/complete` owned, computed natively.
 *
 * The in-repo store gets its executor for the scheduled rows, and a missed slot resumes by an explicit
 * `onMissed` field defaulted from the destination — enacted here, where the slot is chosen.
 *
 * ## The arithmetic lives next door
 *
 * Which firings of a cadence went by, which SLOT a run covers under `onMissed`, and the deferral that
 * stops a `perSlot: false` row posting the same card twice in one morning are all in
 * `./firingCalculus.ts`, with the rulings behind each. This file turns that arithmetic into the verdict a
 * tick prints.
 *
 * ## A FAILED run does not advance the watermark, and that is the whole of the retry
 *
 * A run that fails is picked up again and retried in a way that causes no other problem. The watermark moves only when `./slotLedger.ts` RETIRES a firing — a success, or
 * a firing declared dead after its attempts are spent. A failure leaves it exactly where it was, so this
 * function judges the row due for the SAME firing again, and at the row's own next firing `chooseSlot`
 * abandons it. Retries therefore live inside a firing's own period with no field expressing it, which is
 * also what keeps the `onMissed` answer true for a machine that was off.
 *
 * `automation run-due` never stamps a row that RAN whatever its exit code. Measured on a
 * throwaway home: a row whose verb exited 1 was stamped `{exitCode: 1, watermarkIso:
 * "…03:40:00.000Z"}` and read `current` on the next breath — one lost card, and nothing that came back
 * for it. `EXIT_DEFERRED` still leaves a firing untouched, and now spends no attempt either.
 */
import type { RecipeDefinition, RecipeHold } from "./definition.js";
import type { RecipeDefinitionRun } from "./definitionRunStore.js";
import { holdStands } from "./failureHold.js";
import {
  chooseSlot,
  deferralToSuccessor,
  firingsBetween,
  latestFiringAtOrBefore,
  minutesOf,
} from "./firingCalculus.js";

// The cadence arithmetic moved to `./firingCalculus.ts` and every caller keeps importing this one from
// here: the slot a run covers is a due-ness question, so the verdict module stays its public address.
export { latestFiringAtOrBefore } from "./firingCalculus.js";

/**
 * Why a row is OFF, as opposed to merely between firings — `undefined` when it is live.
 *
 * Both values mean `due: false`, and they are kept apart because they cost a reader different things. A
 * `disabled` row resumes the moment `automation enable` lands on the owner's word. A `held` row does not: it stays
 * off until the owner's own approval is recorded against it, and `automation enable` refuses it, so telling a reader
 * "disabled" when a hold is what really governs would send them to a switch that changes nothing.
 */
export type RecipeOffReason = "disabled" | "held";

/** One row's due verdict, the slot a run would cover, and the line a tick prints for it. */
export interface RecipeDueVerdict {
  readonly recipeId: string;
  readonly due: boolean;
  /**
   * Why this row is off, or `undefined` when nothing is holding it off its cadence.
   *
   * Carried on the verdict rather than re-derived by each reader because the verdict is the one thing every
   * caller of this module already has, and a reader that re-read the definition to answer "is it off" would
   * be a second place the precedence between `hold` and `enabled` could disagree.
   */
  readonly offReason?: RecipeOffReason | undefined;
  /** When this row last ran, or `null` when it never has. */
  readonly lastRunAtIso: string | null;
  /** The last slot a run covered, or `null` when it never has. */
  readonly watermarkIso: string | null;
  /** How many cadence firings went by after the watermark, capped by `./firingCalculus.ts`. */
  readonly firingsSinceWatermark: number;
  /** The cadence slot a run now would cover — the watermark it stamps — or `null` when the row is not due. */
  readonly slotIso: string | null;
  /** How many slots stay owed after this run covers {@link RecipeDueVerdict.slotIso}; only a per-slot backfill owes any. */
  readonly slotsOwedAfterThis: number;
  /** The line this row prints, so a tick that skipped it is never a silent one. */
  readonly line: string;
}

/**
 * The line a HELD row prints.
 *
 * A hold has no escape hatch, and `.claude/rules/error-handling.md` § "A `hold` has no hatch, and says so"
 * is why the line says that out loud: silence about a hatch reads as a forgotten one, and
 * the next session spends its turn hunting for the `SLOPWEAVER_ALLOW_*` that does not exist. So the line
 * carries what caught the row, why, that there is no override, and the one thing that does clear it.
 *
 * It deliberately does NOT tell a reader to set `enabled: true` — that is the move this whole mechanism
 * exists to make useless, and naming it would read as the fix.
 *
 * A FAILURE hold (`hold.finding`, `./failureHold.ts`) prints its own line: the store placed it, its finding's
 * row says what state the fix is in, and settling that finding is what lifts it — never an edit to this file.
 *
 * @param hold the standing refusal, which the caller has already found stands
 * @returns the one line, with no trailing newline
 */
function heldLine({ hold, recipeId }: { hold: RecipeHold; recipeId: string }): string {
  if (hold.finding !== undefined) {
    const state = hold.findingState === undefined ? "its finding was not read in this view" : hold.findingState.line;
    return (
      `recipe ${recipeId} · HELD since ${hold.askedIso} · ${hold.reason}. The store placed this hold because a ` +
      `firing failed, and ${state}. It has no escape hatch and no environment override; it lifts when the ` +
      `finding ${hold.finding} is settled answered (or filed as a row that is done), and nothing fires the row ` +
      "until then. Setting `enabled` back to true does nothing while the hold stands."
    );
  }
  return (
    `recipe ${recipeId} · HELD since ${hold.askedIso} · ${hold.reason}. ` +
    "A hold has no escape hatch and no environment override — it is lifted only by recording the owner's " +
    "own approval on the row's `hold.clearedBy`, which a reader can go and read: { runSlug, atIso } for the " +
    "owner's answer to a Queue row, or { dmChannel, ts, atIso } for a message the owner sent in their bot DM. " +
    "Ask the owner on the Queue (`handover register`), never in that DM. Setting `enabled` back to true does " +
    "nothing while the hold stands."
  );
}

/**
 * Whether the row is OFF before its cadence is ever consulted, and which kind of off it is — `undefined`
 * when nothing is holding it.
 *
 * The ORDER is the rule. A hold is checked first because it is the one that cannot be undone by writing a
 * boolean: answering "disabled" to a row that is also held would send a reader to flip `enabled` back and
 * watch nothing happen. Both answers skip the cadence entirely, so a row that is off and whose cron will not
 * parse reports being off rather than being unschedulable.
 *
 * @param definition the parsed row, whose `hold` and `enabled` are the whole input
 * @returns the line and reason to merge into the verdict, or `undefined` when the row is live
 */
function offVerdict({
  definition,
}: {
  definition: RecipeDefinition;
}): { line: string; offReason: RecipeOffReason } | undefined {
  const { hold } = definition;
  if (hold !== undefined && holdStands({ hold })) {
    return { line: heldLine({ hold, recipeId: definition.recipeId }), offReason: "held" };
  }
  if (!definition.enabled) {
    return { line: `recipe ${definition.recipeId} · parked · the row is disabled`, offReason: "disabled" };
  }
  return undefined;
}

/**
 * The line a firing retired in favour of its successor prints, naming both spans that decided it.
 *
 * Its own function so {@link judgeRecipeDue} reads as one verdict per arm: the wording is the whole content
 * of this arm, and the incident it came from is a reader asking WHY a row said nothing at its own hour.
 *
 * @param cadence the row's cron expression, quoted back so the reader sees the period being reasoned about
 * @param recipeId the row being judged
 * @param slotIso the firing being retired
 * @param spans how late this firing is, and how far off its successor
 * @returns the line to print
 */
function deferredLine({
  cadence,
  recipeId,
  slotIso,
  spans,
}: {
  cadence: string;
  recipeId: string;
  slotIso: string;
  spans: { lateByMs: number; nextFiringInMs: number };
}): string {
  return (
    `recipe ${recipeId} · DEFERRED · slot ${slotIso} came ${minutesOf({ ms: spans.lateByMs })} ago ` +
    `and the next \`${cadence}\` firing is ${minutesOf({ ms: spans.nextFiringInMs })} away, so the ` +
    "successor covers it · watermark untouched"
  );
}

/** Every field of a verdict except the line — what a row reports before any judgement is made about it. */
type BlankVerdict = Omit<RecipeDueVerdict, "line">;

/**
 * The not-due verdict every arm below spreads over, built from the stored run alone.
 *
 * @param definition the parsed row
 * @param run what this row's last run left behind, or `null` when it never has
 * @returns the fields a verdict carries before a cadence is consulted
 */
function blankVerdict({
  definition,
  run,
}: {
  definition: RecipeDefinition;
  run: RecipeDefinitionRun | null;
}): BlankVerdict {
  return {
    due: false,
    firingsSinceWatermark: 0,
    lastRunAtIso: run === null ? null : run.lastRunAtIso,
    recipeId: definition.recipeId,
    slotIso: null,
    slotsOwedAfterThis: 0,
    watermarkIso: run === null ? null : run.watermarkIso,
  };
}

/**
 * A row whose own cadence string the firing calculus refused — never due, and the line says why.
 *
 * @param base the not-due fields
 * @param cadence the string that was refused, quoted so a reader can see the typo
 * @param reason what the calculus said about it
 * @param recipeId the row being judged
 * @returns the verdict to print
 */
function unschedulableVerdict({
  base,
  cadence,
  reason,
  recipeId,
}: {
  base: BlankVerdict;
  cadence: string;
  reason: string;
  recipeId: string;
}): RecipeDueVerdict {
  return {
    ...base,
    line: `recipe ${recipeId} · UNSCHEDULABLE · cadence \`${cadence}\` was refused: ${reason}`,
  };
}

/**
 * Judge a row that has never run: it is due for the latest firing at or before now, and nothing is owed
 * behind that one — a first run backfills no history it was never there for.
 *
 * @param base the not-due fields
 * @param definition the parsed row
 * @param nowIso the reference instant
 * @returns the verdict, the slot, and the line to print
 */
function firstEverVerdict({
  base,
  definition,
  nowIso,
}: {
  base: BlankVerdict;
  definition: RecipeDefinition;
  nowIso: string;
}): RecipeDueVerdict {
  const slot = latestFiringAtOrBefore({ cadence: definition.cadence, nowIso });
  if (typeof slot !== "string") {
    return unschedulableVerdict({
      base,
      cadence: definition.cadence,
      reason: slot.error,
      recipeId: definition.recipeId,
    });
  }
  return {
    ...base,
    due: true,
    firingsSinceWatermark: 1,
    line: `recipe ${definition.recipeId} · DUE · has never run · covers slot ${slot}`,
    slotIso: slot,
  };
}

/**
 * Judge one row against its own cadence and choose the slot a run covers. Pure — the caller supplies the
 * clock and the stored run.
 *
 * @param definition the parsed row
 * @param run what this row's last run left behind, or `null` when it never has
 * @param nowIso the reference instant
 * @returns the verdict, the slot, and the line to print
 */
export function judgeRecipeDue({
  definition,
  run,
  nowIso,
}: {
  definition: RecipeDefinition;
  run: RecipeDefinitionRun | null;
  nowIso: string;
}): RecipeDueVerdict {
  const base = blankVerdict({ definition, run });
  const off = offVerdict({ definition });
  if (off !== undefined) {
    return { ...base, ...off };
  }
  if (run === null) {
    return firstEverVerdict({ base, definition, nowIso });
  }
  const firings = firingsBetween({ afterIso: run.watermarkIso, cadence: definition.cadence, nowIso });
  if ("error" in firings) {
    return unschedulableVerdict({
      base,
      cadence: definition.cadence,
      reason: firings.error,
      recipeId: definition.recipeId,
    });
  }
  const { count, oldestIso, latestIso } = firings;
  if (count === 0 || oldestIso === null || latestIso === null) {
    return {
      ...base,
      line: `recipe ${definition.recipeId} · current · no \`${definition.cadence}\` firing since slot ${run.watermarkIso}`,
    };
  }
  const chosen = chooseSlot({ definition, firings: { count, latestIso, oldestIso } });
  const deferred = deferralToSuccessor({
    cadence: definition.cadence,
    coversLatest: chosen.coversLatest,
    firingsSinceWatermark: count,
    nowIso,
  });
  if (deferred !== null) {
    const line = deferredLine({
      cadence: definition.cadence,
      recipeId: definition.recipeId,
      slotIso: chosen.slotIso,
      spans: deferred,
    });
    return { ...base, firingsSinceWatermark: count, line };
  }
  return {
    ...base,
    due: true,
    firingsSinceWatermark: count,
    line: `recipe ${definition.recipeId} · DUE · \`${definition.cadence}\` fired ${String(count)}x since slot ${run.watermarkIso} · ${chosen.tail}`,
    slotIso: chosen.slotIso,
    slotsOwedAfterThis: chosen.slotsOwedAfterThis,
  };
}

/**
 * Judge every row in one sweep, in the order the store handed them back.
 *
 * Every row yields a verdict, current and parked ones included, for the reason `refresh --if-stale` prints
 * its skipped sources: a tick that reported only what it ran cannot be told apart from a tick that selected
 * nothing.
 *
 * @param definitions the parsed rows
 * @param runFor the stored run for one row, or `null` when it has never run
 * @param nowIso the reference instant every cadence is judged against
 * @returns one verdict per row, in the order given
 */
export function judgeRecipeDefinitions({
  definitions,
  runFor,
  nowIso,
}: {
  definitions: readonly RecipeDefinition[];
  runFor: (args: { recipeId: string }) => RecipeDefinitionRun | null;
  nowIso: string;
}): readonly RecipeDueVerdict[] {
  return definitions.map((definition) =>
    judgeRecipeDue({ definition, nowIso, run: runFor({ recipeId: definition.recipeId }) }),
  );
}
