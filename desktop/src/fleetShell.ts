/**
 * The fleet's half of the shell, applied to Electron: apply each reading of the fleet, decide what the sessions page
 * and the floating note show, launch the episode's one automatic recovery, and act on the page's buttons. The
 * decisions are `fleetAutomation.ts`, `fleetHealth.ts` and `fleetPage.ts`; the processes are `fleetProcess.ts`. The
 * windows are `fleetWindows.ts`, the saved memory `fleetMemoryShell.ts`, and the timers `fleetPollingShell.ts`.
 *
 * Both fleet windows run with JavaScript OFF and no preload: their only way to ask for anything is a
 * `slopweaver-fleet:` link, checked here against the hand step standing at that moment.
 */
import { randomUUID } from "node:crypto";

import { shell } from "electron";
import type { Result } from "neverthrow";

import { type CheckoutError, type FleetError, FleetErrors } from "./errors";
import { nextDownSince, stallNoteHeld, withStalledRecovery } from "./fleetAutomation";
import {
  type FleetAutomation,
  launchDidNotHappen,
  launchPending,
  NO_EPISODE,
  type PendingLaunch,
  pressButton,
  stepFleetAutomation,
} from "./fleetAutomationEpisode";
import { type FleetLaunch, fleetLaunchLine, launchForAction, withBridgeFailure } from "./fleetAutomationLaunch";
import type { FleetHandStep, FleetHealth } from "./fleetHealth";
import { readFleetMemory, saveFleetMemory, startFleetMemory } from "./fleetMemoryShell";
import { type FleetLink, fleetNoteUrl, fleetPageUrl, fleetUnreadableUrl } from "./fleetPage";
import { checkFleet, fleetPollingBlocksLaunch, startFleetPolling } from "./fleetPollingShell";
import { launchInCmux, openCmux, readFleetHealth } from "./fleetProcess";
import { fleetRecoveryState, pressFleetRecovery, startFleetRecoveryShell } from "./fleetRecoveryShell";
import { drawFleetNote, drawFleetPage, startFleetWindows } from "./fleetWindows";
import { startSessionControl } from "./sessionControlBoot";
import type { TrayFleet } from "./trayMenu";

// The rest of the shell reaches the fleet's half through this module alone; the sessions window is drawn there.
export { fleetWindowOpen, showFleetWindow } from "./fleetWindows";

/** What the fleet's half reads from, and tells, the rest of the shell. */
export interface FleetShellHost {
  /** The checkout whose `bin/slopweaver` runs. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** The shell is bringing the console back itself, so a recovery launch waits for it. */
  readonly consoleRecovering: () => boolean;
  /** The console window is open, so closing the sessions page keeps the Dock icon. */
  readonly consoleWindowOpen: () => boolean;
  /** A saved-state problem for the menu bar. */
  readonly reportProblem: (options: { readonly problem: string }) => void;
  /** The menu's fleet line changed. */
  readonly redrawTray: () => void;
  /** A window's title, naming Slopweaver and, in a dev run, the dev build (`buildIdentity.ts`). */
  readonly titleFor: (options: { readonly page: string }) => string;
}

/** Where macOS lists the apps allowed to control others. */
const AUTOMATION_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

let host: FleetShellHost | undefined;
/** The fleet's last reading, and why the last read produced none. */
let fleetHealth: FleetHealth | undefined;
let fleetProblem: string | undefined;
/** The episode and its one automatic attempt, saved across restarts. */
let fleetAutomation: FleetAutomation = NO_EPISODE;
/** The shell's own last launch failure, until the owner acts on its button. */
let bridgeFailure: FleetError | undefined;
/** The launch typed last, until a reading shows its attempt — so a double click never starts two passes. */
let pendingLaunch: PendingLaunch | undefined;
/** When this episode first read down, so the stall note waits out a swap that settles by itself. Memory only. */
let downSinceMs: number | undefined;
/** Whether the last automatic launch was held back because its memory would not save, until a save succeeds. */
let unsavedLaunch = false;

