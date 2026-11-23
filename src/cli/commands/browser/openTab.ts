/**
 * `openTab`, the one attach-and-goto `browser open` and `browser present` share: mint a session, record it BEFORE
 * the browser is touched, take a tab on one page and look at it once. A record written first is what lets a run
 * killed mid-command still leave a row `browser sessions` lists and `browser close` lets go of. `runBrowserOpen` is
 * `browser open` itself: its window stays behind the owner's unless `SLOPWEAVER_BROWSER_FOREGROUND=1` asks to show it, and
 * it first lets go of its own opener's background sessions idle past their expiry (`letGoOfOwnQuietSessions`).
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { placementFromEnv, realForegroundRun, type WindowPlacement } from "../../../browser/foreground.js";
import { armFullscreenGuardAtOpen } from "../../../browser/fullscreenGuardRun.js";
import { type InteractionSession, type PageObservation, sessionOwnerOf } from "../../../browser/interactionSession.js";
import {
  interactionSessionDir,
  makeInteractionWorkspace,
  writeInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import { attachInBackground, BACKGROUND_ATTACH_ARGS } from "../../../browser/keepForeground.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { prepareClientWorkspace, runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_OK } from "../../exitCodes.js";
import { productionBrowserReapDeps } from "../machine/browserReapDeps.js";
import { letGoOfOwnQuietSessions } from "../machine/reapBrowser.js";
import type { BrowserOpenOptions } from "./actionCore.js";
import { renderOpened } from "./lookReceipt.js";
import { fileLook, keptAliveDeps } from "./sessionHold.js";
import { clientDeps, fail, observe, ownerSessionId, resolveSessionPin } from "./sessionShell.js";

/** Why `openTab` did not finish, and the session holding a tab it may have left open. */
export interface OpenTabFailure {
  readonly problems: readonly string[];
  /** Set once the browser was touched: its record is on disk, and a tab may be open under it. */
  readonly mayHoldTab: InteractionSession | undefined;
  /**
   * Set once `goto` was sent: the page may have loaded, so a client's words from here on can carry the page's
   * own text — the client reports a failure by echoing its output from `### Error` on, and a page can print that.
   */
  readonly navigated: boolean;
  /**
   * Set when the first look was taken but not filed: a line this code wrote, never the page's, so a caller that
   * withholds the client's words after navigation still prints it.
   */
  readonly notFiled?: string;
}

/* A fresh session record naming this process as its opener, before anything touches the browser. */
function newSession({
  home,
  nowIso,
  placement,
  url,
}: {
  home: string;
  nowIso: string;
  placement: WindowPlacement;
  url: string;
}): InteractionSession {
  const id = randomUUID();
  return {
    clientSession: `slopweaver-${id.slice(0, 8)}`,
    id,
    openedAtIso: nowIso,
    origins: [new URL(url).origin],
    owner: sessionOwnerOf({ cwd: process.cwd(), env: process.env }),
    ownerSessionId: ownerSessionId(),
    placement,
    touchedAtIso: nowIso,
    workspace: join(interactionSessionDir({ home, id }), "client"),
  };
}

/**
 * Take a session on one page and leave its tab open: the shared half of `browser open` and `browser present`.
 *
 * **The session is recorded BEFORE anything touches the browser**, with no observation yet, and rewritten with
 * the first look once it is taken — exactly as `browser inspect` does. `attach` and `goto` both change the owner's
 * browser, so a client that dies or is killed on a deadline between them may have left a tab behind; a record
 * written only on success would leave that tab with nothing `browser sessions` could list or `browser close`
 * could let go of.
 *
 * @param home the state home the session record lives under
 * @param url the address, already validated by the caller
 * @param commandTimeoutMs the cap on each client command, when the caller runs under a deadline of its own
 * @param attachTimeoutMs the attach's own cap beside a tight `commandTimeoutMs`, so a kill never lands mid-connect
 *   (`commandTimeoutFor` says why)
 * @param placement whether the session's window stays behind the owner's or is shown to them, recorded for every later
 *   command of the session
 * @param chromePinPath the profile pin script the caller's root resolved from the recorded profile
 * @returns the session, its first look and that look's outline, or every problem met — naming the session whenever the browser was
 *   touched, since a tab may then be open and the caller may owe it a close
 */
