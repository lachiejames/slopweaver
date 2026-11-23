/**
 * The permissions guide, applied to Electron: one script-free floating window at the top-right of the screen, beside
 * System Settings rather than over it, raised at launch while a permission the call needs is off, from the menu bar,
 * the moment the voice meets one (the microphone refused at Start, a look refused), and on the app its own Reopen
 * started. While it is up it re-reads macOS every {@link RECHECK_MS} and as the app comes back to the front, so a
 * switch the owner turns on is ticked off without a press. Nothing here asks macOS for anything until the owner presses a button.
 * The decisions are `permissionGuide.ts`; `main.ts` owns the saved state and the call.
 *
 * The microphone and Screen Recording are read through Electron, at once. System Audio Recording has no Electron call,
 * so its helper process reads it (`systemAudioPermissionShell.ts`): every read is asynchronous, a read already running
 * is joined rather than doubled, and nothing — the launch decision, a press, a Not now — acts on statuses before the
 * first read lands. A read the helper fails is System Audio Recording off with the reason under the button, never on.
 */
import { app, BrowserWindow, screen, systemPreferences } from "electron";

import type { BuildIdentity } from "./buildIdentity";
import type { InputControlConsent } from "./inputControlConsent";
import {
  actOnInputControl,
  inputControlNow,
  isInputControlLink,
  readInputControlTrust,
  setInputControlReview,
} from "./inputControlShell";
import { askMacOs, openPermissionSettings, systemAudioHelper } from "./permissionAskShell";
import {
  GUIDE_HEIGHT,
  GUIDE_REOPEN_ARGUMENT,
  GUIDE_WIDTH,
  GUIDED_PERMISSIONS,
  type GuideLink,
  guideLinkOf,
  guideMenuLabel,
  guidePosition,
  guideRaisesAtLaunch,
  missingPermissions,
  type PermissionId,
  type PermissionStatuses,
  reopenArguments,
} from "./permissionGuide";
import { guideUrl } from "./permissionGuidePage";
import { guideView } from "./permissionGuideView";
import { preflightSystemAudio } from "./systemAudioPermissionShell";

/** How often the guide re-reads macOS while it is up. Reading a status is local and raises no prompt. */
const RECHECK_MS = 1500;

/** How long the "You're set" frame stays before the guide closes itself. */
const DONE_CLOSE_MS = 6000;

/** What the guide window's title says, before the build's name is added. */
const GUIDE_TITLE = "Set up permissions";

/** Off macOS the shell asks for nothing, so every permission reads as on. */
const OFF_MACOS: PermissionStatuses = { microphone: "granted", screen: "granted", systemAudio: "granted" };

/** What the guide reads from, and asks of, the rest of the shell. */
export interface PermissionGuideHost {
  /** Which Slopweaver this is. */
  readonly identity: () => BuildIdentity;
  /** A window's title, naming the build. */
  readonly titleFor: (options: { readonly page: string }) => string;
  /** Whether a voice call is up, which reopening the app would end. */
  readonly callLive: () => boolean;
  /** The permissions off when the owner last said Not now. */
  readonly dismissed: () => readonly PermissionId[];
  /** Remember the permissions off as the owner says Not now. */
  readonly rememberDismissed: (options: { readonly dismissed: readonly PermissionId[] }) => void;
  /** Statuses read anew — the menu bar redraws its item and drops a line a granted permission answered. */
  readonly statusesChanged: (options: { readonly statuses: PermissionStatuses }) => void;
  /** The owner's answer to the optional mouse and keyboard control step, `undefined` before they give one. */
  readonly inputControlConsent: () => InputControlConsent | undefined;
  /** Remember the owner's answer to it, at once; why the write failed, `undefined` once it is saved. */
  readonly rememberInputControlConsent: (options: { readonly consent: InputControlConsent }) => string | undefined;
}

let host: PermissionGuideHost | undefined;
let guide: BrowserWindow | undefined;
let loaded: string | undefined;
/** What macOS answered last; `undefined` until the first read lands, and nothing acts on statuses before it. */
let statuses: PermissionStatuses | undefined;
/** The read running now, which a second caller joins rather than starting another helper. */
let reading: Promise<PermissionStatuses> | undefined;
/** Why the last read could not tell System Audio Recording's status, shown until a read can. */
let statusProblem: string | undefined;
/** The permissions whose Settings page this run opened: a status still off after one may need a reopen. */
const settingsVisited = new Set<PermissionId>();
/**
 * The permissions whose macOS prompt this run raised. Never cleared: a System Audio Recording ask that timed out
 * stopped its helper, not macOS's prompt, which may still be up — so Allow is never pressed twice for one.
 */
const promptsRaised = new Set<PermissionId>();
/** Why the last press did nothing, shown under the button until the next press. */
let problem: string | undefined;
/** An Allow or Open press is being carried out; a second one while it runs does nothing. */
let busy = false;
let recheckTimer: NodeJS.Timeout | undefined;
let doneTimer: NodeJS.Timeout | undefined;
/** The guide is closing itself, so the close is not the owner's Not now. */
let closingItself = false;

