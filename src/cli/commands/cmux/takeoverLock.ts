/**
 * `cmux takeover`'s critical section: gates (b) and (c) and steps 4–6, run under the supervisor-pin lock
 * (`../../../supervisor/pinLock.ts`).
 *
 * Gate (a), the sweep drain, and the owner-turn gate run BEFORE the lock: they read only this session, and the drain
 * waits up to fifteen seconds, which a lock held across it would make every concurrent `cmux pin` refuse through.
 * From the first read of the seat — cmux's own pin and the pin record, in `predecessorGates` — to the last write of
 * step 6, nothing else that takes the lock can move the seat. Step 5's close and step 6's row stay inside: releasing
 * once this session is seated would split one operational sequence into two halves a crash could separate. A
 * `--dry-run` moves nothing, so it never takes the lock and a pin in flight never refuses it.
 */
import { logger } from "../../../lib/logger.js";
import type { HoldSupervisorPinLock } from "../../../supervisor/pinLock.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Run the takeover's seat-reading gates and the act they allow while the supervisor-pin lock is held, releasing it on
 * every path. A held lock refuses before the gates read anything.
 *
 * @param holdPinLock takes the supervisor-pin lock
 * @param gates gates (b) and (c): the gated predecessor, or the exit code of a refusal already printed
 * @param act what the gated predecessor allows: steps 4–6
 * @returns the process exit code
 */
export async function runLockedTakeover<Predecessor extends object>({
  holdPinLock,
  gates,
  act,
}: {
  holdPinLock: HoldSupervisorPinLock;
  gates: () => Promise<Predecessor | number>;
  act: (options: { predecessor: Predecessor }) => Promise<number>;
}): Promise<number> {
  const lock = holdPinLock();
  if (lock.isErr()) {
    logger.error({ msg: `cmux takeover: refusing — ${lock.error.message}` });
    return EXIT_ERROR;
  }
  try {
    const predecessor = await gates();
    if (typeof predecessor === "number") {
      return predecessor;
    }
    return await act({ predecessor });
  } finally {
    lock.value.release();
  }
}
