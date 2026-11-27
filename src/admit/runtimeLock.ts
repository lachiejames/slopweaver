/**
 * A process-lifetime operation lock in a home's runtime directory, with BOTH refusals typed: the supervisor pin's
 * (`../supervisor/pinLock.ts`). The fleet's own locks (`../fleet/locks.ts`) take the string form instead, where a
 * staging fault throws rather than reading as a held lock; a caller of this one gets that fault as `LOCK_REFUSED`.
 *
 * It is the repository's operation lock (`./operationLock.ts`), renamed into place so two contenders over a lock a
 * dead holder left seat exactly one, with a holder known by its pid AND its process start, so a reused pid never holds
 * it. Never stale while its holder lives, which is why it lives in the runtime directory (`../stateRuntime.ts`) rather
 * than the home: an exclusion that ends with its holder needs no lease, no expiry and no takeover row.
 *
 * Each caller maps the refusal into its own domain's words; this module keeps both halves typed and translates
 * neither, so a caller that prints `message` prints the lock's own line — the holder's pid, whether it was alive when
 * checked, and the instant it took the lock.
 */
import { err, type Result } from "#lib/result.js";

import { type RuntimeDirectoryError, runtimeLockDir } from "../stateRuntime.js";
import { acquireOperationLockDetailed, type OperationLockHandle } from "./operationLock.js";
import type { OperationLockAcquireError } from "./operationLockHeld.js";

/** Why a runtime lock was not taken: the runtime directory could not be found, or the lock itself refused. */
export type RuntimeLockError = OperationLockAcquireError | RuntimeDirectoryError;

/**
 * Take one process-lifetime lock in a home's runtime directory, or say why not. Never waits: a held lock refuses at
 * once, and running again once the holder finishes is the caller's answer.
 *
 * @param home the Slopweaver home whose runtime directory holds it; it must already exist
 * @param key the lock's name
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the typed refusal
 */
export function acquireRuntimeLock({
  home,
  key,
  nowIso,
}: {
  home: string;
  key: string;
  nowIso: string;
}): Result<OperationLockHandle, RuntimeLockError> {
  const directory = runtimeLockDir({ home });
  if (directory.isErr()) {
    return err(directory.error);
  }
  return acquireOperationLockDetailed({
    directory: directory.value,
    home,
    key,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
}
