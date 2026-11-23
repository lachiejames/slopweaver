/**
 * What the sidebar's one Update button does, picked from the two build standings — the page's (`./buildStanding.ts`)
 * and the app's (`./shellStanding.ts`) — and whether a call is up. Pure.
 *
 * One clear button, the same in the menu bar, rather than a fold reading "1 commit behind — new build waiting … swaps
 * in when a live voice call ends; then hard refresh" or "`slopweaver desktop install` from the main checkout"; on a
 * call, an offer to end the call, update at once and restart the call when the update lands.
 *
 * The owner should not have to think about two kinds of updates and two ways of applying them: update now is one
 * button and the page does all the coordination. So every press reads the same two words — "Update now", or on a
 * call "End call, update & restart call" — whichever step it takes underneath: the full update when the app or the
 * checkout is behind, a restart onto an app already installed, a reload onto a page already served, or ending the call
 * a held page build waits for. Which one it is never reaches the button or the menu bar.
 *
 * The app's update comes first: it fast-forwards the checkout and rebuilds the console page too
 * (`slopweaver desktop update`), and the app it reopens loads the page fresh.
 */
import type { BuildStanding } from "./buildStanding";
import type { ShellStanding } from "./shellStandingWords";

/** The step a press takes underneath the one label. */
export type UpdateStep = "install" | "relaunch" | "reload" | "swap";

/** What getting onto the latest build takes, before asking whether this window can press for it. */
export type UpdateIntent =
  | { readonly kind: "none" }
  /** Something is already under way; there is nothing to press. */
  | { readonly kind: "busy"; readonly label: string }
  | {
      /**
       * `install` runs the full update; `relaunch` quits and reopens onto the app already installed; `reload` loads
       * the page the console now serves; `swap` ends the call a page build is held for, then reloads onto it.
       */
      readonly kind: UpdateStep;
      /** Pressing it ends the call that is up, which restarts once the update lands. */
      readonly endsCall: boolean;
    };

/** One thing the button can do. */
export type UpdateAction =
  | { readonly kind: "none" }
  /** Something is already under way; the button shows it, and does nothing. */
  | { readonly kind: "busy"; readonly label: string }
  | {
      readonly kind: UpdateStep;
      readonly label: string;
      /** Pressing it ends the call that is up, which restarts once the update lands. */
      readonly endsCall: boolean;
    };

/** The one label, with no call up. */
export const UPDATE_NOW = "Update now";

/** The one label for a press that ends a call and starts it again after. */
export const UPDATE_WITH_CALL = "End call, update & restart call";

/**
 * One step to press, marked for whether a call is up.
 *
 * @returns the intent
 */
function press({ kind, callLive }: { kind: UpdateStep; callLive: boolean }): UpdateIntent {
  return { endsCall: callLive, kind };
}

/**
 * What getting onto the latest build takes, whether or not this window can press for it — the sidebar's one line
 * reads it in a browser too, where there is no button.
 *
 * @param page the page's build standing, `undefined` before it is read
 * @param app the app's build standing, `undefined` in a browser or before the app answers
 * @param callLive whether a voice call is up now
 * @param running whether an update the app launched is still running
 * @returns the step, something under way, or `none`
 */
export function updateIntent({
  page,
  app,
  callLive,
  running,
}: {
  page: BuildStanding | undefined;
  app: ShellStanding | undefined;
  callLive: boolean;
  running: boolean;
}): UpdateIntent {
  if (running) {
    return { kind: "busy", label: "Updating…" };
  }
  if (app?.fix === "install") {
    return press({ callLive, kind: "install" });
  }
  if (app?.fix === "relaunch") {
    return press({ callLive, kind: "relaunch" });
  }
  if (page?.kind === "reload") {
    return press({ callLive, kind: "reload" });
  }
  // Held for THIS call: ending it is what lets the new page swap in. One held for a call elsewhere is not this window's to end.
  if (page?.kind === "waiting" && callLive) {
    return press({ callLive, kind: "swap" });
  }
  if (page?.kind === "waiting") {
    return { kind: "busy", label: "Update waiting on a call" };
  }
  if (page?.kind === "rebuilding") {
    return { kind: "busy", label: "Building update…" };
  }
  // The checkout has not pulled what landed: the full update pulls it, rebuilds the console and the app, in one press.
  if (page?.kind === "unsynced") {
    return press({ callLive, kind: "install" });
  }
  return { kind: "none" };
}

