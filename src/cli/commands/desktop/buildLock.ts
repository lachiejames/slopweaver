/**
 * The one lock every build of the app takes, so a prebuild and an install never build in the same `desktop/` at
 * once, and an install never takes the staged build while a prebuild is replacing it. An install WAITS for a
 * prebuild rather than refusing — the owner's press should land on the build that is nearly ready, not on an error — and
 * a prebuild waits for an install the same way. The wait is bounded by {@link PREBUILD_WAIT_MS}, longer than a
 * measured build; a lock still held past it is reported with the lock's own reason.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { OperationLockHandle, OperationLockResult } from "../../../admit/operationLock.js";
import { PREBUILD_POLL_MS, PREBUILD_WAIT_MS } from "../../../desktop/stagedBuild.js";

/** The lock's key, in the app's own support folder beside `desktop-install`'s. */
export const BUILD_LOCK_KEY = "desktop-build";

/**
 * Take the build lock, waiting while another build holds it.
 *
 * @param acquire one attempt at the lock
 * @param pause wait between attempts
 * @param nowMs the clock the bound is judged on
 * @param waiting told once, the first time the lock is held, so the run says what it is waiting for
 * @returns the lock, or the last refusal once the bound is spent
 */
export async function holdBuildLock({
  acquire,
  pause,
  nowMs,
  waiting,
}: {
  acquire: () => OperationLockResult;
  pause: (wait: { ms: number }) => Promise<void>;
  nowMs: () => number;
  waiting: (refusal: { detail: string }) => void;
}): Promise<Result<OperationLockHandle, string>> {
  const started = nowMs();
  let said = false;
  for (;;) {
    const lock = acquire();
    if (lock.isOk()) {
      return ok(lock.value);
    }
    if (nowMs() - started >= PREBUILD_WAIT_MS) {
      return err(lock.error);
    }
    if (!said) {
      waiting({ detail: lock.error });
      said = true;
    }
    await pause({ ms: PREBUILD_POLL_MS });
  }
}
