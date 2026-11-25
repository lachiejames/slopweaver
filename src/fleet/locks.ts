/**
 * The locks that keep two recovery passes from relaunching the same seat, two revives from restarting cmux twice, and
 * two Recovery checks from opening throwaway sessions beside each other.
 *
 * Each is the repository's operation lock (`../admit/operationLock.ts`): a lock renamed into place, so two passes
 * taking over one left by a dead pass seat exactly one, and a holder known by its pid AND its process start, so a dead
 * pass's pid reused by another process never holds it. Never stale while its holder lives — a pass waits on a chair
 * for minutes, a restart waits minutes for the app — and free the instant its holder dies.
 *
 * That makes them PROCESS-LIFETIME state, so they live in the home's runtime directory (`../stateRuntime.ts`) rather
 * than the store: an exclusion that ends with its holder needs no lease, no expiry and no takeover row.
 */
import { err, type Result } from "#lib/result.js";

import { acquireOperationLock, type OperationLockHandle } from "../admit/operationLock.js";
import { runtimeLockDir } from "../stateRuntime.js";
import { type FleetError, FleetErrors } from "./errors.js";

/** The recovery pass's key in the runtime lock directory. */
const FLEET_LOCK_KEY = "fleet-resume";

/** The revive verb's key in the runtime lock directory: two callers never restart cmux twice. */
const REVIVE_LOCK_KEY = "cmux-revive";

/** The Recovery check's key: its throwaway sessions are opened and closed one at a time. */
const RECOVER_LOCK_KEY = "fleet-recover";

/**
 * Take one process-lifetime lock in a home's runtime directory, or say why not.
 *
 * @param home the Slopweaver home whose runtime directory holds it
 * @param key the lock's name
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the lock's own refusal
 */
function acquireRuntimeLock({
  home,
  key,
  nowIso,
}: {
  home: string;
  key: string;
  nowIso: string;
}): Result<OperationLockHandle, FleetError> {
  const directory = runtimeLockDir({ home });
  if (directory.isErr()) {
    return err(FleetErrors.runtimeUnavailable({ detail: directory.error.message }));
  }
  return acquireOperationLock({
    directory: directory.value,
    home,
    key,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  }).mapErr((detail) => FleetErrors.lockHeld({ detail }));
}

/**
 * Take the recovery lock, or say why not.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the lock's own refusal
 */
export function acquireFleetLock({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<OperationLockHandle, FleetError> {
  return acquireRuntimeLock({ home, key: FLEET_LOCK_KEY, nowIso });
}

/**
 * Take the revive lock, or say why not — the same lock as recovery's, under its own key.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the lock's own refusal
 */
export function acquireCmuxReviveLock({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<OperationLockHandle, FleetError> {
  return acquireRuntimeLock({ home, key: REVIVE_LOCK_KEY, nowIso });
}

/**
 * Take the Recovery check's lock, or say why not — a third key, so a running `fleet resume` never holds it off.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant of the attempt
 * @returns the handle that releases it, or the lock's own refusal
 */
export function acquireFleetRecoverLock({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<OperationLockHandle, FleetError> {
  return acquireRuntimeLock({ home, key: RECOVER_LOCK_KEY, nowIso });
}
