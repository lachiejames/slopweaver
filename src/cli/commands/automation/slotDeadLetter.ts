/**
 * Declaring a cadence firing DEAD — the half of `./slotRun.ts` that retires a firing nobody can finish,
 * stamps the schedule past it, and HOLDS the row on one finding (`./slotFailureHold.ts`).
 *
 * Split from the take-and-settle module along that seam: every arm here ends a firing, none starts one. The
 * retirement is a compare-and-set on the attempt that was judged
 * (`live/automation/slotSettlement.ts#retireSlot`), so a firing that moved under the caller, or one the ledger
 * could not retire at all, is neither stamped nor held.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import {
  lastRecipeRun,
  type RecipeDefinitionRun,
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../live/automation/definitionRunStore.js";
import { firingReason } from "../../../live/automation/firingReason.js";
import { findRecipeKind } from "../../../live/automation/kinds.js";
import { signalDeathHolds } from "../../../live/automation/signalKillGrace.js";
import {
  MAX_ATTEMPTS_PER_SLOT,
  type RecipeSlotAbandonment,
  type RecipeSlotDeathReason,
  type RecipeSlotVerdict,
  retryAfterUnknownIsSafe,
} from "../../../live/automation/slotAttempt.js";
import { retireSlot } from "../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type FailureHoldDeps, type FailureHoldResult, holdOnFailure } from "./slotFailureHold.js";

/** The edges a dead letter reaches — exactly a failure hold's. Every dispatcher's `SlotRunDeps` carries them. */
export type DeadLetterDeps = FailureHoldDeps;

/** What settling one attempt answered. */
export interface SlotSettlement {
  /** True when the stamp or the ledger write did not persist, which the tick reports as a failure. */
  readonly failed: boolean;
  /** The line to print about how the firing ended. */
  readonly line: string;
}

/** What a dead-letter arm answered: whether a firing actually died, and the settlement to report. */
export interface DeadLetter {
  readonly died: boolean;
  readonly settlement: SlotSettlement;
}

/** Whether an abandoned attempt at this row may simply be taken again. */
function unknownRetryIsSafe({ definition }: { definition: RecipeDefinition }): boolean {
  const kind = findRecipeKind({ kind: definition.kind });
  // A kind this build does not register cannot have run at all, so there is nothing whose outcome could be
  // unknown — but the honest answer here is still the cautious one rather than an assumption about how it
  // got into the ledger.
  if (kind === undefined) {
    return false;
  }
  return retryAfterUnknownIsSafe({
    destinationTakesKey: kind.destinationTakesSlotKey,
    writes: definition.effect !== "read",
  });
}

/** The row's last stamped run before this death is stamped, or `"unreadable"` when the runs file will not read. */
function previousRun({
  path,
  recipeId,
}: {
  path: string;
  recipeId: string;
}): RecipeDefinitionRun | null | "unreadable" {
  const runs = readRecipeDefinitionRuns({ path });
  if (runs.isErr()) {
    return "unreadable";
  }
  return lastRecipeRun({ recipeId, runs: runs.value });
}

/**
 * Hold the row on this death, unless it is a first signal kill: that one death holds nothing, so the next slot
 * fires (`live/automation/signalKillGrace.ts`).
 */
async function holdUnlessFirstSignalKill({
  attempt,
  definition,
  deps,
  detail,
  home,
  observedBy,
  reason,
  runsPath,
  slotIso,
}: {
  attempt: number;
  definition: RecipeDefinition;
  deps: DeadLetterDeps;
  detail: string;
  home: string;
  observedBy: string;
  reason: RecipeSlotDeathReason;
  runsPath: string;
  slotIso: string;
}): Promise<FailureHoldResult> {
  const previous = previousRun({ path: runsPath, recipeId: definition.recipeId });
  if (!signalDeathHolds({ previous, reason })) {
    return {
      failed: false,
      line: "NOT held: a first signal kill is not the row failing, so the next slot fires — a second kill in a row holds it",
    };
  }
  return holdOnFailure({ attempt, definition, deps, detail, home, observedBy, slotIso, what: reason });
}