/**
 * The button's action: the intent, labelled — every press with the same words.
 *
 * @param page the page's build standing, `undefined` before it is read
 * @param app the app's build standing, `undefined` in a browser or before the app answers
 * @param callLive whether a voice call is up now
 * @param running whether an update the app launched is still running
 * @param canUpdate whether the shell carries the update's whole bridge — under an older app, or in a browser, the
 *   sidebar names the step in words and draws no button
 * @returns what the button does, or `none` for no button
 */
export function updateAction({
  page,
  app,
  callLive,
  running,
  canUpdate,
}: {
  page: BuildStanding | undefined;
  app: ShellStanding | undefined;
  callLive: boolean;
  running: boolean;
  canUpdate: boolean;
}): UpdateAction {
  if (!canUpdate) {
    return { kind: "none" };
  }
  const intent = updateIntent({ app, callLive, page, running });
  if (intent.kind === "none" || intent.kind === "busy") {
    return intent;
  }
  return { ...intent, label: intent.endsCall ? UPDATE_WITH_CALL : UPDATE_NOW };
}

/**
 * What the sidebar's line says getting onto the latest takes: something the button's controller has under way — a
 * swap it is waiting out after its call ended — wins over the standings, so the line says it.
 *
 * @param intent what the standings say it takes (`updateIntent`)
 * @param action what the one controller does now, its own swap included
 * @returns the intent the line reads
 */
export function lineIntent({ intent, action }: { intent: UpdateIntent; action: UpdateAction }): UpdateIntent {
  if (action.kind === "busy") {
    return action;
  }
  return intent;
}

/**
 * The sidebar's button: no button for something under way, which the line directly above already says in the same
 * words (measured: "Update waiting on a call" read twice). The menu bar and
 * the release-notes modal have no such line, so they keep the disabled one.
 *
 * @returns the action the sidebar draws
 */
export function sidebarAction({ action }: { action: UpdateAction }): UpdateAction {
  if (action.kind === "busy") {
    return { kind: "none" };
  }
  return action;
}

/**
 * What the menu bar is told of the button: its words, and whether a press does anything — `null` for no button.
 *
 * @returns the offer
 */
export function trayOfferOf({
  action,
}: {
  action: UpdateAction;
}): { readonly label: string; readonly enabled: boolean } | null {
  if (action.kind === "none") {
    return null;
  }
  if (action.kind === "busy") {
    return { enabled: false, label: action.label };
  }
  return { enabled: true, label: action.label };
}

/** How long the swap waits, after the call ends, for the console to serve the build that was held for it. */
export const SWAP_WAIT_MS = 3 * 60_000;

/** How often it re-reads the console's build while waiting. */
export const SWAP_POLL_MS = 5_000;

/**
 * The words for a refusal the shell answered, so the sidebar says what to do rather than a code.
 *
 * @param code the refusal's code
 * @returns the sentence
 */
export function refusalSentence({ code }: { code: string }): string {
  switch (code) {
    case "CALL_IN_CONSOLE_WINDOW":
      return "The call is in this window, not the voice's. End it here, then press update again.";
    case "NOT_LISTENING":
    case "DID_NOT_END":
      return "The call did not end. End it from the orb, then press update again.";
    case "RUNNING":
      return "An update is already running.";
    case "CALL_LIVE":
      return "A call is still up. End it, then press update again.";
    case "NO_CHECKOUT":
      return "The app has no clone to update from. Choose one from the note it raises, then press update again.";
    case "LAUNCH_FAILED":
      return "The update could not start. The app could not write its log.";
    case "INSTALL_DISABLED":
      return "This copy of the app is a test instance, which never installs an update.";
    default:
      // A code this page has no words for is never printed as the reason.
      return "The app refused the update for a reason this page does not know yet.";
  }
}

/**
 * The sidebar's line for the last update's outcome: a failure only. A landed update says nothing, its hash least of
 * all — the Up to date line and the Update button already say where the owner stands. The lead says only which way the failure left the app; the failure's own message is the `why`, which the
 * sidebar draws through `PlainWhy`, since it is a typed error's raw message and may be a stack or a JSON body.
 *
 * @returns the lead and the failure's own message, or `undefined` when there is none
 */
export function outcomeLine({
  outcome,
}: {
  outcome:
    | { readonly kind: "updated"; readonly sha: string }
    | { readonly kind: "failed"; readonly message: string; readonly rolledBack: boolean }
    | undefined;
}): { readonly lead: string; readonly why: string } | undefined {
  if (outcome === undefined || outcome.kind === "updated") {
    return undefined;
  }
  if (outcome.rolledBack) {
    return { lead: "Update failed, and the previous app was put back.", why: outcome.message };
  }
  return { lead: "Update failed, and this app kept running.", why: outcome.message };
}
