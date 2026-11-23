/**
 * A fleet browser session never keeps the owner's foreground: the terminal-client lane's attach and close, wrapped so
 * whatever the owner was looking at is back in front the moment the client returns.
 *
 * The failure it prevents is a session's agent window landing in front of the owner's screen while they share it.
 * The walk lane (`./relaySession.ts`) gives the foreground back; the
 * terminal-client lane — `browser open`, `present`, `inspect`, `close` and `machine reap` — would otherwise not, so the
 * agent window it attached would stay in front of whatever the owner was showing until something else took it back.
 *
 * ## What this lane asks for, and what it cannot stop
 *
 * Nothing here asks for focus but ONE recovery. The attach is exactly {@link BACKGROUND_ATTACH_ARGS}; the only
 * `bringToFront` ever sent is {@link TAB_ACTIVATION_ARGS}, after a screenshot of the session's tab has already
 * timed out (`./viewportCapture.ts`), and it is wrapped the same way as an attach; and a close goes through a
 * daemon that is already connected — `playwright-core`'s daemon
 * connects ONCE at start and exits when that connection closes (`exitOnClose: true`), and a command to a
 * session with no daemon is refused rather than re-attached, so a close never opens a connect page. Reproduce:
 * `grep -n "exitOnClose: true" node_modules/playwright-core/lib/coreBundle.js`.
 *
 * Two things outside this repository still bring the window forward, once per ATTACH, and no flag this lane
 * could pass stops either: Chrome activates itself when the relay hands it the connect URL, and the Playwright
 * extension focuses the window it connects — `chrome.windows.update(tab.windowId, { focused: true })` in its
 * `_connectTab`, unconditionally (`./foreground.ts` carries the reproduce line). So an attach is snapshot-before,
 * restore-after: measured on the walk lane at under a second in front, against the window staying there.
 *
 * The restore is best effort, and says so when it fails: macOS can refuse the Apple Event that raises the owner's
 * window (Automation permission withdrawn, Chrome busy), and then the agent window stays in front. That is
 * reported on stderr rather than swallowed — nothing here can force a window order
 * the OS refused, but a session must not believe it gave the owner's screen back when it did not.
 *
 * After the restore the owner's window is raised back over the agent's in Chrome's own order, and a session opened to be
 * SHOWN skips both — its {@link WindowPlacement} is chosen at `open` and carried on the session record, so every
 * later activation honours it (owner ruling; `./foreground.ts` § background by default).
 */
import { logger } from "../lib/logger.js";
import type { Result } from "../lib/result.js";
import type { BrowserActionError } from "./actionErrors.js";
import {
  actOnCloseRestore,
  agentWindowAfterAttach,
  raiseWindowBehindAgent,
  readChromeWindowIds,
  UNNAMED_AGENT_WINDOW_LINE,
  unraisedLine,
  unrestoredLine,
} from "./backgroundPlacement.js";
import {
  actOn,
  CHROME_BUNDLE_ID,
  closeRestoreAction,
  type ForegroundRestoreAction,
  type ForegroundRun,
  type ForegroundSnapshot,
  foregroundRestoreAction,
  readForeground,
  realForegroundRun,
  restoreCommandFailed,
  type WindowPlacement,
  wasWatchingAgentWindow,
} from "./foreground.js";
import { runClientCommand, type TerminalClientDeps } from "./terminalClient.js";

/** The one attach the terminal-client lane sends: the extension relay, with nothing asking for focus. */
export const BACKGROUND_ATTACH_ARGS: readonly string[] = ["attach", "--extension=chrome"];

/**
 * The one activation the terminal-client lane sends: the session's OWN tab brought to the front.
 *
 * The source is fixed and is one argv element, so nothing a page says reaches it. `run-code` evaluates it as
 * `(source)(page)` against the session's current page, the same `page.bringToFront()` the walk snippet's second
 * screenshot attempt makes (`./pageVisitSnippet.ts`).
 */
export const TAB_ACTIVATION_ARGS: readonly string[] = ["run-code", "async (page) => { await page.bringToFront(); }"];

/** Where a failed restore is said: stderr, so a verb's stdout stays its own answer. */
export type UnrestoredReport = (line: string) => void;

/* The production report. */
const reportOnStderr: UnrestoredReport = (line) => {
  logger.error({ msg: line });
};