/**
 * Retire a firing that will never succeed: write its death, stamp the watermark past it so the schedule
 * moves on, and hold the row on the one finding that hands it to a person.
 *
 * The hold is placed BEFORE the stamp, and whether or not the stamp then persists: a dead firing nobody is
 * told about is the failure mode, a take between a stamp and a hold would fire the row, and a stamp that did
 * not persist merely leaves a retired firing the next take reads as settled.
 *
 * It ANSWERS how the hold and its finding landed, because the line the caller prints says so — a line
 * claiming a board row carries a dead firing when none does is the kind of confident lie this whole lane
 * exists to remove.
 *
 * When the ledger answers that the row is no longer the attempt that was judged — another dispatcher retook
 * or settled it in between — NOTHING follows: no stamp, no board row. Stamping there would move the schedule
 * past a firing a live attempt is still running, which is exactly the death the compare-and-set refused. A
 * retirement the ledger could not perform at all (its lock busy past every wait, an unreadable row) is the
 * same: the comparison never ran, so nothing may act as if it had passed. The firing stays as it was and the
 * next tick judges it again, which is what makes stopping here safe rather than a dead firing nobody is told of.
 *
 * @param definition the row whose firing is being abandoned
 * @param deps the injected edges
 * @param detail what a reader needs in order to go and look
 * @param home the state home the ledger and the board live under
 * @param judged the attempt number and token of the row the verdict was made over
 * @param observedBy who judged it dead, recorded on the finding
 * @param reason why it will never succeed
 * @param slotIso the firing
 * @returns whether the firing moved under the caller or could not be retired, or else how the row is held
 */
async function retireDeadSlot({
  definition,
  deps,
  detail,
  home,
  judged,
  observedBy,
  reason,
  slotIso,
}: {
  definition: RecipeDefinition;
  deps: DeadLetterDeps;
  detail: string;
  home: string;
  judged: { readonly attempt: number; readonly holderToken: string };
  observedBy: string;
  reason: RecipeSlotDeathReason;
  slotIso: string;
}): Promise<"moved" | "unwritten" | FailureHoldResult> {
  const nowIso = deps.now();
  const retired = retireSlot({ detail, home, judged, nowIso, reason, recipeId: definition.recipeId, slotIso });
  if (retired.isErr()) {
    deps.writeDiagnostic(retired.error.message);
    return "unwritten";
  }
  if (retired.value.kind === "moved") {
    return "moved";
  }
  const runsPath = stateHomePaths({ home }).live.recipe.definitionRunsJson;
  // The firing is ALREADY retired by now, so nothing will come back for it: the hold and its one finding
  // are what hand it to a person. Held BEFORE the stamp: a stamp moves the watermark past this firing, and a
  // take landing between the two would otherwise read the row unheld and fire it.
  const held = await holdUnlessFirstSignalKill({
    attempt: judged.attempt,
    definition,
    deps,
    detail,
    home,
    observedBy,
    reason,
    runsPath,
    slotIso,
  });
  // The cause rides the run stamp too, worded exactly as the Automations page words a dead firing it can still
  // read, so it outlives the ledger row it was settled from.
  const failureCause = `${reason}: ${firingReason({ detail, recipeId: definition.recipeId })}`;
  const stamped = recordRecipeDefinitionRun({
    home,
    nowIso,
    path: runsPath,
    recipeId: definition.recipeId,
    run: { exitCode: 1, failureCause, failureSlotIso: slotIso, lastRunAtIso: nowIso, watermarkIso: slotIso },
  });
  if (stamped.isErr()) {
    stamped.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
  }
  return held;
}

/**
 * The line a refusal prints, so both dispatchers say the same thing about the same state.
 *
 * @returns the line, prefixed with the row and its firing
 */
export function refusedLine({ recipeId, slotIso, what }: { recipeId: string; slotIso: string; what: string }): string {
  return `recipe ${recipeId} · slot ${slotIso} · ${what}`;
}

/**
 * Retire a firing and answer the refusal that says so — the one shape every dead-letter arm produces.
 *
 * @param definition the row whose firing is being abandoned
 * @param deps the injected edges
 * @param detail what goes on the record and into the board row
 * @param home the state home the ledger lives under
 * @param judged the attempt number and token of the row the death was judged over
 * @param observedBy the dispatcher that judged it dead, recorded on the finding as its observer
 * @param reason why it will never succeed
 * @param slotIso the firing
 * @param what the operator-facing tail of the line
 * @returns whether a firing actually died, and the settlement to report
 */
