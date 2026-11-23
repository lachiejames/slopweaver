/**
 * Holding a live interaction session while a verb acts through it — the half of the session plumbing a reap's idle
 * let-go made necessary.
 *
 * A file of its own beside `./sessionShell.ts` because every function here answers ONE question that file's
 * reaching-and-looking does not: what stops a reap closing the tab under a running verb. Each takes the session's
 * lock (`../../../browser/sessionLock.ts`), the one a reap's idle let-go also holds, and touches the record inside
 * it — at the claim, before every client command, when a look is filed, and when a one-shot look closes its own tab.
 */
import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";
import {
  readInteractionSession,
  removeInteractionSession,
  removeInteractionWorkspace,
  writeInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import { letGoOfBrowser } from "../../../browser/keepForeground.js";
import { holdBrowserSession, underSessionLock } from "../../../browser/sessionLock.js";
import type { TerminalClientDeps } from "../../../browser/terminalClient.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { elementsLines } from "./elementsReceipt.js";
import { liveSession } from "./sessionShell.js";

/**
 * Load a live session a verb is about to act through, and touch it before the act begins.
 *
 * A look filed afterwards touches it again, but that is too late on its own: a reap closes a background session
 * idle past its expiry, and a command that loaded the session inside the expiry but finished outside it would
 * lose its tab mid-act, because its record still read as untouched. Only `browser read
 * --under|--find` keeps {@link liveSession}, as it searches the filed look and never reaches the tab.
 *
 * The read, the check and the touch run under the session's lock (`../../../browser/sessionLock.ts`), the one a
 * reap's idle let-go also holds, so a claim never touches a record a reap is mid-way through removing.
 *
 * @param home the state home
 * @param sessionId the id the caller named
 * @param nowIso the instant to judge liveness against, and the instant the session is touched at
 * @returns the touched session and its latest observation, or the problems to print
 */
export function claimLiveSession({
  home,
  sessionId,
  nowIso,
}: {
  home: string;
  sessionId: string;
  nowIso: string;
}): Result<{ readonly session: InteractionSession; readonly observation: PageObservation | null }, BrowserActionError> {
  const held = holdBrowserSession({ home, id: sessionId, nowIso });
  if (held.isErr()) {
    return err(BrowserActionErrors.sessionBusy({ detail: held.error, sessionId }));
  }
  try {
    return touchWhileHeld({ home, nowIso, sessionId });
  } finally {
    held.value.release();
  }
}

/** Check a session is live and touch it, with its lock already held by the caller. */
function touchWhileHeld({
  home,
  sessionId,
  nowIso,
}: {
  home: string;
  sessionId: string;
  nowIso: string;
}): Result<{ readonly session: InteractionSession; readonly observation: PageObservation | null }, BrowserActionError> {
  return liveSession({ home, nowIso, sessionId }).andThen((live) => {
    // The later of the two, never `nowIso` blindly: a clock set back must not move the touch backwards.
    const touchedAtIso = laterIso({ a: live.session.touchedAtIso, b: nowIso });
    const touched = { observation: live.observation, session: { ...live.session, touchedAtIso } };
    return writeInteractionSession({ home, stored: touched }).map(() => touched);
  });
}

/**
 * Client deps that hold the session's lock for every command and touch the record inside it.
 *
 * A verb's claim at load touches the session once, and a run of commands each allowed `CLIENT_COMMAND_TIMEOUT_MS`
 * can outlast the 15-minute expiry — an aim's three screenshots with their retries, a long scroll — so a reap
 * could judge the session idle mid-verb and close the tab under it. Touching
 * before each command was not enough on its own: with the lock released before the command ran, a verb paused
 * after its touch, or a wall clock stepped forward mid-command, still let a reap's let-go take the free lock and
 * close the tab under a running command. So the lock is held from the touch to the command's
 * end: a closer meeting it is refused or leaves the session for the next reap, and never acts during a command.
 * A session gone, expired or BUSY refuses the command before it runs; a claim meeting another claim is told to
 * retry once, as at load.
 *
 * @param deps the client deps for the session, as resolved
 * @param sessionId the session the verb acts through
 * @param home the state home the session record lives under
 * @param clock the instant each command claims at; the wall clock unless a test supplies one
 * @returns the same deps, holding and touching the session for each command
 */
export function keptAliveDeps({
  deps,
  sessionId,
  home,
  clock = () => new Date().toISOString(),
}: {
  deps: TerminalClientDeps;
  sessionId: string;
  home: string;
  clock?: () => string;
}): TerminalClientDeps {
  return {
    ...deps,
    holdForCommand: () => {
      const nowIso = clock();
      const held = holdBrowserSession({ home, id: sessionId, nowIso });
      if (held.isErr()) {
        return err(BrowserActionErrors.sessionBusy({ detail: held.error, sessionId }));
      }
      const touched = touchWhileHeld({ home, nowIso, sessionId });
      if (touched.isErr()) {
        held.value.release();
        return err(touched.error);
      }
      return ok(held.value.release);
    },
  };
}

/**
 * End a one-shot look — `browser inspect`'s, `hand post --url`'s — by closing its tab and, when the client confirmed
 * that, removing its record and workspace. All of it runs under the session's lock, so no later command can start
 * between the close and the removal.
 *
 * @param deps the client deps WITHOUT `keptAliveDeps`' hold: this call takes the lock itself, once
 * @param home the state home the session record lives under
 * @param id the session the look recorded
 * @returns how many problems the close met, a lock that could not be taken counting as one; zero when all went
 */
export function closeOneShotLook({ deps, home, id }: { deps: TerminalClientDeps; home: string; id: string }): number {
  const closed = underSessionLock({
    act: () => {
      const problems = letGoOfBrowser({ deps });
      if (problems.length > 0) {
        return problems.length;
      }
      removeInteractionSession({ home, id });
      // The workspace held only this look's snapshot and picture, both read or dropped by now.
      const removed = removeInteractionWorkspace({ home, id });
      if (removed.isErr()) {
        return 1;
      }
      return 0;
    },
    home,
    sessionId: id,
  });
  if (closed.isErr()) {
    return 1;
  }
  return closed.value;
}

/**
 * Read a fresh look's outline, then file the look as the session's latest — the one way any verb files a look.
 *
 * The outline is read FIRST, in `--json` mode too: a look whose snapshot cannot be read is one `act`'s ref check
 * refuses, so filing it would replace a citable look with an uncitable one. And a look the record does not hold
 * is one `act` refuses to cite, so a failed write is never a successful read either.
 *
 * The record is read again first, for two reasons a reap makes matter. A record gone
 * since the command began was closed underneath it, and filing would RECREATE it over a closed tab, so that is
 * refused. And a command that began earlier than another but finishes later must not move the touch BACKWARDS,
 * or a session in use could read as idle, so the touch is the later of the record's and this command's. The
 * re-read and the write sit under the session's lock: unlocked, a close landing between them would
 * be undone by the write, so a held lock refuses the filing and the `notFiled` line says the act still happened.
 *
 * @param observation the fresh look, not yet filed
 * @param session the live session the look is filed under
 * @param nowIso the instant the session is touched at, unless the record already carries a later one
 * @param home the state home the session record lives under
 * @param notFiled the line naming what already happened, and that the look was not filed
 * @returns the look's outline lines, or every line of the refusal
 */
export function fileLook({
  observation,
  session,
  nowIso,
  home,
  notFiled,
}: {
  observation: PageObservation;
  session: InteractionSession;
  nowIso: string;
  home: string;
  notFiled: string;
}): Result<readonly string[]> {
  const elements = elementsLines({ observation, selection: { kind: "outline" }, sessionId: session.id });
  if (elements.isErr()) {
    return err([elements.error.message, notFiled]);
  }
  const held = holdBrowserSession({ home, id: session.id, nowIso });
  if (held.isErr()) {
    return err([BrowserActionErrors.sessionBusy({ detail: held.error, sessionId: session.id }).message, notFiled]);
  }
  try {
    const current = readInteractionSession({ home, id: session.id });
    if (current === undefined) {
      return err([BrowserActionErrors.sessionLost({ sessionId: session.id }).message, notFiled]);
    }
    const filed = writeInteractionSession({
      home,
      stored: {
        observation,
        session: { ...session, touchedAtIso: laterIso({ a: current.session.touchedAtIso, b: nowIso }) },
      },
    });
    if (filed.isErr()) {
      return err([filed.error.message, notFiled]);
    }
    return ok(elements.value);
  } finally {
    held.value.release();
  }
}

/** The later of two instants; `b`, the caller's own, when `a` cannot be read. */
function laterIso({ a, b }: { a: string; b: string }): string {
  const aMs = Date.parse(a);
  if (Number.isNaN(aMs) || aMs <= Date.parse(b)) {
    return b;
  }
  return a;
}
