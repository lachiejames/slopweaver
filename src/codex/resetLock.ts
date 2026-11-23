/**
 * The one home-wide lock every `codex reset` run holds from its journal read to its last settle.
 *
 * ## Why it exists
 *
 * The idempotency key protects a RETRY of one attempt; it does nothing for two runs that each read the journal,
 * each find no open attempt, and each mint a key. Once the chair's tick claims on its own (`./resetFleet.ts`), a
 * tick and a hand-run `codex reset --plan` can overlap, and that race would spend two resets on one refill. A run that finds the lock held sends nothing and defers — the next tick runs it again.
 *
 * ## The stale bound
 *
 * {@link RESET_LOCK_STALE_MS} must outlast a legitimate whole-fleet run, or a second run could take the lock over
 * mid-spend. A run is one batch live read, then per claimed store a re-read, one consume exchange (20s deadline,
 * `../cli/commands/codex/resetSend.ts`), one after-read and one fleet re-read (8s live-read deadlines each, plus the
 * register and rollout scan). So the run itself stops starting claims at {@link RESET_RUN_BUDGET_MS} and defers the
 * rest to the next tick, leaving the stale bound five minutes past it — several claims' worth of margin for the one
 * already under way (a fleet large enough to run past the bound would let a hand run in). Either form
 * checks the budget again as the last step before minting a fresh key (`../cli/commands/codex/resetOne.ts`), so a run
 * suspended past it starts no claim; the instant between that check and the send is the residue a lease without
 * fencing cannot close.
 */
import { acquireOperationLock, type OperationLockResult } from "../admit/operationLock.js";

/** The lock's key — one per home, shared by both forms of the verb. */
const RESET_LOCK_KEY = "codex-reset";

/** How long a `--at-limit` run may keep STARTING claims, measured from the lock. See the header's § The stale bound. */
export const RESET_RUN_BUDGET_MS = 10 * 60 * 1000;

/** How old a held reset lock may be before another run may take it over. See the header's § The stale bound. */
const RESET_LOCK_STALE_MS = RESET_RUN_BUDGET_MS + 5 * 60 * 1000;

/**
 * Take the reset lock for one home.
 *
 * @param home the state home whose claims journal the run reads and writes
 * @param nowIso the instant of the attempt
 * @returns a handle to release, or why it is held
 */
export function takeCodexResetLock({ home, nowIso }: { home: string; nowIso: string }): OperationLockResult {
  return acquireOperationLock({ home, key: RESET_LOCK_KEY, nowIso, staleAfterMs: RESET_LOCK_STALE_MS });
}