export function openTab({
  home,
  url,
  commandTimeoutMs,
  attachTimeoutMs,
  placement,
  chromePinPath,
}: {
  home: string;
  url: string;
  commandTimeoutMs?: number;
  attachTimeoutMs?: number;
  placement: WindowPlacement;
  chromePinPath: string;
}): Result<{ elements: readonly string[]; observation: PageObservation; session: InteractionSession }, OpenTabFailure> {
  const nowIso = new Date().toISOString();
  const session = newSession({ home, nowIso, placement, url });
  makeInteractionWorkspace({ workspace: session.workspace });
  const prepared = prepareClientWorkspace({ workspace: session.workspace });
  if (prepared.isErr()) {
    return err({ mayHoldTab: undefined, navigated: false, problems: [prepared.error.message] });
  }
  const resolved = clientDeps({ chromePinPath, home, session });
  if (resolved.isErr()) {
    return err({ mayHoldTab: undefined, navigated: false, problems: resolved.error });
  }
  let unheld: TerminalClientDeps = resolved.value;
  if (commandTimeoutMs !== undefined) {
    unheld = { ...unheld, commandTimeoutMs };
  }
  const recorded = writeInteractionSession({ home, stored: { observation: null, session } });
  if (recorded.isErr()) {
    return err({ mayHoldTab: undefined, navigated: false, problems: [recorded.error.message] });
  }
  // From the moment the record exists a reap can judge it, so the opening commands hold its lock and touch it
  // exactly as every later verb's do.
  const deps = keptAliveDeps({ deps: unheld, home, sessionId: session.id });
  const attached = attachTab({ attachTimeoutMs, deps, placement });
  if (attached.isErr()) {
    return err({ mayHoldTab: session, navigated: false, problems: [attached.error.message] });
  }
  // Before `goto`, so the first page's own scripts already see the background full-screen refusal.
  armFullscreenGuardAtOpen({ deps });
  // `goto` CHANGES the page, so a client that dies mid-command leaves an unknown outcome rather than a
  // known nothing — the same reason every interaction passes this.
  const visited = runClientCommand({ args: ["goto", url], deps, mayAct: true });
  if (visited.isErr()) {
    return err({ mayHoldTab: session, navigated: true, problems: [visited.error.message] });
  }
  const observation = observe({ deps, nowIso });
  if (observation.isErr()) {
    return err({ mayHoldTab: session, navigated: true, problems: [observation.error.message] });
  }
  const notFiled = `the first look was not filed: session ${session.id} holds no citable look yet`;
  const filed = fileLook({ home, notFiled, nowIso, observation: observation.value, session });
  if (filed.isErr()) {
    return err({ mayHoldTab: session, navigated: true, notFiled, problems: filed.error });
  }
  return ok({ elements: filed.value, observation: observation.value, session });
}

/*
 * Attach the session's client. `attach` opens the relay's connect tab in the owner's browser, so it changes state too: a
 * client that dies before replying may have left that tab behind, and reporting a flat failure would send the caller
 * looking for a bug rather than for a tab. Chrome and the extension both bring the agent window forward on an attach;
 * unless this session was opened to be shown, it goes straight back behind whatever the owner was looking at
 * (`../../../browser/keepForeground.ts`).
 */
function attachTab({
  attachTimeoutMs,
  deps,
  placement,
}: {
  attachTimeoutMs: number | undefined;
  deps: TerminalClientDeps;
  placement: WindowPlacement;
}): ReturnType<typeof runClientCommand> {
  return attachInBackground({
    attach: () => runClientCommand({ args: BACKGROUND_ATTACH_ARGS, deps, mayAct: true, timeoutMs: attachTimeoutMs }),
    placement,
    run: realForegroundRun,
  });
}

/**
 * Run `browser open`: attach a named client session, go to the page, and hand back the first look.
 *
 * @param options the validated invocation
 * @param home the state home to drive against
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserOpen({
  options,
  home,
  profiles,
}: {
  options: BrowserOpenOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const pin = await resolveSessionPin({ home, profiles });
  if (pin.isErr()) {
    return fail({ problems: pin.error });
  }
  // Before another window is taken: this seat's own sessions it has stopped using (measured:
  // eleven blank windows, one live seat's, one per page it had looked at).
  const ownerPid = sessionOwnerOf({ cwd: process.cwd(), env: process.env }).pid;
  for (const line of letGoOfOwnQuietSessions({ deps: productionBrowserReapDeps({ home }), ownerPid })) {
    logger.info({ msg: line });
  }
  const opened = openTab({
    chromePinPath: pin.value,
    home,
    placement: placementFromEnv({ env: process.env }),
    url: options.url,
  });
  if (opened.isErr()) {
    const { problems, mayHoldTab } = opened.error;
    if (mayHoldTab === undefined) {
      return fail({ problems });
    }
    return fail({
      problems: [
        ...problems,
        `a tab may be open — its record is kept: slopweaver browser close --session ${mayHoldTab.id}`,
      ],
    });
  }
  const { elements, observation, session } = opened.value;
  if (options.json) {
    logger.out({ line: JSON.stringify({ observation, session }, null, 2) });
    return EXIT_OK;
  }
  for (const line of [...renderOpened({ observation, session }), ...elements]) {
    logger.out({ line });
  }
  return EXIT_OK;
}