/**
 * What macOS answers for each permission now; every one granted off macOS, where the shell asks for none.
 *
 * @returns the statuses, and why System Audio Recording's could not be read when it could not
 */
async function readMacOs(): Promise<{ readonly next: PermissionStatuses; readonly unreadable: string | undefined }> {
  readInputControlTrust();
  if (process.platform !== "darwin") {
    return { next: OFF_MACOS, unreadable: undefined };
  }
  const systemAudio = await preflightSystemAudio({ helperPath: systemAudioHelper() });
  const next: PermissionStatuses = {
    microphone: systemPreferences.getMediaAccessStatus("microphone"),
    screen: systemPreferences.getMediaAccessStatus("screen"),
    // Unread is not on: "unknown" walks the owner to its Settings page, with the reason under the button.
    systemAudio: systemAudio.isOk() ? systemAudio.value : "unknown",
  };
  return { next, unreadable: systemAudio.isErr() ? systemAudio.error.message : undefined };
}

/**
 * Read macOS again — joining a read already running — then tell the shell and redraw the guide when anything moved.
 *
 * @returns the statuses read
 */
async function refresh(): Promise<PermissionStatuses> {
  if (reading !== undefined) {
    return reading;
  }
  const started = readMacOs().then(({ next, unreadable }) => {
    const before = statuses;
    statuses = next;
    statusProblem = unreadable;
    const moved =
      before === undefined || GUIDED_PERMISSIONS.some((permission) => before[permission] !== next[permission]);
    if (moved) {
      host?.statusesChanged({ statuses: next });
    }
    drawGuide();
    return next;
  });
  reading = started;
  void started.finally(() => {
    if (reading === started) {
      reading = undefined;
    }
  });
  return started;
}

/** Re-read macOS on a tick, a focus or the app coming to the front; a read already running is joined. */
function recheck(): void {
  void refresh();
}

/**
 * Start the guide: read macOS once — reading asks nothing — re-read it whenever the app comes to the front, and
 * raise the guide when the app opens with a permission off the owner has not said Not now to, or when the guide's own Reopen
 * started this run, so it confirms what macOS applied. The launch decision waits for the first read; the rest of the
 * shell does not wait for it.
 *
 * @param guideHost the rest of the shell
 */
export async function startPermissionGuide({ guideHost }: { guideHost: PermissionGuideHost }): Promise<void> {
  host = guideHost;
  app.on("did-become-active", recheck);
  const first = await refresh();
  const atLaunch = guideRaisesAtLaunch({
    dismissed: guideHost.dismissed(),
    missing: missingPermissions({ statuses: first }),
    packaged: !guideHost.identity().dev,
    reopened: process.argv.includes(GUIDE_REOPEN_ARGUMENT),
  });
  if (atLaunch) {
    raisePermissionGuide();
  }
}

/** Raise the guide: from the menu bar, at launch, or the moment the voice met a permission that is off. */
export function raisePermissionGuide(): void {
  if (host === undefined) {
    return;
  }
  if (guide === undefined || guide.isDestroyed()) {
    guide = createGuide({ title: host.titleFor({ page: GUIDE_TITLE }) });
  } else if (loaded !== undefined) {
    guide.show();
  }
  recheck();
}

/**
 * Raise the guide on the optional mouse and keyboard control step, from its own menu bar item: offered even after a
 * Not now, since the owner asked for it. A voice permission still off is still shown first.
 */
export function raiseInputControlGuide(): void {
  setInputControlReview({ reviewing: true });
  raisePermissionGuide();
}

/**
 * The menu bar item that opens the guide.
 *
 * @returns its label, or `undefined` while every permission is on or before the first read lands
 */
export function permissionGuideMenuLabel(): string | undefined {
  if (statuses === undefined) {
    return undefined;
  }
  return guideMenuLabel({ missing: missingPermissions({ statuses }) });
}

/**
 * Act on one link, checked against where the permission stands NOW, so a guide drawn a moment ago presses nothing
 * stale.
 *
 * @param link what the guide asked for
 */