/**
 * The host, once `startFleetShell` has run.
 *
 * @returns the host
 */
function hostOf(): FleetShellHost {
  if (host === undefined) {
    throw new Error("the fleet shell was used before startFleetShell");
  }
  return host;
}

/**
 * The reading as the page shows it: the fleet's own, with the shell's launch failure as the reason while one stands.
 *
 * @returns the health to render, or `undefined` before any reading
 */
function shownHealth(): FleetHealth | undefined {
  if (fleetHealth === undefined) {
    return undefined;
  }
  return withBridgeFailure({
    failure: bridgeFailure,
    health: withStalledRecovery({
      automation: fleetAutomation,
      downSinceMs,
      health: fleetHealth,
      pending: pendingLaunch !== undefined,
      timeZone: undefined,
      unsaved: unsavedLaunch,
    }),
  });
}

/**
 * The fleet in one menu line.
 *
 * @returns the line
 */
function fleetTrayLine(): string {
  const health = shownHealth();
  if (health === undefined) {
    return fleetProblem === undefined ? "Fleet: reading…" : "Fleet: could not be read";
  }
  return `Fleet: ${String(health.capacity.online)} of ${String(health.capacity.configured)} online · ${health.reason.headline}`;
}

/**
 * The fleet's part of the menu: its line, and the Recovery item, whose press is the same one the Sessions page's
 * button makes.
 *
 * @returns the part
 */
export function fleetTray(): TrayFleet {
  const recoveryRunning = fleetRecoveryState().kind === "running";
  return { line: fleetTrayLine(), recover: pressFleetRecovery, recoveryRunning };
}

/**
 * Change the fleet's memory and save it.
 *
 * @param next the new memory
 */
function remember({ next }: { next: FleetAutomation }): void {
  fleetAutomation = next;
  void saveFleetMemory({ next });
}

/**
 * Change the fleet's memory and launch only once it is on disk. A launch whose count never reached the disk is
 * forgotten across an app restart, and the four-launch cap with it, so an automatic launch
 * whose memory will not save launches nothing and is put back, the next reading tries again, and meanwhile the page
 * offers "Start recovery again" so a disk that stays unwritable never leaves a down fleet with no way back — unless
 * the supervisor is live, which is that way back itself. The owner's press is never refused: it launches with its count held in memory only.
 *
 * @param next the memory carrying this launch
 * @param launch what to start
 * @param automatic the episode's automatic attempt or continuation, rather than the owner's button press
 */
function rememberThenLaunch({
  next,
  launch: what,
  automatic,
}: {
  next: FleetAutomation;
  launch: FleetLaunch;
  automatic: boolean;
}): void {
  const before = fleetAutomation;
  fleetAutomation = next;
  // Held while the write is in flight, so neither a reading nor a click launches beside it.
  pendingLaunch = { atMs: Date.now(), lastAttemptId: fleetHealth?.lastAttempt?.attemptId };
  void (async () => {
    const saved = await saveFleetMemory({ next });
    if (saved) {
      unsavedLaunch = false;
      launch({ automatic, launch: what });
    } else if (automatic) {
      unsavedLaunch = true;
      fleetAutomation = before;
      pendingLaunch = undefined;
    } else {
      launch({ automatic, launch: what });
    }
    draw();
  })();
}

/**
 * Show the floating note for the one hand step, or take it down when there is none the owner has not closed — or while it
 * is the shell's own "Start recovery again" and the fleet has not yet stood down past the hold.
 */
function drawNote(): void {
  const health = shownHealth();
  const step = health?.reason.handStep;
  const url = health === undefined ? undefined : fleetNoteUrl({ health, timeZone: undefined });
  const hidden =
    step === undefined ||
    url === undefined ||
    step.id === fleetAutomation.dismissedStep ||
    stallNoteHeld({ downSinceMs, nowMs: Date.now(), step });
  if (hidden) {
    drawFleetNote({ url: undefined });
    return;
  }
  drawFleetNote({ url });
}

