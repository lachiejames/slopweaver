/**
 * The supervisor-pin lock: one critical section over every Slopweaver verb that reads the supervisor seat and then
 * moves it — both arms of `cmux pin`, `cmux unpin` and `cmux takeover`.
 *
 * The seat has two halves, cmux's own pin and the pin record (`../sessions/supervisorPinStore.ts`), and each verb
 * checks one or both before it writes either. Unlocked, two of them could both pass their checks and both write: two
 * cmux pins left cmux reporting two pinned workspaces, and a cmux pin racing an app session's own pin or a takeover
 * could seat a cmux workspace beside an app record. Holding this lock from the first read to the last write makes the
 * check and the move one step for every verb that takes it.
 *
 * What it cannot serialise, by construction: a pin set by hand in cmux's own UI, a process using another home, or one
 * pointed at a different runtime root (`SLOPWEAVER_RUNTIME_ROOT`, a test override). Each is a writer that never asks.
 */
import type { Result } from "#lib/result.js";

import type { OperationLockHandle } from "../admit/operationLock.js";
import { acquireRuntimeLock, type RuntimeLockError } from "../admit/runtimeLock.js";

/** The lock's key in the home's runtime lock directory. */
const SUPERVISOR_PIN_LOCK_KEY = "supervisor-pin";

/** Take the supervisor-pin lock, as a verb's injected seam: a test passes a plain function in its place. */
export type HoldSupervisorPinLock = () => Result<OperationLockHandle, RuntimeLockError>;

/**
 * Take the supervisor-pin lock for one home, or say why not. A held lock refuses at once; the refusal's message is
 * the lock's own line, naming the holder.
 *
 * @param home the Slopweaver home whose pin record the section guards
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the typed refusal
 */
export function acquireSupervisorPinLock({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<OperationLockHandle, RuntimeLockError> {
  return acquireRuntimeLock({ home, key: SUPERVISOR_PIN_LOCK_KEY, nowIso });
}