export async function deadLetter({
  definition,
  deps,
  detail,
  home,
  judged,
  observedBy,
  reason,
  slotIso,
  what,
}: {
  definition: RecipeDefinition;
  deps: DeadLetterDeps;
  detail: string;
  home: string;
  judged: { readonly attempt: number; readonly holderToken: string };
  observedBy: string;
  reason: RecipeSlotDeathReason;
  slotIso: string;
  what: string;
}): Promise<DeadLetter> {
  const retired = await retireDeadSlot({ definition, deps, detail, home, judged, observedBy, reason, slotIso });
  const recipeId = definition.recipeId;
  if (retired === "moved") {
    return {
      died: false,
      settlement: {
        failed: false,
        line: refusedLine({
          recipeId,
          slotIso,
          what: `attempt ${String(judged.attempt)} is no longer the one on the ledger — another dispatcher changed it first, nothing was retired`,
        }),
      },
    };
  }
  if (retired === "unwritten") {
    return {
      died: false,
      settlement: {
        failed: true,
        line: refusedLine({
          recipeId,
          slotIso,
          what: `attempt ${String(judged.attempt)} could not be retired — the diagnostic above says why; nothing was stamped or held, and the next tick judges it again`,
        }),
      },
    };
  }
  return {
    died: true,
    settlement: {
      failed: true,
      line: refusedLine({ recipeId, slotIso, what: `DEAD LETTER · ${what} · ${retired.line}` }),
    },
  };
}

/**
 * Whether an ABANDONED firing must die rather than be retaken, and what to say about it. PURE.
 *
 * Three ways to die and they are different facts: an effect nobody can prove landed, a run that started and
 * vanished, and a firing that has simply used every attempt it gets. A reader has to be able to tell them
 * apart from the board row alone. Only an attempt that never STARTED is retaken — a started run that died is
 * a failure, and a failure holds the row (`./slotFailureHold.ts`).
 *
 * @param definition the row whose firing was abandoned
 * @param verdict what the ledger found
 * @returns the death to record, or `undefined` when the firing may be retaken
 */
export function abandonedDeath({
  definition,
  verdict,
}: {
  definition: RecipeDefinition;
  verdict: AbandonedVerdict;
}): { readonly reason: RecipeSlotDeathReason; readonly detail: string; readonly what: string } | undefined {
  const attempted = `attempt ${String(verdict.attempt)} under ${verdict.holder}`;
  const how = abandonmentPhrase({ abandonment: verdict.abandonment });
  if (!unknownRetryIsSafe({ definition })) {
    return {
      detail:
        `${attempted} was abandoned (${how}) and left no receipt, and this kind's destination takes no ` +
        "idempotency key, so nobody can say whether its effect landed",
      reason: "OUTCOME_UNKNOWN",
      what:
        `attempt ${String(verdict.attempt)} was abandoned (${how}) and its outcome cannot be established ` +
        "rather than a blind re-run",
    };
  }
  if (verdict.ran) {
    return {
      detail: `${attempted} started its run and was abandoned (${how}) with nothing settled`,
      reason: "HOLDER_GONE",
      what: `attempt ${String(verdict.attempt)} started and died (${how})`,
    };
  }
  if (verdict.attempt >= MAX_ATTEMPTS_PER_SLOT) {
    return {
      detail: `${attempted} was abandoned (${how}) with no receipt`,
      reason: "ATTEMPTS_EXHAUSTED",
      what: `${String(verdict.attempt)} attempts abandoned`,
    };
  }
  return undefined;
}

/** The abandoned verdict, as every arm below takes it. */
export type AbandonedVerdict = Extract<RecipeSlotVerdict, { kind: "abandoned" }>;

/**
 * How an attempt came to be abandoned, in the words a dead letter carries. PURE.
 *
 * @param abandonment the typed cause the ledger judged
 * @returns the phrase, naming the pid when the holder process is what disappeared
 */
function abandonmentPhrase({ abandonment }: { abandonment: RecipeSlotAbandonment }): string {
  if (abandonment.kind === "holder-gone") {
    return `holder pid ${String(abandonment.holderPid)} is gone`;
  }
  return "its lease expired";
}
