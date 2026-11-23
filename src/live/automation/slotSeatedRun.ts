/**
 * Admitting the SEATED run of a firing a seat already took: the compare-and-set that stamps `runStartedAtIso`
 * and the run's own pid under the ledger mutex. Split out of `./slotLedger.ts` on size alone, so that module
 * keeps the keys, the row read and write, the one `recipe-slot-attempts` mutex, the takes and the give-backs;
 * this takes that same mutex through its `acquireLedgerLock` and writes through its `writeSlotAttempt`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { judgeSlotAttempt, type RecipeSlotAttempt, settleableAttempt } from "./slotAttempt.js";
import { type RecipeSlotAttemptError, RecipeSlotAttemptErrors } from "./slotAttemptErrors.js";
import { acquireLedgerLock, readSlotAttempt, type SlotAttemptTake, writeSlotAttempt } from "./slotLedger.js";

/**
 * Take the SEATED run of a firing a seat already holds — the compare-and-set the seat path was missing.
 *
 * `automation seat` takes the firing and hands its token to a workspace, so by the time the seated session runs
 * the row the record is already open under that token. Reading it and running was not enough: **the read
 * admits every time**, so two invocations of the seated command quoting one token — a retry typed over a
 * command that looked stalled, the same line run in two panes — both matched and both reached the effect.
 * A review of this lane's own diff found that case, the counterexample this
 * function exists to refuse.
 *
 * So admission WRITES: it stamps `runStartedAtIso` under the ledger mutex, and a second caller finds it
 * already set and is refused. One firing, one run, whichever path took it.
 *
 * It is deliberately not `beginSlotAttempt`: that mints a NEW attempt, and a seated run is not a new attempt
 * — it is the one the seat already opened, finally being performed.
 *
 * The same write stamps `holderPid`. The seat's TAKE is PID-less, because its CLI exits before the session
 * runs, but the RUN is performed in the process calling this, so its death has to be visible to the next take.
 * MEASURED: a seated `resync-corpus-slack` run died of a heap-OOM abort, which no
 * signal handler can catch. Its attempt still carried `holderPid: null`, so it read HELD until its
 * lease ran out and neither a seat nor a retry could retire it.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being run
 * @param slotIso the firing this run covers
 * @param holderToken the token the seat handed this session
 * @param holderPid the process about to perform the effect, which a later take probes for liveness
 * @param nowIso the reference instant
 * @returns the attempt this process now holds, or why it may not run
 */
export function startSeatedRun({
  home,
  recipeId,
  slotIso,
  holderToken,
  holderPid,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holderToken: string;
  readonly holderPid: number;
  readonly nowIso: string;
}): Result<SlotAttemptTake, RecipeSlotAttemptError> {
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
    // Nothing to probe yet: the seat's take recorded no pid, and this call is what writes one.
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso, stored: held.value });
    if (verdict.kind !== "held" || held.value.runStartedAtIso !== null) {
      return ok({ kind: "refused", verdict });
    }
    const running: RecipeSlotAttempt = { ...held.value, holderPid, runStartedAtIso: nowIso };
    const written = writeSlotAttempt({ attempt: running, home });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok({ attempt: running, kind: "taken" });
  } finally {
    lock.value.release();
  }
}