async function act({ link }: { link: GuideLink }): Promise<void> {
  const current = await refresh();
  if (host === undefined) {
    return;
  }
  if (isInputControlLink(link)) {
    problem = await actOnInputControl({ close: closeGuide, link, remember: host.rememberInputControlConsent });
    // Not now closed the guide; anything else re-reads, so a trust just granted ticks the step off.
    if (link.kind !== "input-control-decline") {
      recheck();
    }
    return;
  }
  if (link.kind === "reopen") {
    if (!host.callLive()) {
      app.relaunch({ args: reopenArguments({ argv: process.argv }) });
      app.quit();
      return;
    }
  } else if (link.kind === "dismiss") {
    host.rememberDismissed({ dismissed: missingPermissions({ statuses: current }) });
    closeGuide();
    return;
  } else if (link.kind !== "recheck") {
    const status = current[link.permission];
    // Ask only what macOS has never been asked and this run has not; open Settings for anything still off. A second
    // press while one runs does nothing; Not now, Check again and Reopen are never held behind one.
    const unasked = status === "not-determined" && !promptsRaised.has(link.permission);
    const stillOff = link.kind === "ask" ? unasked : status !== "granted";
    if (stillOff && !busy) {
      busy = true;
      if (link.kind === "ask") {
        promptsRaised.add(link.permission);
      }
      if (link.kind === "settings") {
        settingsVisited.add(link.permission);
      }
      const pressed =
        link.kind === "ask"
          ? askMacOs({ permission: link.permission })
          : openPermissionSettings({ permission: link.permission });
      const outcome = await pressed;
      busy = false;
      problem = outcome.isErr() ? outcome.error.message : undefined;
    }
  }
  recheck();
}

/**
 * The guide's window, made hidden and shown once its page has drawn.
 *
 * @param title its title, naming the build
 * @returns the window
 */
function createGuide({ title }: { title: string }): BrowserWindow {
  const position = guidePosition({ workArea: screen.getPrimaryDisplay().workArea });
  const created = new BrowserWindow({
    ...position,
    alwaysOnTop: true,
    backgroundColor: "#0f1115",
    fullscreenable: false,
    height: GUIDE_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title,
    type: "panel",
    useContentSize: true,
    webPreferences: { contextIsolation: true, javascript: false, nodeIntegration: false, sandbox: true },
    width: GUIDE_WIDTH,
  });
  created.setAlwaysOnTop(true, "floating");
  created.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true, visibleOnFullScreen: true });
  created.on("page-title-updated", (event) => {
    event.preventDefault();
    created.setTitle(title);
  });
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const link = guideLinkOf({ url });
    if (link !== undefined) {
      void act({ link });
    }
  });
  created.on("focus", recheck);
  created.once("ready-to-show", () => {
    created.show();
  });
  created.on("closed", () => {
    if (guide !== created) {
      return;
    }
    // The owner's own close button is Not now, exactly as the link is — as the console's note treats it — remembered once a
    // fresh read says what is still off.
    const shellHost = host;
    if (!closingItself && shellHost !== undefined) {
      void (async () => {
        const current = await refresh();
        shellHost.rememberDismissed({ dismissed: missingPermissions({ statuses: current }) });
      })();
    }
    closingItself = false;
    guide = undefined;
    loaded = undefined;
    problem = undefined;
    setInputControlReview({ reviewing: false });
    stopTimers();
  });
  recheckTimer = setInterval(recheck, RECHECK_MS);
  return created;
}

/** Stop re-reading macOS and any pending close. */
function stopTimers(): void {
  if (recheckTimer !== undefined) {
    clearInterval(recheckTimer);
    recheckTimer = undefined;
  }
  if (doneTimer !== undefined) {
    clearTimeout(doneTimer);
    doneTimer = undefined;
  }
}

/** Close the guide from the shell's side, so the close is not read as the owner's Not now. */
function closeGuide(): void {
  if (guide === undefined || guide.isDestroyed()) {
    return;
  }
  closingItself = true;
  guide.close();
}

/**
 * What the guide shows under its button: why System Audio Recording could not be read, then why the last press did
 * nothing — each only while it holds.
 *
 * @returns the line, or `undefined` when nothing went wrong
 */
function shownProblem(): string | undefined {
  const lines = [statusProblem, problem].filter((line): line is string => line !== undefined);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.join(" · ");
}

/** Draw the guide from the statuses read last, and close it a moment after everything is on. */
function drawGuide(): void {
  if (host === undefined || guide === undefined || guide.isDestroyed() || statuses === undefined) {
    return;
  }
  const identity = host.identity();
  const appName = identity.dev ? "Electron" : "Slopweaver";
  const view = guideView({
    appName,
    callLive: host.callLive(),
    inputControl: inputControlNow({ appName, consent: host.inputControlConsent() }),
    problem: shownProblem(),
    promptsRaised: [...promptsRaised],
    settingsVisited: [...settingsVisited],
    statuses,
  });
  const url = guideUrl({ title: GUIDE_TITLE, view });
  if (url !== loaded) {
    loaded = url;
    void guide.loadURL(url);
  }
  // Done only when nothing is left, the optional step included: an offer waiting on the owner's answer stays up.
  const done = view.step === undefined && view.inputControl.step === undefined;
  if (done && doneTimer === undefined) {
    doneTimer = setTimeout(closeGuide, DONE_CLOSE_MS);
  } else if (!done && doneTimer !== undefined) {
    clearTimeout(doneTimer);
    doneTimer = undefined;
  }
}