/** Draw the sessions page, the note and the menu line from the current reading; an unchanged one reloads nothing. */
function draw(): void {
  const health = shownHealth();
  const recovery = fleetRecoveryState();
  let url = fleetUnreadableUrl({ problem: "No reading yet.", recovery });
  if (health !== undefined) {
    url = fleetPageUrl({ health, recovery, timeZone: undefined });
  } else if (fleetProblem !== undefined) {
    url = fleetUnreadableUrl({ problem: fleetProblem, recovery });
  }
  drawFleetPage({ url });
  drawNote();
  hostOf().redrawTray();
}

/**
 * Type one fixed line into a new cmux tab. A launch that never reached cmux stands as the page's reason until the owner
 * acts on its button, and an automatic one gives its episode the launch back — no recovery ran.
 *
 * @param launch what to start
 * @param automatic the episode's automatic attempt or continuation, rather than the owner's button press
 */
function launch({ launch: what, automatic }: { launch: FleetLaunch; automatic: boolean }): void {
  const checkout = hostOf().checkout();
  if (checkout.isErr()) {
    return;
  }
  const line = fleetLaunchLine({
    checkout: checkout.value,
    claudeConfig: process.env["CLAUDE_CONFIG_DIR"],
    home: process.env["SLOPWEAVER_HOME"],
    launch: what,
  });
  pendingLaunch = { atMs: Date.now(), lastAttemptId: fleetHealth?.lastAttempt?.attemptId };
  void (async () => {
    let failure: FleetError | undefined;
    if (line.isErr()) {
      failure = FleetErrors.launchFailed({ detail: line.error });
    } else {
      const launched = await launchInCmux({ line: line.value, raise: !automatic });
      failure = launched.isErr() ? launched.error : undefined;
    }
    bridgeFailure = failure;
    if (failure !== undefined) {
      pendingLaunch = undefined;
      remember({ next: launchDidNotHappen({ automatic, automation: fleetAutomation }) });
    }
    draw();
  })();
}

/**
 * Act on a link the page or the note navigated to — a hand step's only when it names the step standing now, so a
 * stale page can never press a button the fleet no longer offers. Recovery is the owner's press on the page, the
 * same press as the menu's item, which starts nothing while a check runs.
 *
 * @param link what was clicked
 */
function actOnLink({ link }: { link: FleetLink }): void {
  if (link.kind === "recover") {
    pressFleetRecovery();
    return;
  }
  const step = shownHealth()?.reason.handStep;
  if (step === undefined || step.id !== link.stepId) {
    return;
  }
  if (link.kind === "dismiss") {
    remember({ next: { ...fleetAutomation, dismissedStep: step.id } });
    drawNote();
    return;
  }
  const checkout = hostOf().checkout();
  if (checkout.isErr()) {
    return;
  }
  // The page can be a poll old, so every press reads the fleet again and acts only on the step that reading still
  // offers: an attempt another actor started since then takes the button away rather than getting a second pass
  // typed beside it, and a fleet that came back since takes a stale "open cmux" away.
  void (async () => {
    const read = await readFleetHealth({ checkout: checkout.value });
    if (read.isErr()) {
      fleetProblem = read.error.message;
      draw();
      return;
    }
    fleetProblem = undefined;
    fleetHealth = read.value;
    downSinceMs = nextDownSince({ before: downSinceMs, nowMs: Date.now(), state: read.value.state });
    if (read.value.state === "healthy" || read.value.state === "degraded") {
      bridgeFailure = undefined;
    }
    const fresh = shownHealth()?.reason.handStep;
    if (fresh === undefined || fresh.id !== link.stepId) {
      draw();
      return;
    }
    pressFreshStep({ step: fresh });
    draw();
  })();
}

/**
 * Do what one hand step does, once a fresh reading has confirmed it still stands.
 *
 * @param step the step the fresh reading offers
 */
