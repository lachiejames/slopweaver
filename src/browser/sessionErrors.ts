/**
 * The session-lifecycle arms of the browser interaction lane's {@link ./actionErrors.BrowserActionError} — every
 * way the SESSION an action runs through, rather than the action itself, can fail: gone, idle, held by another
 * process, or unrecordable. Split from `./actionErrors.ts` along that seam so the union's file stays under the size
 * cap, never a second union: `BrowserActionError` is still the one a caller branches on, and `SessionErrors` is
 * spread into `BrowserActionErrors`, still the one constructor real code and test fixtures both build through.
 */

/** No live interaction session answers to that id — never opened, closed, or expired. */
export interface SessionLostError {
  readonly code: "SESSION_LOST";
  readonly message: string;
  readonly sessionId: string;
}

/**
 * A session record exists and has been idle too long to act through.
 *
 * Distinct from {@link SessionLostError} because the correction differs: nothing answers a lost id at all,
 * while this one names a session that is still on disk and whose page may have moved underneath it. Closing
 * it is part of the correction, and a caller that read "no such session" would not know to.
 */
export interface SessionIdleError {
  readonly code: "SESSION_IDLE";
  readonly message: string;
  readonly sessionId: string;
}

/**
 * Another process holds the session's lock at the instant a command tried to claim it: a reap letting go of it
 * after it went quiet, or a second command claiming the same session at the same moment. Nothing was done
 * through the tab. Distinct from {@link SessionIdleError} because the correction differs: retry once, and a
 * session the reap was closing then answers SESSION_LOST.
 */
export interface SessionBusyError {
  readonly code: "SESSION_BUSY";
  readonly message: string;
  readonly sessionId: string;
  /** What the lock said about its holder. */
  readonly detail: string;
}

/** The session's own record could not be written, so nothing later could find the session. */
export interface SessionRecordUnwritableError {
  readonly code: "SESSION_RECORD_UNWRITABLE";
  readonly message: string;
  /** Exactly what the filesystem said. */
  readonly detail: string;
}

/** Construct one session-lifecycle failure; reached as `BrowserActionErrors.<name>`, which spreads this in. */
export const SessionErrors = {
  sessionBusy: ({ sessionId, detail }: { sessionId: string; detail: string }): SessionBusyError => ({
    code: "SESSION_BUSY",
    detail,
    message:
      `browser session ${sessionId} is held by another process right now — a reap letting go of it, or another ` +
      `command claiming it — so nothing was done through it. Retry once; a session being closed then answers ` +
      `that it is gone. (${detail})`,
    sessionId,
  }),
  sessionIdle: ({ sessionId }: { sessionId: string }): SessionIdleError => ({
    code: "SESSION_IDLE",
    message:
      `browser session ${sessionId} has been idle too long to act through, so the page may have moved ` +
      `underneath it. Close it with \`slopweaver browser close --session ${sessionId}\` and open a fresh one.`,
    sessionId,
  }),
  sessionLost: ({ sessionId }: { sessionId: string }): SessionLostError => ({
    code: "SESSION_LOST",
    message:
      `no live browser session answers to ${sessionId} — it was closed, it expired, or it was never opened. ` +
      "Take a fresh one with `slopweaver browser open --url <url>`.",
    sessionId,
  }),
  sessionRecordUnwritable: ({ detail }: { detail: string }): SessionRecordUnwritableError => ({
    code: "SESSION_RECORD_UNWRITABLE",
    detail,
    message: `the browser session record could not be written: ${detail}`,
  }),
} as const;
