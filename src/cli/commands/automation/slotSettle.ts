/**
 * SETTLE a cadence firing — the half of `./slotRun.ts` that closes the attempt a take handed out.
 *
 * Split from the take along that seam: a take decides whether anything runs, a settle records how the run
 * ended, and neither calls the other. Both dispatchers (`./runDueAttempt.ts`, `./claim.ts`) settle through
 * here, so a kind's run shape changes WHO settles, never what a settlement means.
 *
 * ## A failure HOLDS the row
 *
 * A row that fails once is paused until its fix lands, never cooled and fired again to
 * fail the same way. So the `failed` arm goes through `./slotFailureHold.ts#holdOnFailure`, and an attempt
 * that was the firing's last goes through `./slotDeadLetter.ts#deadLetter`, which holds too.
 *
 * ## Stamping is a CONSEQUENCE of retiring a firing, never a separate act
 *
 * `live/automation/definitionRunStore.ts`'s watermark moves if and only if
 * `live/automation/slotAttempt.ts#slotIsRetired` says the firing is finished with. That is the whole of the
 * retry: a FAILED attempt leaves the watermark where it was, so `live/automation/definitionDue.ts` judges the
 * row due for the same firing again once its hold lifts. Stamping any row that RAN whatever its exit code would
 * mean a row whose verb exited 1 reads `current` on the very next breath, so that firing's card is lost and
 * nothing ever comes back for it.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { nextFiringAfter } from "../../../live/automation/definitionClaim.js";
import { recordRecipeDefinitionRun } from "../../../live/automation/definitionRunStore.js";
import {
  MAX_ATTEMPTS_PER_SLOT,
  type RecipeSlotAttempt,
  type RecipeSlotOutcome,
  retryFloorMs,
  slotIsRetired,
} from "../../../live/automation/slotAttempt.js";
import { settleSlotAttempt } from "../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { deadLetter, refusedLine, type SlotSettlement } from "./slotDeadLetter.js";
import { holdOnFailure } from "./slotFailureHold.js";
import type { SlotRunDeps } from "./slotRun.js";

/**
 * Give a DEFERRED run's attempt back rather than spending one of the firing's three — and RECORD that it
 * deferred, rather than erasing the firing's row.
 *
 * A deferred verb RAN and declined to act yet, so the firing has not been attempted in any sense that should
 * cost it an attempt — `../../exitCodes.ts` § EXIT_DEFERRED. Spending one here would let a row legitimately
 * waiting on a prerequisite exhaust itself into a dead letter while nothing was wrong. So the row is settled
 * with a `deferred` outcome, which `../../../live/automation/slotAttempt.ts#judgeSlotAttempt` reads as `open` at
 * the SAME attempt number: the give-back is unchanged, and the firing now says why it did not run.
 *
 * It used to `releaseSlotAttempt`, which `rmSync`s the row. MEASURED: `vulnfix-digest-acme-admin`
 * deferred every slot for two days on a top-up generation whose session had died, and the ONLY trace
 * anywhere was the tick's own stdout — `definition-runs.json` still read the last firing that actually ran,
 * `exitCode: 0`, so "has posted nothing for two days" and "posted fine" were the same bytes to every reader
 * downstream. A deferral that deletes its own evidence is the silence, not the deferral.
 *
 * @param attempt the attempt to give back
 * @param definition the row that deferred
 * @param deps the injected edges
 * @param detail what the verb said it was waiting for, carried onto the record
 * @param home the state home the ledger lives under
 * @param nowIso the reference instant
 * @returns whether the give-back persisted, and the line to print
 */
function giveTheAttemptBack({
  attempt,
  definition,
  deps,
  detail,
  home,
  nowIso,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  deps: SlotRunDeps;
  detail: string;
  home: string;
  nowIso: string;
}): SlotSettlement {
  const settled = settleSlotAttempt({
    holderToken: attempt.holderToken,
    home,
    nowIso,
    outcome: { detail, kind: "deferred", settledAtIso: nowIso },
    recipeId: definition.recipeId,
    slotIso: attempt.slotIso,
  });
  if (settled.isErr()) {
    deps.writeDiagnostic(settled.error.message);
  }
  return {
    failed: settled.isErr(),
    line: refusedLine({
      recipeId: definition.recipeId,
      slotIso: attempt.slotIso,
      what: `DEFERRED · the attempt was given back, not spent — still due (${detail})`,
    }),
  };
}

/**
 * Close the attempt this caller holds, and stamp the watermark if and only if the firing is finished with.
 *
 * @param attempt the attempt this caller took
 * @param definition the row that ran
 * @param deps the injected edges
 * @param detail one line about what went wrong, for a failure; ignored on success
 * @param exitCode what the row's own run exited with, or `null` when it never reached one
 * @param home the state home the ledger lives under
 * @returns whether anything failed to persist, and the line to print
 */
