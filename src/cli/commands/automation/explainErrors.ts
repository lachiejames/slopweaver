/**
 * The failures `automation explain` authors about WHICH firing it was asked to describe: a slot or attempt not
 * named, an attempt that is not a whole number, and the three refusals once the ledger is read. Part of the
 * directory's `RecipeCommandError` union (`./errors.ts`), which spreads these factories into `RecipeCommandErrors`,
 * so a caller raises them exactly as it raises any other.
 */
import type { RecipeCommandArgumentMissingError, RecipeCommandInvalidFlagValueError } from "./errors.js";

/**
 * `automation explain` found no firing it may explain: the slot named holds no firing (`SLOT_UNRECORDED`), its
 * ledger has since moved to another attempt than the one named (`ATTEMPT_MOVED`), or that attempt did not fail
 * (`SLOT_NOT_FAILED`).
 */
export interface RecipeCommandExplainRefusedError {
  readonly code: "EXPLAIN_REFUSED";
  readonly message: string;
  readonly recipeId: string;
  readonly reason: "SLOT_UNRECORDED" | "SLOT_NOT_FAILED" | "ATTEMPT_MOVED";
}

/** An explain refusal, its reason named and its line saying why. */
function explainRefused({
  recipeId,
  reason,
  why,
}: {
  recipeId: string;
  reason: RecipeCommandExplainRefusedError["reason"];
  why: string;
}): RecipeCommandExplainRefusedError {
  return {
    code: "EXPLAIN_REFUSED",
    message: `automation explain · ${recipeId} was not explained: ${why}`,
    reason,
    recipeId,
  };
}

/** How to raise one — spread into `RecipeCommandErrors`, the factory the real code calls. */
export const RecipeCommandExplainErrors = {
  explainAttemptMissing: (): RecipeCommandArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message:
      "automation explain needs --attempt: the attempt number your own `run-due` printed for the firing that failed",
    name: "--attempt",
  }),
  explainAttemptMoved: ({
    recipeId,
    slotIso,
    attempt,
    recorded,
  }: {
    recipeId: string;
    slotIso: string;
    attempt: number;
    recorded: number;
  }): RecipeCommandExplainRefusedError =>
    explainRefused({
      reason: "ATTEMPT_MOVED",
      recipeId,
      why: `its firing at ${slotIso} is now on attempt ${String(recorded)}, not attempt ${String(attempt)}, so the words would describe another run`,
    }),
  explainAttemptNotWhole: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--attempt",
    got,
    message: `--attempt takes a whole number, at least 1 — \`${got}\` is not one`,
  }),
  explainSlotMissing: (): RecipeCommandArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: "automation explain needs --slot: the slot your own `run-due` printed for the firing that failed",
    name: "--slot",
  }),
  explainSlotNotFailed: ({
    recipeId,
    slotIso,
    outcome,
  }: {
    recipeId: string;
    slotIso: string;
    outcome: string;
  }): RecipeCommandExplainRefusedError =>
    explainRefused({
      reason: "SLOT_NOT_FAILED",
      recipeId,
      why: `its firing at ${slotIso} is ${outcome}, not a failure, so there is nothing to explain`,
    }),
  explainSlotUnrecorded: ({
    recipeId,
    slotIso,
  }: {
    recipeId: string;
    slotIso: string;
  }): RecipeCommandExplainRefusedError =>
    explainRefused({ reason: "SLOT_UNRECORDED", recipeId, why: `no firing is recorded at ${slotIso}` }),
} as const;
