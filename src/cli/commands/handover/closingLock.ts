/**
 * The one lock a row is CLOSED under. `handover settle`, `handover finish` and `handover close` hold it from the uncarded-page gate's
 * journal read to the terminal write, and `page publish` holds it while it appends the held run's `artifact`, so a
 * page cannot become the artifact between a gate reading "no page" and the row closing on that read —
 * the interleaving: a question naming `page:p`, answered; settle reads; publish appends
 * `artifact(page:p)`; settle closes the row although the only card predated the page.
 *
 * The key keeps settle's original spelling, so a settle already running under an older build still excludes a
 * publish or a finish from this one.
 */
import { acquireOperationLock, type OperationLockResult } from "../../../admit/operationLock.js";

/**
 * The lock key for closing one row.
 *
 * @param slug the row's slug, which is also its run's
 * @returns the operation-lock key
 */
function closingLockKey({ slug }: { slug: string }): string {
  return `handover-settle:${slug}`;
}

/**
 * Take the row's closing lock, never stale while its holder lives: a paused closer overtaken would write outside it.
 *
 * @param home the state home the lock lives under
 * @param slug the row's slug
 * @param nowIso the instant of the attempt
 * @returns a handle to release, or why another closer or publisher holds it
 */
export function acquireClosingLock({
  home,
  nowIso,
  slug,
}: {
  home: string;
  nowIso: string;
  slug: string;
}): OperationLockResult {
  return acquireOperationLock({
    home,
    key: closingLockKey({ slug }),
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
}
