/**
 * Every way one cadence slot's row can refuse — the typed error union `./slotAttempt.ts` and `./slotLedger.ts`
 * answer with, and the factory that builds each variant. Split from `./slotAttempt.ts` along the seam
 * `.claude/rules/error-handling.md` names: a domain's errors sit in their own module beside the logic.
 */

/** A slot's row could not be read, or an attempt could not be taken. */
export interface SlotUnreadableError {
  readonly code: "SLOT_UNREADABLE";
  readonly message: string;
  readonly recipeId: string;
}

/** The token offered to settle an attempt is not the token that attempt was taken under. */
export interface SlotTokenMismatchError {
  readonly code: "SLOT_TOKEN_MISMATCH";
  readonly message: string;
  readonly recipeId: string;
}

/** Nothing holds this slot, so there is no attempt to settle. */
export interface SlotNotHeldError {
  readonly code: "SLOT_NOT_HELD";
  readonly message: string;
  readonly recipeId: string;
}

/** The slot's row could not be persisted, so the dispatcher must treat the attempt as unrecorded. */
export interface SlotNotWrittenError {
  readonly code: "SLOT_NOT_WRITTEN";
  readonly message: string;
  readonly recipeId: string;
}

/** Every way one slot's row can refuse. */
export type RecipeSlotAttemptError =
  SlotUnreadableError | SlotTokenMismatchError | SlotNotHeldError | SlotNotWrittenError;

/**
 * Construct one {@link RecipeSlotAttemptError}. Tests build fixtures through these, never a hand-built
 * literal, so a factory that stops matching its own type reddens.
 *
 * @internal
 */
export const RecipeSlotAttemptErrors = {
  notHeld: ({ recipeId, slotIso }: { readonly recipeId: string; readonly slotIso: string }): SlotNotHeldError => ({
    code: "SLOT_NOT_HELD",
    message:
      `recipe '${recipeId}' slot ${slotIso} is not held, so there is nothing to settle — the attempt was ` +
      "never taken, or its row was removed while it ran",
    recipeId,
  }),
  notWritten: ({
    recipeId,
    slotIso,
    reason,
  }: {
    readonly recipeId: string;
    readonly slotIso: string;
    readonly reason: string;
  }): SlotNotWrittenError => ({
    code: "SLOT_NOT_WRITTEN",
    message: `recipe '${recipeId}' slot ${slotIso} could not be written: ${reason}`,
    recipeId,
  }),
  tokenMismatch: ({
    recipeId,
    slotIso,
    holder,
  }: {
    readonly recipeId: string;
    readonly slotIso: string;
    readonly holder: string;
  }): SlotTokenMismatchError => ({
    code: "SLOT_TOKEN_MISMATCH",
    message:
      `recipe '${recipeId}' slot ${slotIso} is held by ${holder} under a different token — this attempt's ` +
      "lease expired and a successor took the slot. Nothing was settled and nothing was stamped",
    recipeId,
  }),
  unreadable: ({
    recipeId,
    slotIso,
    reason,
  }: {
    readonly recipeId: string;
    readonly slotIso: string;
    readonly reason: string;
  }): SlotUnreadableError => ({
    code: "SLOT_UNREADABLE",
    message:
      `recipe '${recipeId}' slot ${slotIso} has a row this build cannot read (${reason}) — refusing rather ` +
      "than treating it as never attempted, which would run the slot a second time",
    recipeId,
  }),
} as const;
