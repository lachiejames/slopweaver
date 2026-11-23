/**
 * `slopweaver browser close` — close one session's tab, detach, and forget its record. Its own file beside
 * `./actionRun.ts` because it shares none of `aim`/`act`'s door, page policy or receipt: what it shares is the
 * session plumbing in `./sessionShell.ts` and the session lock a reap's idle let-go also holds (`./sessionHold.ts`).
 *
 * ## What it does, and what it deliberately does not
 *
 * `tab-close` then `detach`, MEASURED: the owner's browser keeps running and the client's own `list`
 * reports no sessions. Chrome is never closed, and no tab but the one this session opened is touched — a tab
 * is the owner's, and closing one on a guess is the sort of unasked-for act the doctrine reserves for them.
 */
import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { readInteractionSession, removeInteractionSession } from "../../../browser/interactionSessionStore.js";
import { letGoOfBrowser } from "../../../browser/keepForeground.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { holdBrowserSession } from "../../../browser/sessionLock.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { fail, sessionClientDeps } from "./sessionShell.js";

/** What `close` is handed beside its session id: the home, and the recorded-profile door. */
interface CloseRequest {
  readonly sessionId: string;
  readonly home: string;
  readonly profiles: RecordedProfilePort;
}

/**
 * Run `browser close`: close the session's tab, detach, and forget it.
 *
 * Idempotent, and it reports partial cleanup rather than hiding it: a session whose client is already gone
 * still has a record to remove, and a caller that could not tell the two apart would leave records behind.
 *
 * The close runs under the session's lock, the one a reap's idle let-go holds, so the two never close the same
 * tab at once; a lock another process holds refuses SESSION_BUSY and closes nothing.
 *
 * @param sessionId the session to close
 * @param home the state home
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserClose({ sessionId, home, profiles }: CloseRequest): Promise<number> {
  const held = holdBrowserSession({ home, id: sessionId, nowIso: new Date().toISOString() });
  if (held.isErr()) {
    return fail({ problems: [BrowserActionErrors.sessionBusy({ detail: held.error, sessionId }).message] });
  }
  try {
    return await closeHeldSession({ home, profiles, sessionId });
  } finally {
    held.value.release();
  }
}

/* `browser close`'s body, run while the session's lock is held. */
async function closeHeldSession({ sessionId, home, profiles }: CloseRequest): Promise<number> {
  const stored = readInteractionSession({ home, id: sessionId });
  if (stored === undefined) {
    logger.out({ line: `browser close: no session ${sessionId} — nothing to close` });
    return EXIT_OK;
  }
  const deps = await sessionClientDeps({ home, profiles, session: stored.session });
  const problems = deps.isErr() ? deps.error : letGoOfBrowser({ deps: deps.value });
  // The RECORD goes either way: a session whose client cannot be reached is not one a later command may act
  // through, and leaving the record behind would invite exactly that.
  removeInteractionSession({ home, id: sessionId });
  if (problems.length === 0) {
    logger.out({ line: `browser close: ${sessionId} closed, your browser is untouched` });
    return EXIT_OK;
  }
  for (const problem of problems) {
    logger.error({ msg: `browser close: ${problem}` });
  }
  logger.error({
    msg:
      `browser close: ${sessionId}'s record is removed and no later command can act through it, but whether ` +
      "its tab actually closed is UNKNOWN — look in your own browser and close it by hand if it is still there.",
  });
  return EXIT_ERROR;
}
