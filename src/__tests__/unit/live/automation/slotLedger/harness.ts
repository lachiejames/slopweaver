/**
 * The slot ledger tests' shared fixture firing: one row, one slot, one lease, and the take every test file
 * starts from, run against the explicit temp home its caller minted.
 */
import type { Result } from "#lib/result.js";

import type { RecipeSlotAttemptError } from "../../../../../live/automation/slotAttemptErrors.js";
import { beginSlotAttempt, type SlotAttemptTake } from "../../../../../live/automation/slotLedger.js";

export const RECIPE = "growth-ops";
export const SLOT = "2026-09-16T12:00:00.000Z";
export const LEASE = "2026-09-17T12:00:00.000Z";
/** The pid a seated run stamps; only ever handed to an injected liveness fake, never probed for real. */
export const SEATED_PID = 4242;

/**
 * Take the fixture firing in the caller's temp home, as a PID-less holder named for its token.
 *
 * @returns the attempt taken or refused, or the ledger failure
 */
export const takeSlot = ({
  holderToken,
  home,
  nowIso,
}: {
  holderToken: string;
  home: string;
  nowIso: string;
}): Result<SlotAttemptTake, RecipeSlotAttemptError> =>
  beginSlotAttempt({
    holder: `holder-${holderToken}`,
    holderPid: null,
    holderToken,
    home,
    leaseExpiresIso: LEASE,
    nowIso,
    processAlive: () => true,
    recipeId: RECIPE,
    slotIso: SLOT,
  });