/*
 * Why the foreground may not have been given back, or `undefined` when it was, or when nothing moved. Pure.
 *
 * Three cases, all said rather than swallowed: a restore command macOS refused, a foreground that
 * could not be read on one side at all, and a decision to leave the screen alone that rests on a Chrome
 * which would not name its front window — two windows it will not name look identical, so a change between
 * them is invisible.
 */
function unrestoredWhy({
  before,
  now,
  outcome,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
  outcome: ForegroundRestoreAction;
}): string | undefined {
  if (outcome.kind === "leave" && restoreCommandFailed({ outcome })) {
    return unrestoredLine({ why: outcome.why });
  }
  // A probe that could not run at all — `lsappinfo` refused or missing — leaves nothing to restore to or compare
  // against, and is said for the same reason.
  if (before === null || now === null) {
    return "browser: the macOS foreground could not be read, so whether an agent window is in front of yours could not be checked";
  }
  const unnamed = [before, now].some(
    (snapshot) => snapshot.bundleId === CHROME_BUNDLE_ID && snapshot.chromeWindowId === null,
  );
  if (outcome.kind === "leave" && unnamed) {
    return "browser: Chrome would not name its front window, so whether an agent window is in front of yours could not be checked";
  }
  return undefined;
}

/* Say it, when there is something to say, and answer whether anything was. */
function sayIfUnrestored({
  before,
  now,
  outcome,
  report,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
  outcome: ForegroundRestoreAction;
  report: UnrestoredReport;
}): boolean {
  const why = unrestoredWhy({ before, now, outcome });
  if (why === undefined) {
    return false;
  }
  report(why);
  return true;
}

/**
 * Run an attach and, for a session that stays in the background, give the foreground back to whatever held it
 * before and raise the owner's window back over the agent's.
 *
 * The attach returns once the extension has connected — and focused — the agent window, so Chrome's front
 * window at that instant IS the agent's own, which is the id the restore compares against. The restore runs
 * whichever way the attach ended: a failed one may still have opened the connect page in front of the owner. Raising
 * the owner's window runs AFTER it, because the restore's rule asks whether the agent window is in front now.
 *
 * A `foreground` session is one a run chose to show the owner, so nothing is put back at all.
 *
 * @param attach the client command that attaches
 * @param placement whether the owner's window goes back over the agent's or the agent's stays where the attach put it
 * @param run the foreground probe and restore seam
 * @param report where a failed restore is said, stderr unless a test collects it
 * @returns whatever the attach returned
 */
export function attachInBackground<T>({
  attach,
  placement,
  run,
  report = reportOnStderr,
}: {
  attach: () => T;
  placement: WindowPlacement;
  run: ForegroundRun;
  report?: UnrestoredReport;
}): T {
  if (placement === "foreground") {
    return attach();
  }
  const before = readForeground({ run });
  const beforeIds = readChromeWindowIds({ run });
  try {
    return attach();
  } finally {
    const now = readForeground({ run });
    const outcome = actOn({ action: attachRestoreAction({ before, now }), run });
    const alreadySaid = sayIfUnrestored({ before, now, outcome, report });
    sendBehindOwners({ alreadySaid, before, beforeIds, now, report, run });
  }
}

/*
 * Raise the window behind the agent's over it, so a Cmd-Tab back to Chrome lands the owner in their own window rather than
 * the agent's. The agent's is Chrome's front window at the post-attach reading, or — when the owner is in another app —
 * whatever newly topped Chrome's own order. Skipped when the owner was already watching it, and when nothing names it —
 * said, when Chrome would not name or list its windows and nothing else has been.
 */
function sendBehindOwners({
  alreadySaid,
  before,
  beforeIds,
  now,
  report,
  run,
}: {
  alreadySaid: boolean;
  before: ForegroundSnapshot | null;
  beforeIds: readonly number[] | null;
  now: ForegroundSnapshot | null;
  report: UnrestoredReport;
  run: ForegroundRun;
}): void {
  const { unnamed, windowId: agentWindowId } = agentWindowAfterAttach({ beforeIds, now, run });
  if (unnamed) {
    if (!alreadySaid) {
      report(UNNAMED_AGENT_WINDOW_LINE);
    }
    return;
  }
  if (agentWindowId === null || wasWatchingAgentWindow({ agentWindowId, before })) {
    return;
  }
  const outcome = raiseWindowBehindAgent({ agentWindowId, run });
  if (outcome.kind === "leave" && restoreCommandFailed({ outcome })) {
    report(unraisedLine({ why: outcome.why }));
  }
}

