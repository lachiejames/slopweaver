/**
 * The one lock that makes a command's claim on a browser session and a reap's idle let-go of it exclusive.
 *
 * Without it the two raced: a command could pass the liveness check a moment inside the
 * expiry, the reap could judge the still-untouched record idle, close the tab and remove the record, and the
 * command's touch would then RECREATE that record over a closed tab. Under this lock a claim reads, checks and
 * touches as one step, and an idle let-go re-reads, closes and removes as one step, so each sees the other
 * either wholly done or not begun.
 *
 * A claim holds it for one record read and write; every client command acting through a recorded session, the
 * opening ones included, for that one command (the touch inside it); every closer — the reap, `browser close`,
 * sign-in's, `inspect`'s, `present`'s and `hand post`'s look — for up to a release's three client commands. None
 * waits on contention: a claim refuses SESSION_BUSY and a let-go leaves the session for the next reap, so no
 * caller can stall behind another.
 */
import { acquireOperationLock, type OperationLockHandle } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";

/**
 * A held session lock is NEVER taken over from a LIVE holder, however old. Any finite bound lets a closer in
 * mid-command once the holder outlives it: a frozen process, or a wall clock that jumps forward. A holder that DIED mid-hold is freed at once by its pid and process start, whatever its age
 * (`../admit/operationLockHeld.ts` § `heldReason`), so a recycled pid cannot wedge it. What a stuck live holder
 * costs is only that its session stays open and answers busy until that process exits, and every hold is bounded
 * by `./terminalClient.ts`'s client command timeout in the first place.
 */
const SESSION_LOCK_STALE_AFTER_MS = Number.POSITIVE_INFINITY;

/**
 * Take one browser session's lock without waiting.
 *
 * @param home the state home the lock lives under
 * @param id the interaction session's id
 * @param nowIso the instant of the attempt
 * @returns the handle to release, or what the lock said about the process holding it
 */
export function holdBrowserSession({
  home,
  id,
  nowIso,
}: {
  home: string;
  id: string;
  nowIso: string;
}): Result<OperationLockHandle, string> {
  return acquireOperationLock({
    home,
    key: `browser-session:${id}`,
    nowIso,
    staleAfterMs: SESSION_LOCK_STALE_AFTER_MS,
  });
}

/**
 * Run one closer's body under the session's lock, so a close never lands while a command acting through the
 * session holds it. It does not wait: a held lock refuses SESSION_BUSY and runs nothing.
 * The body's client deps must be UNHELD ones — a body whose commands took this same lock again would be refused by
 * its own hold.
 *
 * @param home the state home the lock lives under
 * @param sessionId the interaction session's id
 * @param act the close, run only while the lock is held
 * @param nowIso the instant of the attempt; the wall clock unless a test supplies one
 * @returns what the close returned, or SESSION_BUSY when another process holds the session
 */
export function underSessionLock<T>({
  home,
  sessionId,
  act,
  nowIso = new Date().toISOString(),
}: {
  home: string;
  sessionId: string;
  act: () => T;
  nowIso?: string;
}): Result<T, BrowserActionError> {
  const held = holdBrowserSession({ home, id: sessionId, nowIso });
  if (held.isErr()) {
    return err(BrowserActionErrors.sessionBusy({ detail: held.error, sessionId }));
  }
  try {
    return ok(act());
  } finally {
    held.value.release();
  }
}
