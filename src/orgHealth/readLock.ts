/**
 * The one lock every incident read takes, so two reads never walk the incident channel at once. `./read.ts` takes it
 * before anything else and releases it after its outcome.
 *
 * It is ADMISSION, not authority. A holder killed or suspended past {@link READ_LOCK_STALE_MS} is taken over, and an
 * older holder can then resume — so what keeps an older read from landing last is the snapshot's generation in the
 * store (`./port.ts`), never this lock. That makes it process-lifetime state, so it lives in the home's runtime
 * directory (`../stateRuntime.ts`) beside the fleet's (`../fleet/locks.ts`), and nothing of it is stored under the home.
 */
import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLock } from "../admit/operationLock.js";
import { runtimeLockDir } from "../stateRuntime.js";

import { type OrgHealthError, OrgHealthErrors } from "./errors.js";
import { READ_LOCK_STALE_MS } from "./policy.js";

/** The lock key every incident read takes. */
const READ_LOCK_KEY = "org-health-read";

/** The seam a read takes its lock through: production's is {@link takeReadLock}, a test's a plain function. */
export type TakeReadLock = (request: {
  readonly home: string;
  readonly nowIso: string;
}) => Result<{ readonly release: () => void }, OrgHealthError>;

/**
 * Take the one read lock, or say why it could not be taken. Marks nothing: the caller records the under-way marker,
 * in the store, either way.
 *
 * A killed holder's lock is taken over once its pid is dead or the lock is stale — judged by the wall clock the caller
 * hands in as `nowIso`, never `--now`, which a replay sets to any instant and would make a live holder read as stale.
 *
 * @param home the Slopweaver home whose runtime directory holds the lock
 * @param nowIso the wall-clock instant of the attempt
 * @returns the held lock's release, `READ_UNDER_WAY` while another read holds it, or `READ_LOCK_UNAVAILABLE`
 */
export const takeReadLock: TakeReadLock = ({ home, nowIso }) => {
  const directory = runtimeLockDir({ home });
  if (directory.isErr()) {
    return err(OrgHealthErrors.readLockUnavailable({ detail: directory.error.message }));
  }
  let lock: ReturnType<typeof acquireOperationLock>;
  try {
    lock = acquireOperationLock({
      directory: directory.value,
      home,
      key: READ_LOCK_KEY,
      nowIso,
      staleAfterMs: READ_LOCK_STALE_MS,
    });
  } catch (cause) {
    // The lock's own directory can fail to exist (a file where it should be), and that THROWS rather than answering
    // an error.
    return err(OrgHealthErrors.readLockUnavailable({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  if (lock.isErr()) {
    return err(OrgHealthErrors.readUnderWay({ detail: lock.error }));
  }
  return ok(lock.value);
};