/**
 * Bring the session's own tab to the front, and give the foreground straight back.
 *
 * Through `chrome.debugger`, CDP `Page.bringToFront` activates the tab AND raises its window (`./foreground.ts`).
 * Each interactive session's tab sits alone in a window of its own — MEASURED with two sessions open,
 * two one-tab windows beside the owner's own — so afterwards the front window is the agent's, which is exactly the
 * post-condition {@link attachInBackground}'s restore rule is written for, and that wrapper is reused rather than
 * a second copy of it written.
 *
 * @param deps the client and the session it runs under
 * @param run the foreground probe and restore seam
 * @returns nothing when the tab was activated, or the typed client failure
 */
export function activateTabInBackground({
  deps,
  run = realForegroundRun,
}: {
  deps: TerminalClientDeps;
  run?: ForegroundRun;
}): Result<null, BrowserActionError> {
  const activated = attachInBackground({
    attach: () => runClientCommand({ args: TAB_ACTIVATION_ARGS, deps }),
    placement: deps.placement,
    run,
  });
  return activated.map(() => null);
}

/**
 * Decide what an attach's restore does, from ONE reading taken after it. Pure.
 *
 * The attach returns once the extension has focused the agent window, so the Chrome window in front at that
 * reading IS the agent's; deciding from that same reading means a second query cannot disagree with the first
 *. When Chrome will not name its window — Automation withdrawn — or nothing could be
 * read, the close's rule decides instead: whatever changed across the attach is put back, rather than leaving
 * Chrome in front for want of a window id.
 *
 * @param before what was in front before the attach
 * @param now the one reading taken after it
 * @returns the one action to take, or why none is
 */
export function attachRestoreAction({
  before,
  now,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
}): ForegroundRestoreAction {
  if (now !== null && now.chromeWindowId !== null) {
    return foregroundRestoreAction({ agentWindowId: now.chromeWindowId, before, now });
  }
  return closeRestoreAction({ before, now });
}

/**
 * Run a close and put back whatever it moved.
 *
 * @param release the client commands that close the tab and detach
 * @param run the foreground probe and restore seam
 * @param report where a failed restore is said, stderr unless a test collects it
 * @returns whatever the close returned
 */
export function releaseInBackground<T>({
  release,
  run,
  report = reportOnStderr,
}: {
  release: () => T;
  run: ForegroundRun;
  report?: UnrestoredReport;
}): T {
  const before = readForeground({ run });
  try {
    return release();
  } finally {
    const now = readForeground({ run });
    sayIfUnrestored({ before, now, outcome: actOnCloseRestore({ before, now, run }), report });
  }
}

/**
 * Sweep the page's highlights, close the tab and detach — every browser command one close is made of — and
 * put back whatever the close moved in front of the owner.
 *
 * Shared by `browser close`, `browser inspect` and `machine reap`, and kept here in the browser domain rather
 * than in a verb, because the reap is not a browser verb and must not import one: the verb modules carry the
 * whole interaction lane's graph, and the reap runs every sweep tick.
 *
 * @param deps the client and the session it runs under
 * @param foreground the foreground probe and restore seam; the real one unless a test supplies a recorder
 * @returns what went wrong, empty when nothing did
 */
export function letGoOfBrowser({
  deps,
  foreground = realForegroundRun,
}: {
  deps: TerminalClientDeps;
  foreground?: ForegroundRun;
}): readonly string[] {
  return releaseInBackground({
    release: () => {
      // The targetless `highlight --hide` is a SWEEP rather than part of the close, so its own failure is not
      // collected: the client documents it as hiding every page highlight, and what it collects is an aim-shot
      // overlay left behind by a run that died between a highlight and its hide (`./aimShot.ts` names that
      // residue). It runs FIRST, because it has nothing to reach once the tab is gone, and a tab that is about
      // to close loses nothing if it fails.
      runClientCommand({ args: ["highlight", "--hide"], deps });
      // Both of these change the browser's own state, so both say so on failure, and neither failure is
      // swallowed. A close that reports "your browser is untouched" when it does not know that is the same lie
      // as an action reporting success it cannot see — MEASURED as a counterexample by a Codex review pass,
      // where a `tab-close` client that died mid-command was reported as "the client had already
      // let go".
      return [
        runClientCommand({ args: ["tab-close"], deps, mayAct: true }),
        runClientCommand({ args: ["detach"], deps, mayAct: true }),
      ].flatMap((result) => (result.isErr() ? [result.error.message] : []));
    },
    run: foreground,
  });
}