function pressFreshStep({ step }: { step: FleetHandStep }): void {
  const action = step.action;
  if (action.kind === "automation-consent") {
    bridgeFailure = undefined;
    void shell.openExternal(AUTOMATION_SETTINGS);
    return;
  }
  if (action.kind === "open-cmux") {
    bridgeFailure = undefined;
    void (async () => {
      const opened = await openCmux({ raise: true });
      bridgeFailure = opened.isErr() ? opened.error : undefined;
      draw();
      checkFleet();
    })();
    return;
  }
  if (pendingLaunch !== undefined) {
    return;
  }
  const pressed = pressButton({ automation: fleetAutomation, mint: randomUUID });
  const what = launchForAction({ action, episodeId: pressed.episodeId });
  if (what !== undefined) {
    rememberThenLaunch({ automatic: false, launch: what, next: pressed.automation });
  }
}

/**
 * The fleet could not be read: say why on the page.
 *
 * @param problem what stopped the read
 */
function fleetReadFailed({ problem }: { readonly problem: string }): void {
  fleetProblem = problem;
  draw();
}

/**
 * Apply a reading: redraw whatever is open, and launch the episode's automatic attempt, or continue one that
 * deferred. Detection never waits on the console; only the launch waits for a console recovery the shell itself has
 * in flight, so two never run `docs-site.sh --serve` at once.
 *
 * @param health what the fleet read
 */
function fleetReadSucceeded({ health }: { readonly health: FleetHealth }): void {
  fleetProblem = undefined;
  fleetHealth = health;
  downSinceMs = nextDownSince({ before: downSinceMs, nowMs: Date.now(), state: health.state });
  if (!launchPending({ nowMs: Date.now(), pending: pendingLaunch, reading: health })) {
    pendingLaunch = undefined;
  }
  const step = stepFleetAutomation({
    automation: fleetAutomation,
    // A launch into a hung cmux, or one being restarted, types into an app that cannot draw the tab.
    blocked:
      pendingLaunch !== undefined ||
      bridgeFailure !== undefined ||
      hostOf().consoleRecovering() ||
      fleetPollingBlocksLaunch(),
    mint: randomUUID,
    reading: health,
  });
  if (health.state === "healthy" || health.state === "degraded") {
    bridgeFailure = undefined;
  }
  // The page never raises itself, because the owner is not on the hook for dealing with a down fleet: it is
  // recovering on its own, so the owner sees it when they open Sessions, and only a step that is theirs
  // alone reaches them, as the floating note.
  const episodeId = step.automation.episodeId;
  if (step.launch && episodeId !== null) {
    rememberThenLaunch({ automatic: true, launch: { episodeId, kind: "resume" }, next: step.automation });
  } else if (step.automation !== fleetAutomation) {
    remember({ next: step.automation });
  }
  draw();
}

/**
 * Start the fleet's half: read the saved episode, read the fleet now and every half minute after, and knock on cmux
 * every minute.
 *
 * @param shellHost what the fleet's half reads from the rest of the shell
 */
export async function startFleetShell({ shellHost }: { shellHost: FleetShellHost }): Promise<void> {
  host = shellHost;
  // Starts no check: one runs only when the owner presses Recovery.
  startFleetRecoveryShell({ recoveryHost: { changed: draw, checkout: () => shellHost.checkout() } });
  startFleetWindows({
    windowsHost: {
      actOnLink,
      consoleWindowOpen: () => shellHost.consoleWindowOpen(),
      draw,
      redrawTray: () => {
        shellHost.redrawTray();
      },
      titleFor: (options) => shellHost.titleFor(options),
    },
  });
  startFleetMemory({
    memoryHost: {
      reportProblem: (options) => {
        shellHost.reportProblem(options);
      },
    },
  });
  // The app harness's control plane rides the fleet's own start: the owner's app only, never a test instance.
  await startSessionControl({ bootHost: shellHost });
  const saved = await readFleetMemory();
  if (saved !== undefined) {
    fleetAutomation = saved;
  }
  startFleetPolling({
    pollingHost: {
      checkout: () => shellHost.checkout(),
      fleetReadFailed,
      fleetReadSucceeded,
      reportProblem: (options) => {
        shellHost.reportProblem(options);
      },
    },
  });
}
