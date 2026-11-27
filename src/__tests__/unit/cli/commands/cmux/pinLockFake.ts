/**
 * A plain fake of the supervisor-pin lock for the `cmux pin`, `cmux unpin` and `cmux takeover` workflow tests: it
 * journals `lock` when asked and `release` when released, and refuses as a live holder when told to. Not a mock — a
 * function passed in through the verb's own seam.
 */
import { OperationLockAcquireErrors } from "../../../../../admit/operationLockHeld.js";
import { err, ok } from "../../../../../lib/result.js";
import type { HoldSupervisorPinLock } from "../../../../../supervisor/pinLock.js";

/** The line a held fake lock refuses with. */
export const HELD_LOCK_MESSAGE = "operation lock held by pid 4242 (it was ALIVE when checked at 2026-11-27T10:00:00Z)";

/**
 * A fake supervisor-pin lock journalling into `events`.
 *
 * @param events the journal every fake in one case appends to, in call order
 * @param held whether the lock refuses as held by another live process
 * @returns the seam to inject
 */
export function fakePinLock({ events, held = false }: { events: string[]; held?: boolean }): HoldSupervisorPinLock {
  return () => {
    events.push("lock");
    if (held) {
      return err(OperationLockAcquireErrors.contended({ message: HELD_LOCK_MESSAGE }));
    }
    return ok({
      release: () => {
        events.push("release");
      },
      stillHeld: () => true,
      stoleFromPid: undefined,
    });
  };
}
