/**
 * The real seams a browser reap runs over, for one home — shared by `machine reap`, which reaps every session the
 * home holds each sweep tick, and `browser open`, which lets go of its own opener's quiet sessions before it takes
 * another window. One copy, so the two can never disagree about how a tab is closed or a record forgotten.
 */
import { listStoredInteractionSessions, removeInteractionSession } from "../../../browser/interactionSessionStore.js";
import { letGoOfBrowser } from "../../../browser/keepForeground.js";
import { holdBrowserSession } from "../../../browser/sessionLock.js";
import { readListeningPorts, readLiveBrowserOwners, readProcessTable } from "../../../live/machine/devServerRead.js";
import { stateHomePaths } from "../../../stateHome.js";
import { clientDeps } from "../browser/sessionShell.js";
import type { BrowserReapDeps } from "./reapBrowser.js";

/**
 * How long each client command in a reap's close may take. Well above a measured interaction (about a second
 * once attached) and far below the client's own 60 s, because a reap runs inside every sweep tick and a
 * wedged relay would otherwise cost each command its whole minute.
 */
const REAP_CLOSE_COMMAND_TIMEOUT_MS = 15_000;

/**
 * The production browser-reap seams for one home.
 *
 * @param home the state home whose session records are judged and acted on
 * @returns the seams
 */
export function productionBrowserReapDeps({ home }: { home: string }): BrowserReapDeps {
  return {
    browserSessions: () => listStoredInteractionSessions({ home }),
    forgetBrowserSession: ({ id }) => {
      try {
        removeInteractionSession({ home, id });
        return undefined;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    holdBrowserSession: ({ id }) => {
      // A lock that could not even be staged (an unwritable home) is treated as held: the session is left for the
      // next reap rather than closed without the guard a command's claim relies on.
      try {
        const held = holdBrowserSession({ home, id, nowIso: new Date().toISOString() });
        return held.isOk() ? held.value.release : undefined;
      } catch {
        return undefined;
      }
    },
    listeningPorts: () => readListeningPorts(),
    liveBrowserOwners: ({ processes }) => readLiveBrowserOwners({ processes }),
    nowIso: () => new Date().toISOString(),
    processes: () => readProcessTable(),
    releaseBrowser: ({ session }) => {
      // The pin is only Chrome's launcher, and a release launches nothing: it talks to the daemon the session
      // already holds, so the pin that session was opened through is reused rather than the recorded profile
      // read out of the store on every sweep tick.
      const deps = clientDeps({ chromePinPath: stateHomePaths({ home }).chromePin, home, session });
      if (deps.isErr()) {
        return deps.error;
      }
      return letGoOfBrowser({ deps: { ...deps.value, commandTimeoutMs: REAP_CLOSE_COMMAND_TIMEOUT_MS } });
    },
    terminate: ({ pid }) => {
      try {
        process.kill(pid, "SIGTERM");
        return undefined;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  };
}