export async function settleSlot({
  attempt,
  definition,
  deps,
  detail,
  exitCode,
  home,
}: {
  readonly attempt: RecipeSlotAttempt;
  readonly definition: RecipeDefinition;
  readonly deps: SlotRunDeps;
  readonly detail: string;
  readonly exitCode: number | null;
  readonly home: string;
}): Promise<SlotSettlement> {
  const nowIso = deps.now();
  if (exitCode === EXIT_DEFERRED) {
    return giveTheAttemptBack({ attempt, definition, deps, detail, home, nowIso });
  }
  // EXIT_EXPECTED_EMPTY is the verb working as designed — it did its work and there was none — so it
  // RETIRES the firing exactly as a zero does. Treating it as a failure would retry a row three times for
  // finding nothing, then dead-letter it. `../../exitCodes.ts` § EXIT_EXPECTED_EMPTY.
  const succeeded = exitCode === EXIT_OK || exitCode === EXIT_EXPECTED_EMPTY;
  if (succeeded) {
    return finishSettlement({
      attempt,
      definition,
      deps,
      home,
      nowIso,
      outcome: { exitCode, kind: "succeeded", settledAtIso: nowIso },
    });
  }
  if (attempt.attempt >= MAX_ATTEMPTS_PER_SLOT) {
    const letter = await deadLetter({
      definition,
      deps,
      detail,
      home,
      judged: { attempt: attempt.attempt, holderToken: attempt.holderToken },
      observedBy: attempt.holder,
      reason: "ATTEMPTS_EXHAUSTED",
      slotIso: attempt.slotIso,
      what: `attempt ${String(attempt.attempt)} of ${String(MAX_ATTEMPTS_PER_SLOT)} failed (${detail})`,
    });
    return letter.settlement;
  }
  return settleFailure({ attempt, definition, deps, detail, exitCode, home, nowIso });
}

/**
 * Settle a failed attempt that still has retries left: the firing stays `failed` on the ledger, and the row
 * is held on one finding.
 *
 * @param attempt the attempt this caller took
 * @param detail one line about what went wrong
 * @param exitCode what the row's own run exited with, or `null` when it never reached one
 * @param nowIso the settle instant, shared with the ledger write
 * @returns whether anything failed to persist, and the line to print
 */
async function settleFailure({
  attempt,
  definition,
  deps,
  detail,
  exitCode,
  home,
  nowIso,
}: {
  readonly attempt: RecipeSlotAttempt;
  readonly definition: RecipeDefinition;
  readonly deps: SlotRunDeps;
  readonly detail: string;
  readonly exitCode: number | null;
  readonly home: string;
  readonly nowIso: string;
}): Promise<SlotSettlement> {
  const retryNotBeforeIso = retryFloorIso({ attempt, definition, nowIso });
  const settled = finishSettlement({
    attempt,
    definition,
    deps,
    home,
    nowIso,
    outcome: { detail, exitCode, kind: "failed", retryNotBeforeIso, settledAtIso: nowIso },
  });
  // A failure HOLDS the row rather than cooling it for another try: the firing stays
  // `failed` on the ledger, and its retry waits on the finding's fix rather than on the floor alone.
  const held = await holdOnFailure({
    attempt: attempt.attempt,
    definition,
    deps,
    detail,
    home,
    observedBy: attempt.holder,
    slotIso: attempt.slotIso,
    what: `exit ${exitCode === null ? "none" : String(exitCode)}`,
  });
  return { failed: settled.failed || held.failed, line: `${settled.line} · ${held.line}` };
}

/** The earliest instant the next attempt at this firing may start — a fraction of the row's own period. */
function retryFloorIso({
  attempt,
  definition,
  nowIso,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  nowIso: string;
}): string {
  const next = nextFiringAfter({ afterIso: attempt.slotIso, cadence: definition.cadence });
  // An unreadable cadence cannot produce a period, so the floor is NOW: a row that could never be retried is
  // a silent row, which is the failure this whole lane exists to remove.
  if (typeof next !== "string") {
    return nowIso;
  }
  const periodMs = Date.parse(next) - Date.parse(attempt.slotIso);
  return new Date(Date.parse(nowIso) + retryFloorMs({ attempt: attempt.attempt, periodMs })).toISOString();
}

/**
 * The exit code a retired firing is stamped with: the verb's own on a success, and 1 on a death.
 *
 * A death has no exit code of its own — nothing returned one, which is the whole reason the firing died —
 * and `definition-runs.json` reports this field so a row failing every firing is visible without reading a
 * log. A 1 says "this firing did not succeed", which is exactly true of both death reasons.
 */
function retiredExitCode({ outcome }: { outcome: RecipeSlotOutcome }): number {
  if (outcome.kind === "succeeded") {
    return outcome.exitCode;
  }
  return 1;
}

/** Write the outcome, stamp the watermark when the firing is retired, and compose the line. */
function finishSettlement({
  attempt,
  definition,
  deps,
  home,
  nowIso,
  outcome,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  deps: SlotRunDeps;
  home: string;
  nowIso: string;
  outcome: RecipeSlotOutcome;
}): SlotSettlement {
  let failed = false;
  const settled = settleSlotAttempt({
    holderToken: attempt.holderToken,
    home,
    nowIso,
    outcome,
    recipeId: definition.recipeId,
    slotIso: attempt.slotIso,
  });
  if (settled.isErr()) {
    failed = true;
    deps.writeDiagnostic(settled.error.message);
  }
  if (!slotIsRetired({ outcome })) {
    return {
      failed,
      line: refusedLine({
        recipeId: definition.recipeId,
        slotIso: attempt.slotIso,
        what: `attempt ${String(attempt.attempt)} of ${String(MAX_ATTEMPTS_PER_SLOT)} failed — not stamped`,
      }),
    };
  }
  const stamped = recordRecipeDefinitionRun({
    home,
    nowIso,
    path: stateHomePaths({ home }).live.recipe.definitionRunsJson,
    recipeId: definition.recipeId,
    run: { exitCode: retiredExitCode({ outcome }), lastRunAtIso: nowIso, watermarkIso: attempt.slotIso },
  });
  if (stamped.isErr()) {
    failed = true;
    stamped.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
  }
  return {
    failed,
    line: refusedLine({
      recipeId: definition.recipeId,
      slotIso: attempt.slotIso,
      what: `settled on attempt ${String(attempt.attempt)} — stamped`,
    }),
  };
}
