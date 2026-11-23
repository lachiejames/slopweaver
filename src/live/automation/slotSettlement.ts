/**
 * Ending an attempt in the slot ledger: the holder's own settle, and the schedule's retirement of a firing
 * nobody holds. Split out of `./slotLedger.ts` on size alone, so that module keeps the keys, the row read and
 * write, the one `recipe-slot-attempts` mutex, the takes and the give-backs; both functions here take that same
 * mutex through its `acquireLedgerLock` and write through its `writeSlotAttempt`.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type RecipeSlotAttempt,
  type RecipeSlotDeathReason,
  type RecipeSlotOutcome,
  settleableAttempt,
} from "./slotAttempt.js";
import { type RecipeSlotAttemptError, RecipeSlotAttemptErrors } from "./slotAttemptErrors.js";
import { acquireLedgerLock, readSlotAttempt, writeSlotAttempt } from "./slotLedger.js";

/**
 * Close the attempt this caller holds, recording how it ended.
 *
 * The token is checked against the stored row, so a run that finishes after its lease expired and a
 * successor took the firing settles NOTHING rather than closing the successor's attempt — the same
 * guarantee `./definitionClaim.ts`'s `claimTokenMatches` bought, kept here now that the lease and the
 * receipt are one record instead of two.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row that ran
 * @param slotIso the firing it covered
 * @param holderToken the token this caller was given when it took the attempt
 * @param outcome how the attempt ended
 * @param nowIso the reference instant the lock is taken at
 * @returns the row as written, or why nothing was settled
 */
export function settleSlotAttempt({
  home,
  recipeId,
  slotIso,
  holderToken,
  outcome,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holderToken: string;
  readonly outcome: RecipeSlotOutcome;
  readonly nowIso: string;
}): Result<RecipeSlotAttempt, RecipeSlotAttemptError> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    const held = settleableAttempt({ holderToken, recipeId, slotIso, stored: stored.value });
    if (held.isErr()) {
      return err(held.error);
    }
    const settled: RecipeSlotAttempt = { ...held.value, outcome };
    const written = writeSlotAttempt({ attempt: settled, home });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok(settled);
  } finally {
    lock.value.release();
  }
}

/** What a retirement answered: the row it wrote the death onto, or the row it found in place of the one judged. */
export type SlotRetirement =
  | { readonly kind: "retired"; readonly attempt: RecipeSlotAttempt }
  | { readonly kind: "moved"; readonly current: RecipeSlotAttempt | null };

/**
 * Whether the row on disk is still the exact attempt a caller judged dead, so writing its death is safe. PURE.
 *
 * The same attempt number AND the same holder token, and nothing since has settled it any way but `failed`.
 * Every verdict that leads to a retirement is monotone on that one row: a lease past its expiry stays past
 * it, a pid the kernel answered ESRCH for does not come back, and a spent third attempt stays spent. So
 * identity is the whole re-judgement — no second probe is needed, and none could disagree.
 *
 * @param judged the attempt the caller's verdict was made over
 * @param stored what the ledger holds now, or `null`
 * @returns true when the death lands on the attempt that was judged
 */
function retirementStillApplies({
  judged,
  stored,
}: {
  readonly judged: { readonly attempt: number; readonly holderToken: string };
  readonly stored: RecipeSlotAttempt | null;
}): boolean {
  if (stored === null) {
    return false;
  }
  if (stored.attempt !== judged.attempt || stored.holderToken !== judged.holderToken) {
    return false;
  }
  return stored.outcome === null || stored.outcome.kind === "failed";
}

/**
 * Retire one firing the SCHEDULE is abandoning, rather than one a holder is settling.
 *
 * Deliberately separate from {@link settleSlotAttempt} and deliberately not a flag on it. Every path that
 * reaches this one is retiring a firing that NOBODY holds — every attempt spent, or an attempt abandoned
 * whose outcome cannot be established — so the holder's own token is not the caller's to quote. A boolean
 * on the settle would let a holder reach that behaviour by accident, which is the difference between an
 * escape and a hole.
 *
 * It is a COMPARE-AND-SET on the attempt the caller judged, checked under this call's own lock. The verdict
 * that sent a caller here was read under a lock already released, and in between another dispatcher may
 * have retaken the firing as a newer, live attempt — writing the death then would dead-letter a run still
 * in progress and stamp the watermark past its firing.
 * So a row that is no longer the judged attempt is left exactly as found and answered `moved`.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row whose firing is being abandoned
 * @param slotIso the firing being abandoned
 * @param judged the attempt number and holder token of the row the caller's verdict was made over
 * @param reason why it will never succeed
 * @param detail what a reader needs in order to go and look
 * @param nowIso the reference instant
 * @returns the row as written, the row found in its place, or why the ledger could not be reached
 */
export function retireSlot({
  home,
  recipeId,
  slotIso,
  judged,
  reason,
  detail,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly judged: { readonly attempt: number; readonly holderToken: string };
  readonly reason: RecipeSlotDeathReason;
  readonly detail: string;
  readonly nowIso: string;
}): Result<SlotRetirement, RecipeSlotAttemptError> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    if (!retirementStillApplies({ judged, stored: stored.value })) {
      return ok({ current: stored.value, kind: "moved" });
    }
    const outcome: RecipeSlotOutcome = { detail, kind: "dead", reason, settledAtIso: nowIso };
    const retired: RecipeSlotAttempt = { ...stored.value!, outcome };
    const written = writeSlotAttempt({ attempt: retired, home });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok({ attempt: retired, kind: "retired" });
  } finally {
    lock.value.release();
  }
}
