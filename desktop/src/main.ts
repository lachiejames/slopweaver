/**
 * The Slopweaver desktop shell: the running console in a native macOS window, the voice in a second, transparent
 * window over the owner's whole desktop, and a menu bar icon that says how it stands.
 *
 * - **The lifecycle follows Docker Desktop's**: the red X closes the console window and the app keeps running
 *   in the menu bar; Quit is the last item in that menu; a quit the owner chose raises nothing afterwards.
 * - **The voice is an overlay**: a modal voice experience that overlays the entire desktop and expands and collapses
 *   at will. One transparent window covers the
 *   whole primary display, above its menu bar and Dock, and owns the ONE call; the console window starts nothing and asks it instead
 *   (`desktopBridge.ts`, `overlayWindow.ts`).
 * - **The window remembers its size and position** and the page the owner was on (`persistedState.ts`).
 *
 * - **It brings the fleet back after a restart or a lockout** (`fleetAutomation.ts`). It reads `fleet health` from
 *   outside cmux and launches `fleet resume` once per down episode in a cmux tab the owner can see, quietly: the ONE
 *   sessions page opens only from the menu bar, and only a step the owner alone can take reaches them, as that page's one
 *   button and a floating note.
 *
 * - **Every window says it is Slopweaver** (a bare Electron window once showed a
 *   failure): titles, the Dock icon and a dev run's badge come from `buildIdentity.ts`, and a console that cannot be
 *   brought back raises ONE floating note saying what failed and what to do (`consoleNote.ts`).
 *
 * What it never does: start a model out of the owner's sight (AGENTS.md rule 2) — the voice is the console's own, in a
 * window the owner sees and can end, and every seat recovery resumes runs in a cmux tab; start a second console server or
 * stop the one serving (`scripts/docs-site.sh` owns it); load anything but the local console and its own fleet
 * pages; or notify the owner beyond a floating note for a failure or a step only the owner can take.
 */

import {
  app,
  BaseWindow,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  screen,
  Tray,
  type WebContents,
} from "electron";

import { drawAppMenu } from "./appMenuShell";
import { brandDock, brandTitle } from "./brandingShell";
import { type BuildIdentity, buildIdentity, trayIdentityLine, windowTitle } from "./buildIdentity";
import { chooseCheckoutFolder, servedCheckout, startCheckoutSelection } from "./checkoutSelectionShell";
import { consoleCardPathFromMessage, consoleCardPathOnConsole } from "./consoleCardAddress";
import { drawConsoleNote, startConsoleNote } from "./consoleNoteShell";
import {
  checkConsole,
  consoleRecovering,
  recover,
  recoveryInFlight,
  retryConsole,
  standingFailure,
  startConsoleRecovery,
} from "./consoleRecoveryShell";
import {
  type OverlayCommand,
  type OverlayStatus,
  parseOverlayCommand,
  parseOverlayStatus,
  parsePageIdentity,
  parseVoiceFailureNotice,
  queueCardTabPath,
} from "./desktopBridge";
import { desktopBootPolicy, desktopE2eMode, isDesktopTestInstance } from "./e2eMode";
import { type EdgeGlowShell, startEdgeGlowShell } from "./edgeGlowShell";
import { fleetTrayLine, fleetWindowOpen, showFleetWindow, startFleetShell } from "./fleetShell";
import { launchDesktop } from "./launch";
import {
  EMPTY_MEDIA_LEDGER,
  type MediaLedger,
  parseMediaReport,
  reduceMediaLedger,
  totalMediaCounts,
  windowAudioTracks,
} from "./mediaCounts";
import { SCREEN_RECORDING_OFF } from "./nativeCapture";
import { dropNavigationAsk, installNavigationAnswers } from "./navigationShell";
import { installOverlayBlur } from "./overlayBlurShell";
import { applyOverlayFit } from "./overlayMove";
import { type OverlayFit, overlayFitGeometry, overlayManipulating } from "./overlayPlace";
import {
  forgetPointer,
  installOverlayPointerWatch,
  installPointerReports,
  pointerOverControl,
} from "./overlayPointerShell";
import { watchOverlayRecovery } from "./overlayRecoveryShell";
import { forgetOverlayReports, installOverlayReports, overlayReports } from "./overlayReports";
import { installOverlayReportWatch, type OverlayReportWatchController } from "./overlayReportWatchShell";
import { CORNER_LEVEL, overlayCapturesPointer, overlayLevel, overlayPresentation } from "./overlayWindow";
import { installPageReveal } from "./pageRevealShell";
import { MICROPHONE_OFF } from "./permissionGuide";
import {
  permissionGuideMenuLabel,
  raiseInputControlGuide,
  raisePermissionGuide,
  startPermissionGuide,
} from "./permissionGuideShell";
import { installPermissions } from "./permissionsShell";
import { consolePath, FRESH_STATE, type PersistedState, windowPlacement } from "./persistedState";
import { planUsageTray, startPlanUsage } from "./planUsageShell";
import { installScreenHandlers } from "./screenShell";
import {
  INSTALLED_INFO_PLIST,
  ownInfoPlist,
  type ShellBuildWire,
  type ShellStamp,
  shellBuildWire,
  stampOfPlist,
} from "./shellBuild";
import {
  INITIAL_SHELL_STATE,
  menuView,
  QUEUE_PATH,
  reduceShellState,
  type ShellEvent,
  type ShellState,
} from "./shellState";
import { readPlist, statePath } from "./startupReads";
import { readPersistedState, writePersistedState } from "./stateStore";
import { consoleUrl, isVoicePath, VOICE_PATH, withoutSurfaceFlag } from "./surface";
import {
  guardConsoleNavigation,
  loadTab,
  navigationHost,
  openOutside,
  PINNED,
  pathOnConsole,
  type ShowTarget,
  showInPinnedTab,
  showWindow,
  startRouting,
} from "./tabRouting";
import { STRIP_GROUND } from "./tabStripLook";
import {
  activeIdentity,
  activeTabId,
  committedOf,
  everyTabContents,
  mountTabs,
  setFullscreen,
  setIdentity,
  startTabs,
  tabContents,
  tabIdOf,
  tabsToSave,
  unmountTabs,
} from "./tabsShell";
import { trayImage } from "./trayImage";
import { type TrayMenuActs, type TrayMenuParts, trayMenuItems } from "./trayMenu";
import { trayPresentation } from "./trayPresentation";
import * as triage from "./triageShell";
import { startUpdateShell, trayUpdateItems } from "./updateShell";
import { installVoiceQueueRequests } from "./voiceQueueShell";
import { webPreferencesFor } from "./webPreferences";
import { consoleWindowChrome } from "./windowChrome";
import { type DesktopSenderRole, roleForSenderPage } from "./windowRole";

/** How often a running console is checked. */
const CHECK_INTERVAL_MS = 15_000;

/** How long after the last change the saved state is written. */
const SAVE_DELAY_MS = 400;

/** Whether this process is a test instance beside the owner's app, and so what its boot does of its own accord. */
const e2eMode = desktopE2eMode({ argv: process.argv });
const bootPolicy = desktopBootPolicy({ mode: e2eMode });
/** Whether every console window carries the test-instance marker, so a call it places is never read as the owner's. */
const testInstance = isDesktopTestInstance({ mode: e2eMode });

let shellState: ShellState = INITIAL_SHELL_STATE;
let saved: PersistedState = FRESH_STATE;
/**
 * The console window: the tab strip and one page per tab (`tabsShell.ts`). Each tab keeps the console page it has
 * COMMITTED to — set by a navigation that landed, cleared by every load, failure and renderer death (`committedOf`).
 * `webContents.getURL()` is not that: after a failed load or a crash it still names the page that is not showing, and
 * bringing the window forward over that would leave the owner on a dead page.
 */
let consoleWindow: BaseWindow | undefined;
let overlay: BrowserWindow | undefined;
/** Reloads the overlay's page while it loaded and never reported, so a refused or broken page is never final (`overlayReportWatchShell.ts`). */
let overlayReportWatch: OverlayReportWatchController | undefined;
/** The screen-edge strips that draw the call's glow and a share's frame (`edgeGlowShell.ts`), once the app is ready. */
let edgeGlow: EdgeGlowShell | undefined;
let tray: Tray | undefined;
let saveTimer: NodeJS.Timeout | undefined;
/** Capture tracks per renderer, by `webContents.id`: a page load ends only that page's captures. */
const ledgers = new Map<number, MediaLedger>();
/** The origin the overlay's page was loaded from, so a healthy console never reloads it — that would end a call. */
let overlayOrigin: string | undefined;
/** The overlay has reported since its last load, so its page is listening for commands. */
let overlayListening = false;
/** The overlay's page has subscribed to the floor word since its last load, so its corner may leave the work area's bottom (`overlayFloorLine`). */
let overlayHearsFloor = false;
/** Commands sent before the overlay's page was listening, delivered in order when it first reports: one slot let a
 * triage `collapse` overwrite a launcher's `activate` and drop the call. */
const pendingCommands: OverlayCommand[] = [];
/** The level last set on the overlay, so a fit re-sets it only when whole and corner trade places. */
let overlayLevelNow: ReturnType<typeof overlayLevel> = CORNER_LEVEL;
/** Which Slopweaver this is, named on every window; fixed once the checkout is chosen at boot. */
let thisBuild: BuildIdentity = buildIdentity({ checkout: undefined, packaged: app.isPackaged });

/** The commit this process was built from, read once at launch (`shellBuild.ts`); `undefined` for an unstamped build. */
let runningStamp: ShellStamp | undefined;

/** The console's origin, once it is serving. */
function consoleOrigin(): string | undefined {
  return shellState.service.kind === "ready" ? shellState.service.endpoint : undefined;
}

/**
 * Apply an event and redraw the menu bar.
 *
 * @param event what happened
 */
function dispatch({ event }: { event: ShellEvent }): void {
  shellState = reduceShellState({ event, state: shellState });
  drawTray();
}

/**
 * Change the saved state and write it shortly after — or before returning, for a choice the owner made that a quit straight
 * after must not lose, where a window's move can wait out the delay.
 *
 * @param change the new fields
 * @param immediate write the file before returning rather than after the delay
 * @returns why an immediate write failed; `undefined` once it wrote, and always for a delayed one
 */
function save({ change, immediate }: { change: Partial<PersistedState>; immediate?: boolean }): string | undefined {
  saved = { ...saved, ...change };
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const write = (): string | undefined => {
    saveTimer = undefined;
    const written = writePersistedState({ path: statePath(), state: saved });
    const problem = written.isErr() ? written.error.message : undefined;
    dispatch({ event: { kind: "state-problem", problem } });
    return problem;
  };
  if (immediate === true) {
    return write();
  }
  saveTimer = setTimeout(write, SAVE_DELAY_MS);
  return undefined;
}

/**
 * Redraw the menu bar icon and its menu from the current state, and the application menu with it (`appMenuShell.ts`,
 * a no-op unless its update item changed).
 */
function drawTray(): void {
  drawAppMenu();
  if (tray === undefined) {
    return;
  }
  const view = menuView({ state: shellState });
  tray.setImage(trayImage({ variant: view.icon }));
  // A test instance's own icon is named Slopweaver Test everywhere it shows; the owner's keeps today's names, and
  // the triage countdown beside it, empty while triage is off (`triageShell.ts`).
  const named = trayPresentation({
    buildIdentityLine: trayIdentityLine({ identity: thisBuild }),
    buildLabel: thisBuild.label,
    statusTooltip: view.tooltip,
    testInstance,
    triageTitle: bootPolicy.triage ? triage.triageTrayTitle() : "",
  });
  tray.setToolTip(named.tooltip);
  tray.setTitle(named.title);
  // The same menu the owner's app draws, less what a test instance never started: fleet, permissions guide, triage.
  const parts: TrayMenuParts<MenuItemConstructorOptions> = {
    fleetLine: bootPolicy.fleet ? fleetTrayLine() : undefined,
    lines: named.identityLine === undefined ? view.lines : [named.identityLine, ...view.lines],
    permissions: bootPolicy.permissionGuide ? { label: permissionGuideMenuLabel() } : undefined,
    // Each plan's recorded usage after the fleet line: a headline, one line per plan behind it (`planUsageShell.ts`).
    planUsageItems: planUsageTray(),
    quitLabel: named.quitLabel,
    triageItems: bootPolicy.triage ? triage.triageTrayItems() : [],
    updateItems: trayUpdateItems(),
    view,
  };
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems({ acts: trayActs(), parts })));
  drawConsoleNote();
}

/**
 * What the menu bar menu's items do.
 *
 * @returns the acts, each the same press the owner's menu always made
 */
function trayActs(): TrayMenuActs {
  return {
    commandVoice: ({ command }) => {
      commandOverlay({ asked: true, command });
    },
    openQueue: () => {
      showWindow({ path: QUEUE_PATH, target: PINNED });
    },
    openSessions: showFleetWindow,
    quit: () => {
      app.quit();
    },
    raiseGuide: raisePermissionGuide,
    raiseInputControl: raiseInputControlGuide,
    reopen: ({ path }) => {
      showWindow({ path });
    },
    retry: retryConsole,
  };
}

/**
 * Start triage, the owner's app's alone: the countdown beside the icon, its menu items and the notes' two buttons,
 * all from the voice window's report, and the notes' file said off as the app quits.
 */
function startTriage(): void {
  triage.startTriageShell({
    triageHost: {
      fromOverlay: ({ event }) => senderRole({ event }) === "overlay",
      listeningOverlay: () => (overlayListening ? overlay?.webContents : undefined),
      redrawTray: drawTray,
      setTitle: ({ title }) => {
        tray?.setTitle(title);
      },
      // The Queue in front of the owner, and the conversation the pass runs in on their screen (AGENTS.md rule 2): a live call
      // stays as the owner has it, and with none up the Messenger card opens, where the typed pass they started is drawn.
      showForStart: () => {
        showWindow({ path: QUEUE_PATH, target: PINNED });
        const callUp = shellState.overlay?.callActive === true;
        commandOverlay({ asked: true, command: callUp ? "show" : "collapse" });
      },
    },
  });
  app.on("will-quit", triage.stopTriageShell);
}

/** Bring the console window forward, creating it when it was closed. */
function bringWindowForward(): void {
  if (consoleWindow === undefined) {
    createConsoleWindow();
    return;
  }
  if (consoleWindow.isMinimized()) {
    consoleWindow.restore();
  }
  consoleWindow.show();
  consoleWindow.focus();
}

/** What the tabs reach here (`tabsShell.ts`). */
const tabsHost = {
  activated: (): void => {
    dropNavigationAsk();
    const identity = activeIdentity();
    if (overlayListening && identity !== undefined) {
      overlay?.webContents.send("slopweaver:page-identity", identity);
    }
    const path = committedOf({ id: activeTabId() });
    if (path !== undefined) {
      dispatch({ event: { kind: "page-visited", path } });
      save({ change: { lastPath: path } });
    }
  },
  changed: (): void => {
    save({ change: { tabs: tabsToSave() } });
  },
  closeWindow: (): void => {
    consoleWindow?.close();
  },
  loadTab: ({ tabId }: { readonly tabId: string }): void => {
    loadTab({ id: tabId });
  },
  prepareTab: ({ tabId, contents }: { readonly tabId: string; readonly contents: WebContents }): void => {
    guardConsoleNavigation({ contents, tabId });
  },
  retireContents: ({ contentsId }: { readonly contentsId: number }): void => {
    resetCaptures({ contentsId });
  },
  tabPreferences: (): Electron.WebPreferences =>
    webPreferencesFor({ e2e: testInstance, fullscreen: false, role: "main" }),
  titleFor: ({ page }: { readonly page: string }): string => windowTitle({ identity: thisBuild, page }),
};

// What the routing reaches here (`tabRouting.ts`), lent before any tab can open.
startRouting({
  routingHost: {
    bringWindowForward,
    consoleOrigin,
    downProblem: (): string | undefined =>
      shellState.service.kind === "needs-attention" ? shellState.service.problem : undefined,
    pageVisited: ({ path }: { readonly path: string }): void => {
      dispatch({ event: { kind: "page-visited", path } });
      save({ change: { lastPath: path } });
    },
    recover,
    restarting: (): boolean => shellState.service.kind === "restarting",
    retireContents: tabsHost.retireContents,
    windowOpen: (): boolean => consoleWindow !== undefined,
  },
});

// What the console's recovery reaches here (`consoleRecoveryShell.ts`), lent before anything can ask it to recover.
startConsoleRecovery({
  recoveryHost: {
    checkout: servedCheckout,
    dispatch,
    loadOverlay: () => {
      loadOverlay();
    },
    service: () => shellState.service,
    start: bootPolicy.consoleStart,
  },
});

/** The console window's own ground, the dark strip's colour, seen only for the moment before a page paints its own. */
const CONSOLE_WINDOW_GROUND = STRIP_GROUND.dark;

/** Open the console window where it last was, at the size it last was, with its tabs. */
function createConsoleWindow(): void {
  const placement = windowPlacement({
    displays: screen.getAllDisplays().map((display) => display.workArea),
    primary: screen.getPrimaryDisplay().workArea,
    saved: saved.window.bounds,
  });
  const created = new BaseWindow({
    ...placement,
    // Opaque like every surface in it, since full opacity is the default: the pages paint their palette's ground, and this is only what shows before they do.
    backgroundColor: CONSOLE_WINDOW_GROUND,
    minHeight: 480,
    minWidth: 640,
    show: false,
    title: windowTitle({ identity: thisBuild, page: "" }),
    // No title strip: the tab strip runs to the top edge with the window's buttons inset at its left.
    ...consoleWindowChrome({ platform: process.platform }),
  });
  consoleWindow = created;
  if (process.platform === "darwin") {
    void app.dock?.show();
  }
  mountTabs({
    ready: () => {
      if (saved.window.maximised) {
        created.maximize();
      }
      if (saved.window.fullscreen) {
        created.setFullScreen(true);
      }
      created.show();
    },
    target: created,
    windowFullscreen: saved.window.fullscreen,
  });
  const keepBounds = (): void => {
    if (!created.isMaximized() && !created.isFullScreen() && !created.isMinimized()) {
      save({ change: { window: { ...saved.window, bounds: created.getBounds() } } });
    }
  };
  created.on("resize", keepBounds);
  created.on("move", keepBounds);
  created.on("maximize", () => {
    save({ change: { window: { ...saved.window, maximised: true } } });
  });
  created.on("unmaximize", () => {
    save({ change: { window: { ...saved.window, maximised: false } } });
  });
  created.on("enter-full-screen", () => {
    save({ change: { window: { ...saved.window, fullscreen: true } } });
    setFullscreen({ windowFullscreen: true });
  });
  created.on("leave-full-screen", () => {
    save({ change: { window: { ...saved.window, fullscreen: false } } });
    setFullscreen({ windowFullscreen: false });
  });
  created.on("closed", () => {
    consoleWindow = undefined;
    dropNavigationAsk();
    // Every tab's page goes with the window; the tabs stay, to load again when it reopens.
    unmountTabs();
    // The Docker Desktop shape: the window is gone, the app lives on in the menu bar, and the Dock forgets it.
    if (process.platform === "darwin" && !fleetWindowOpen()) {
      app.dock?.hide();
    }
  });
}

/** Create the voice's window over the primary display, hidden until its page reports itself. */
function createOverlay(): BrowserWindow {
  // No page has reported yet, so this is the whole display and no zoom enters it.
  const { placement } = overlayFitNow({ zoomFactor: 1 });
  const created = new BrowserWindow({
    ...placement.bounds,
    // A press on the orb while another app is in front reaches the page on the first click, rather than only making
    // the window key and leaving the press unheard.
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    // Without it macOS constrains the frame below the menu bar as the window is shown; a frameless window that has it
    // keeps exactly the frame it was given.
    enableLargerThanScreen: true,
    focusable: true,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "Slopweaver voice",
    transparent: true,
    // A non-activating panel floats over full-screen apps the way Spotlight does, and takes the keyboard for the
    // stage without pulling the owner's other app out of focus.
    type: "panel",
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: webPreferencesFor({ e2e: testInstance, fullscreen: false, role: "overlay" }),
  });
  brandTitle({ fixed: "Slopweaver voice", identity: thisBuild, target: created });
  created.setVibrancy(null);
  overlayLevelNow = overlayLevel({ placement });
  created.setAlwaysOnTop(true, overlayLevelNow);
  created.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true, visibleOnFullScreen: true });
  created.setIgnoreMouseEvents(true, { forward: true });
  // Never content-protected, and never hidden for a look: every picture of the owner's screen, the voice's own included, has
  // the orb, the widget and the transcript in it as the owner sees them: what the owner sees is what the voice sees.
  const contents = created.webContents;
  const contentsId = contents.id;
  // The overlay lost focus: a move into another app folds the stage, and the messenger with no call up, to the orb;
  // one into a Slopweaver window sends nothing (`overlayBlurShell.ts`).
  installOverlayBlur({
    created,
    state: () => ({ current: overlay === created, listening: overlayListening, status: shellState.overlay }),
  });
  // Main's own cursor watch takes the pointer over a control without waiting on a busy renderer (`overlayPointerShell.ts`).
  installOverlayPointerWatch({
    apply: applyPointer,
    created,
    watching: () => overlay === created && created.isVisible() && shellState.overlay?.mode !== "expanded",
  });
  // A console link the voice shows the owner opens in a new tab beside the one they are reading, never over it.
  const besideOwnerPage = (): ShowTarget => ({ foreground: true, kind: "new", opener: activeTabId() });
  contents.setWindowOpenHandler(({ url }) => {
    const path = pathOnConsole({ url });
    if (path === undefined) {
      openOutside({ url });
    } else if (!isVoicePath({ path })) {
      showWindow({ path, target: besideOwnerPage() });
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const path = pathOnConsole({ url });
    if (path !== undefined && isVoicePath({ path })) {
      return;
    }
    event.preventDefault();
    if (path === undefined) {
      openOutside({ url });
    } else {
      showWindow({ path, target: besideOwnerPage() });
    }
  });
  // A call it held, ended and reconnected when its renderer dies under it.
  watchOverlayRecovery({ contents, roleOf: senderRole });
  // A page that loaded and never reported is reloaded, backing off, until one does: nothing else would, because the
  // console's origin has not changed, and the tray's voice item waits on that report too.
  overlayReportWatch = installOverlayReportWatch({
    listening: () => overlay === created && overlayListening,
    target: created,
  });
  contents.on("did-navigate", () => {
    retireOverlayPage({ contentsId });
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      overlayOrigin = undefined;
      // A reload that failed left no page running the pass, so its countdown goes with it.
      triage.retireTriage();
      // Nor any glow it lit: the strips would otherwise stay lit until recovery succeeded.
      edgeGlow?.retire();
      recover();
    }
  });
  contents.on("render-process-gone", () => {
    overlayOrigin = undefined;
    retireOverlayPage({ contentsId });
    // Reload at once: nothing else would — the console is still healthy, and the tray's voice item went with the
    // page — so a crash would otherwise leave the voice hidden for good.
    loadOverlay();
  });
  created.on("closed", () => {
    overlay = undefined;
    overlayReportWatch = undefined;
    overlayOrigin = undefined;
    resetCaptures({ contentsId });
    triage.retireTriage();
    edgeGlow?.retire();
  });
  return created;
}

/** Load the voice page into the overlay — only when the console's origin is new to it, so a live call survives. */
function loadOverlay(): void {
  const origin = consoleOrigin();
  if (origin === undefined || origin === overlayOrigin) {
    return;
  }
  overlay ??= createOverlay();
  overlayReportWatch?.newOrigin();
  overlayOrigin = origin;
  overlayListening = false;
  overlayHearsFloor = false;
  void overlay.loadURL(consoleUrl({ origin, path: VOICE_PATH }));
}

/**
 * One fit of the overlay now (`overlayPlace.ts`): the whole primary display, the window round a dragged orb, or its
 * corner while nothing it draws needs more, and the words its page hears beside it.
 *
 * @param zoomFactor the overlay page's zoom
 * @returns the placement and its words
 */
function overlayFitNow({ zoomFactor }: { zoomFactor: number }): OverlayFit {
  return overlayFitGeometry({
    display: screen.getPrimaryDisplay(),
    expanded: shellState.overlay?.mode === "expanded",
    hearsFloor: overlayHearsFloor,
    reports: overlayReports(),
    zoomFactor,
  });
}

/**
 * Keep the overlay on the primary display as displays come and go, and as what it draws changes: its level, set only
 * on a change (one level now, `overlayWindow.ts` `WHOLE_LEVEL`), the work area's inset inside it, its bounds, then whether it is whole now. The
 * inset goes before the resize, so a measure taken between the two errs to a corner too tall, never one that clips
 * the orb; and before the word that lets the page draw. The page waits for the word rather than measuring, because a
 * zoomed page's CSS pixels are not the screen's.
 */
function fitOverlay(): void {
  if (overlay === undefined || overlay.isDestroyed()) {
    return;
  }
  const fit = overlayFitNow({ zoomFactor: overlay.webContents.getZoomFactor() });
  const level = overlayLevel({ placement: fit.placement });
  if (level !== overlayLevelNow) {
    overlayLevelNow = level;
    overlay.setAlwaysOnTop(true, level);
  }
  applyOverlayFit({ ...fit, target: overlay });
}

/**
 * Send the voice a command from the tray or the console window, bringing its window up first. The tray's own `show`
 * only brings a hidden voice back as it was, the call untouched.
 *
 * @param command what to do
 * @param asked the owner asked for the voice, from the menu bar or the console window, so one they hid with the X comes back
 *   for it
 */
function commandOverlay({ command, asked = false }: { command: OverlayCommand | "show"; asked?: boolean }): void {
  if (asked) {
    dispatch({ event: { kind: "overlay-shown" } });
  }
  if (command === "activate" && consoleWindowHoldsMic()) {
    // One call at a time: the console window opened its own before it knew it was in the shell. An
    // ask still brings a hidden voice back, with the second call refused, so the flag and the window never disagree.
    revealOverlay();
    return;
  }
  if (command === "show") {
    revealOverlay();
    return;
  }
  loadOverlay();
  // Held until the voice page first listens — also before the console serves at boot, when there is no overlay yet.
  // The update's own restart never comes this way: `updateCallShell.ts` keeps it owed until a listening page takes it.
  if (overlay === undefined || !overlayListening) {
    pendingCommands.push(command);
    return;
  }
  revealOverlay();
  overlay.webContents.send("slopweaver:overlay-command", command);
}

/**
 * Whether a window other than the overlay holds a live microphone — a call open there, which the overlay must not
 * start a second one beside.
 *
 * @returns true while any non-overlay renderer's ledger counts an audio track
 */
function consoleWindowHoldsMic(): boolean {
  return totalMediaCounts({ exceptContentsId: overlay?.webContents.id, ledgers }).audioTracks > 0;
}

/**
 * Show the overlay, but only once its page has reported itself. A page that never reports — a console from before
 * the overlay existed answering `/voice` with its 404, a page that failed to hydrate — is never shown, because
 * whatever it paints would sit over the owner's whole desktop. Nor while the owner has hidden it with the X on its orb. Once shown,
 * the page is told, so a pointer already resting where the orb appears is hit-tested rather than passed through until
 * it moves (`preload.ts` `relocate`: Show voice pressed from the keyboard over the orb's corner).
 */
function revealOverlay(): void {
  if (overlay !== undefined && overlayListening && !shellState.overlayHidden && !overlay.isVisible()) {
    overlay.showInactive();
    overlay.webContents.send("slopweaver:overlay-revealed");
  }
}

/**
 * The overlay's page is gone — navigated or crashed: hide the window until the next page reports, end that page's
 * captures, pass the pointer through again, and take the voice item off the tray.
 *
 * @param contentsId the overlay's renderer
 */
function retireOverlayPage({ contentsId }: { contentsId: number }): void {
  overlayListening = false;
  overlayHearsFloor = false;
  forgetPointer();
  forgetOverlayReports();
  resetCaptures({ contentsId });
  // The pass stopped with the page that ran it (`useTriageWalk.ts`), so its countdown goes too.
  triage.retireTriage();
  edgeGlow?.retire();
  overlay?.hide();
  overlay?.setIgnoreMouseEvents(true, { forward: true });
  dispatch({ event: { kind: "overlay-reported", status: undefined } });
  mirrorOverlayStatus();
  fitOverlay();
}

/**
 * Tell the console window where the voice stands, so its own controls say a call is up while the overlay holds one
 * rather than offering a start. `null` is no page reporting at all.
 */
function mirrorOverlayStatus(): void {
  const status = overlayStatusOnWire();
  for (const contents of everyTabContents()) {
    contents.send("slopweaver:overlay-status", status);
  }
}

/**
 * The voice's standing as the console window is told it: the overlay's last report, or `null` while no page reports.
 *
 * @returns the status, or `null`
 */
function overlayStatusOnWire(): OverlayStatus | null {
  if (shellState.overlay === undefined) {
    return null;
  }
  return shellState.overlay;
}

/**
 * Apply what the overlay reports: the tray's voice item, the glass behind the stage, the keyboard, the pointer.
 *
 * @param status the voice's view and whether a call is up
 */
function applyOverlayStatus({ status }: { status: OverlayStatus }): void {
  if (overlay === undefined) {
    return;
  }
  // First, so no fit, focus or command delivery below widens the window a deadline could fire in.
  overlayReportWatch?.reported();
  const before = shellState.overlay;
  dispatch({ event: { kind: "overlay-reported", status } });
  mirrorOverlayStatus();
  fitOverlay();
  // A call starting, or the stage coming up, ends a hide (`shellState.ts`): shown before the stage takes the keyboard.
  // Before the page's first report this waits for the reveal below.
  revealOverlay();
  const presentation = overlayPresentation({ mode: status.mode });
  if (before?.mode !== status.mode) {
    overlay.setVibrancy(presentation.vibrancy, { animationDuration: 120 });
    if (presentation.focus) {
      overlay.focus();
    }
  }
  applyPointer();
  if (!overlayListening) {
    overlayListening = true;
    revealOverlay();
    const identity = activeIdentity();
    if (identity !== undefined) {
      overlay.webContents.send("slopweaver:page-identity", identity);
    }
    for (const command of pendingCommands.splice(0)) {
      overlay.webContents.send("slopweaver:overlay-command", command);
    }
    triage.triageOverlayListening();
  }
}

/** Take the pointer or pass it through, from the voice's view and where the pointer is (`overlayPointerShell.ts`). */
function applyPointer(): void {
  const mode = shellState.overlay?.mode;
  const captures = overlayCapturesPointer({
    mode: mode === "expanded" ? "expanded" : "collapsed",
    manipulating: overlayManipulating({ reports: overlayReports() }),
    overInteractive: pointerOverControl(),
  });
  if (captures) {
    overlay?.setIgnoreMouseEvents(false);
  } else {
    overlay?.setIgnoreMouseEvents(true, { forward: true });
  }
}

/**
 * A page load ends every capture that page held.
 *
 * @param contentsId the renderer whose captures end
 */
function resetCaptures({ contentsId }: { contentsId: number }): void {
  ledgers.delete(contentsId);
  recordCaptures();
}

/** Push the capture counts into the state, the saved call flag and the sharing edge. */
function recordCaptures(): void {
  const { audioTracks, displayTracks } = totalMediaCounts({ exceptContentsId: undefined, ledgers });
  dispatch({ event: { audioTracks, displayTracks, kind: "media-counted" } });
  edgeGlow?.setSharing({ sharing: displayTracks > 0 });
  const callOpen = audioTracks > 0;
  if (saved.callOpen !== callOpen) {
    save({ change: { callOpen } });
  }
}

/**
 * Which window sent a message, if it is one of ours, on the console, from its top frame.
 *
 * @param event the message's event
 * @returns the sending window's role, or `undefined` for anything else
 */
function senderRole({ event }: { event: IpcMainEvent | IpcMainInvokeEvent }): DesktopSenderRole | undefined {
  const frame = event.senderFrame;
  if (frame === null) {
    return undefined;
  }
  const sender: WebContents = event.sender;
  let candidate: DesktopSenderRole | undefined;
  if (tabIdOf({ contents: sender }) !== undefined) {
    candidate = "main";
  } else if (sender === overlay?.webContents) {
    candidate = "overlay";
  }
  // The voice's window is judged against the origin its page was loaded from, so a recovery never blinds a live
  // call (`windowRole.ts`).
  return roleForSenderPage({
    candidate,
    consoleOrigin: consoleOrigin(),
    frameUrl: frame.url,
    overlayOrigin,
    topLevel: frame.parent === null,
  });
}

/** Every message a window may send, each accepted only from the window allowed to send it. */
function installMessages(): void {
  ipcMain.on("slopweaver:media-report", (event, value: unknown) => {
    const report = parseMediaReport({ value });
    if (senderRole({ event }) === undefined || report === undefined) {
      return;
    }
    const id = event.sender.id;
    // A renderer with no ledger yet has held nothing — its first report starts from empty, by design.
    let ledger = EMPTY_MEDIA_LEDGER;
    const before = ledgers.get(id);
    if (before !== undefined) {
      ledger = before;
    }
    ledgers.set(id, reduceMediaLedger({ ledger, report }));
    recordCaptures();
  });
  ipcMain.on("slopweaver:overlay-request", (event, value: unknown) => {
    const command = parseOverlayCommand({ value });
    if (senderRole({ event }) === "main" && command !== undefined) {
      // A press in the console window is the owner's ask for the voice, so a hidden one comes back for it.
      commandOverlay({ asked: true, command });
    }
  });
  // The orb's options opened: the window takes the owner's keyboard, so their next click into another app is its blur and
  // folds them, while a click into a Slopweaver window leaves them open (`overlayCommandOnBlur`). Only the overlay may
  // ask, and only while it is on screen.
  ipcMain.on("slopweaver:overlay-focus", (event) => {
    if (senderRole({ event }) === "overlay" && overlay?.isVisible() === true) {
      overlay.focus();
    }
  });
  // The X on the orb, from the overlay only: the window leaves the owner's screen and the call runs on, its renderer
  // unthrottled (`webPreferencesFor`), until Show voice, an explicit ask or the next call brings it back
  // (`shellState.ts`). The preload releases the pointer just before it asks, so the window shows again passing clicks
  // through; main never clears the flag itself, since the preload only sends a change and would never re-take it.
  // The reducer refuses a hide while the stage is up, and then the window stays.
  ipcMain.on("slopweaver:overlay-hide", (event) => {
    if (senderRole({ event }) === "overlay" && overlay !== undefined && !overlay.isDestroyed()) {
      dispatch({ event: { kind: "overlay-hidden" } });
      if (shellState.overlayHidden) {
        overlay.hide();
      }
    }
  });
  ipcMain.on("slopweaver:overlay-status", (event, value: unknown) => {
    const status = parseOverlayStatus({ value });
    if (senderRole({ event }) === "overlay" && status !== undefined) {
      applyOverlayStatus({ status });
    }
  });
  // A console page loaded after the overlay last reported asks once, so it never waits for the next change to know.
  ipcMain.handle("slopweaver:overlay-status-now", (event): OverlayStatus | null => {
    if (senderRole({ event }) !== "main") {
      return null;
    }
    return overlayStatusOnWire();
  });
  // The sidebar's app line: which commit this process was built from, and which one /Applications holds now.
  ipcMain.handle("slopweaver:shell-build", async (event): Promise<ShellBuildWire | null> => {
    if (senderRole({ event }) !== "main") {
      return null;
    }
    let installed: ShellStamp | undefined;
    if (app.isPackaged) {
      installed = stampOfPlist({ plist: await readPlist({ path: INSTALLED_INFO_PLIST }) });
    }
    return shellBuildWire({ dev: !app.isPackaged, installed, running: runningStamp });
  });
  installPointerReports({ apply: applyPointer, fromOverlay: ({ event }) => senderRole({ event }) === "overlay" });
  installOverlayReports({
    applyPointer,
    fit: fitOverlay,
    fromOverlay: ({ event }) => senderRole({ event }) === "overlay",
  });
  ipcMain.on("slopweaver:overlay-floor-heard", (event) => {
    if (senderRole({ event }) === "overlay" && !overlayHearsFloor) {
      overlayHearsFloor = true;
      fitOverlay();
    }
  });
  ipcMain.on("slopweaver:page-identity", (event, value: unknown) => {
    const identity = parsePageIdentity({ value });
    const tabId = tabIdOf({ contents: event.sender });
    if (senderRole({ event }) !== "main" || identity === undefined || tabId === undefined) {
      return;
    }
    // The open card rides with the page, so a tab switch hands the voice that tab's card too.
    const said = { ...identity, path: withoutSurfaceFlag({ path: identity.path }) };
    setIdentity({ id: tabId, identity: said });
    // Only the tab the owner is looking at speaks for the voice; another tab's word is kept for when it is shown.
    if (overlayListening && tabId === activeTabId()) {
      overlay?.webContents.send("slopweaver:page-identity", said);
    }
  });
  // The voice puts a Queue or Alignment card on the owner's screen — the one it is about to talk about, or one they ask for:
  // only the voice's window may ask, only for exactly a card's
  // address, and the shell loads the address it rebuilt rather than the one sent.
  ipcMain.handle("slopweaver:present-console-card", (event, value: unknown): void => {
    const path = consoleCardPathFromMessage({ role: senderRole({ event }), value });
    if (path === undefined) {
      throw new Error("only the voice's window may show a card, and only by a /queue or /alignment ?open= address");
    }
    // The one pinned Queue tab, shown in the strip, its own live address kept, and
    // the window never brought forward for it — not over another app, not beside the orb on the full-screen stage.
    showInPinnedTab({ pathFor: ({ liveUrl }) => consoleCardPathOnConsole({ liveUrl, path }) });
  });
  // Something the voice tried for the owner failed: the console window shows it as a toast in the tab the owner is looking at, never
  // over other apps nor beside the orb. Only the voice's window
  // may say so, and only while the console window is up where the owner can see it — a closed, hidden or minimised window
  // is never raised for it, and nothing is held for later; the voice's own activity record keeps the line.
  ipcMain.on("slopweaver:voice-failure", (event, value: unknown) => {
    const notice = parseVoiceFailureNotice({ role: senderRole({ event }), value });
    if (notice === undefined || consoleWindow === undefined || consoleWindow.isDestroyed()) {
      return;
    }
    if (!consoleWindow.isVisible() || consoleWindow.isMinimized()) {
      return;
    }
    const contents = tabContents({ id: activeTabId() });
    if (contents !== undefined && !contents.isDestroyed()) {
      contents.send("slopweaver:voice-failure", notice);
    }
  });
  // A card the voice could not open, opened on the owner's click from its toast as a new tab here — never their browser
  // and never by itself. The page sends the card's key only; the path is built here.
  ipcMain.on("slopweaver:open-queue-card-in-new-tab", (event, value: unknown) => {
    const path = queueCardTabPath({ role: senderRole({ event }), value });
    if (path.isOk()) {
      showWindow({ path: path.value, target: { foreground: true, kind: "new", opener: activeTabId() } });
    }
  });
  installNavigationAnswers({ host: navigationHost });
  installVoiceQueueRequests({ fromOverlay: ({ event }) => senderRole({ event }) === "overlay" });
  // A local page in the viewer, selected in Finder on the owner's click: the slug only (`pageReveal.ts`).
  installPageReveal({ checkout: servedCheckout, roleOf: senderRole });
  ipcMain.on("slopweaver:appearance", (event, value: unknown) => {
    // The console's own light/dark choice, never the system's.
    if (senderRole({ event }) !== undefined && (value === "light" || value === "dark")) {
      nativeTheme.themeSource = value;
    }
  });
  // The voice looks at the owner's screen, and on their ask lifts one region of what it saw (`screenShell.ts`).
  installScreenHandlers({
    isVoiceSender: ({ event }) => senderRole({ event }) === "overlay",
    overlayMicTracks: () => windowAudioTracks({ contentsId: overlay?.webContents.id, ledgers }),
    report: (shellEvent) => {
      dispatch({ event: shellEvent });
      // A look refused for Screen Recording is the moment the owner needs the switch: the guide comes up on it.
      if (shellEvent.kind === "permission-problem" && shellEvent.problem === SCREEN_RECORDING_OFF) {
        raisePermissionGuide();
      }
    },
    shellNow: () => shellState,
    voiceNow: () => overlay,
  });
}

/** Start the update's half (`updateShell.ts`) over this app's state and windows. */
function startUpdates(): void {
  startUpdateShell({
    policy: bootPolicy,
    updateHost: {
      callLive: () => shellState.audioTracks > 0 || shellState.overlay?.callActive === true,
      checkout: servedCheckout,
      consoleWindowHoldsMic,
      drawTray,
      ensureOverlay: loadOverlay,
      listeningOverlay: () => (overlayListening ? overlay?.webContents : undefined),
      persist: (next) => {
        saved = next;
        save({ change: {}, immediate: true });
      },
      // A new origin is what makes `loadOverlay` load; the page it loads reports listening afresh.
      reloadOverlay: () => {
        overlayOrigin = undefined;
        loadOverlay();
      },
      roleOf: (event) => senderRole({ event }),
      saved: () => saved,
    },
  });
}

/** Start the shell; `tabsReady` is the launcher's word that the tabs exist, so its waiting deep links act. */
async function boot({ tabsReady }: { readonly tabsReady: () => void }): Promise<void> {
  // First, before any window can ask: this process's own stamp, from the bundle it was launched from.
  if (app.isPackaged) {
    runningStamp = stampOfPlist({ plist: await readPlist({ path: ownInfoPlist({ execPath: process.execPath }) }) });
  }
  const read = await readPersistedState({ path: statePath() });
  if (read.isOk()) {
    saved = read.value;
  } else {
    dispatch({ event: { kind: "state-problem", problem: read.error.message } });
  }
  const lastPath = consolePath({ path: saved.lastPath });
  if (lastPath !== undefined) {
    dispatch({ event: { kind: "page-visited", path: lastPath } });
  }
  if (saved.callOpen) {
    dispatch({ event: { kind: "interrupted-call-read", present: true } });
    save({ change: { callOpen: false } });
  }
  startCheckoutSelection({
    selectionHost: {
      retry: retryConsole,
      save,
      savedCheckout: () => saved.checkout,
    },
  });
  thisBuild = buildIdentity({ checkout: servedCheckout().unwrapOr(undefined), packaged: app.isPackaged });
  brandDock({ identity: thisBuild });
  startConsoleNote({
    noteHost: {
      chooseCheckout: chooseCheckoutFolder,
      identity: () => thisBuild,
      retry: retryConsole,
      standing: standingFailure,
      titleFor: ({ page }) => windowTitle({ identity: thisBuild, page }),
    },
  });
  // Before the first menu is drawn, which carries its items: the countdown, the menu's triage items and the notes'
  // two buttons, all from the voice window's report alone. The owner's app only: it writes the shared notes' file and inbox.
  if (bootPolicy.triage) {
    startTriage();
  }
  // Nothing is read until a tray draws its first menu, so an app booted without one never asks (`planUsageShell.ts`).
  startPlanUsage({ planUsageHost: { consoleOrigin, redrawTray: drawTray } });
  tray = bootPolicy.tray ? new Tray(trayImage({ variant: "recovering" })) : undefined;
  drawTray();
  installPermissions({
    consoleOrigin,
    reportProblem: ({ problem }) => {
      dispatch({ event: { kind: "permission-problem", problem } });
      // The microphone refused at Start is the moment the owner needs the switch: the guide comes up on it.
      if (problem === MICROPHONE_OFF) {
        raisePermissionGuide();
      }
    },
  });
  // Not awaited: System Audio Recording's first read is a helper process, and the window and console do not wait on
  // it — only the guide's own launch decision does.
  if (bootPolicy.permissionGuide) {
    void startPermissionGuide({
      guideHost: {
        callLive: () => shellState.audioTracks > 0 || shellState.overlay?.callActive === true,
        dismissed: () => {
          // Absent until the owner first says Not now: nothing dismissed yet.
          if (saved.permissionsDismissed === undefined) {
            return [];
          }
          return saved.permissionsDismissed;
        },
        identity: () => thisBuild,
        inputControlConsent: () => saved.inputControlConsent,
        rememberDismissed: ({ dismissed }) => {
          save({ change: { permissionsDismissed: dismissed }, immediate: true });
        },
        rememberInputControlConsent: ({ consent }) =>
          save({ change: { inputControlConsent: consent }, immediate: true }),
        statusesChanged: ({ statuses }) => {
          // A switch the owner turned on answers the line its refusal left; Screen Recording's waits for the look that works.
          // System Audio Recording leaves no line here: the guide itself says when it is off or unreadable.
          if (statuses.microphone === "granted" && shellState.permissionProblem === MICROPHONE_OFF) {
            dispatch({ event: { kind: "permission-problem", problem: undefined } });
          }
          drawTray();
        },
        titleFor: ({ page }) => windowTitle({ identity: thisBuild, page }),
      },
    });
  }
  installMessages();
  edgeGlow = startEdgeGlowShell({ fromOverlay: ({ event }) => senderRole({ event }) === "overlay" });
  screen.on("display-metrics-changed", fitOverlay);
  screen.on("display-added", fitOverlay);
  screen.on("display-removed", fitOverlay);
  // The owner's tabs come back as they left them, each loading the first time it is shown, and the owner lands on the
  // Queue's own tab; the last page is one click away.
  startTabs({ home: QUEUE_PATH, saved: saved.tabs, tabsHost });
  tabsReady();
  recover();
  // After the tabs and the console are on their way: a saved update is waited on, and a call ended for one restarts
  // once the voice page listens, the shell looking again each second until it does. A test instance runs this too,
  // so its own update steps restart its own call; it never launches an install. Both bits are the update half's to read.
  startUpdates();
  // The fleet is read from the start, never after the console: detecting it down must not wait on the console.
  if (bootPolicy.fleet) {
    await startFleetShell({
      shellHost: {
        checkout: servedCheckout,
        consoleRecovering,
        consoleWindowOpen: () => consoleWindow !== undefined,
        redrawTray: drawTray,
        reportProblem: ({ problem }) => {
          dispatch({ event: { kind: "state-problem", problem } });
        },
        titleFor: ({ page }) => windowTitle({ identity: thisBuild, page }),
      },
    });
  }
  await recoveryInFlight();
  setInterval(checkConsole, CHECK_INTERVAL_MS);
}

// A launcher's `slopweaver://voice` is treated as an ask, exactly as the menu bar's Start voice is. The address carries
// no provenance, so any local process can send it; the bound is that it only ever starts that one call
// (`desktop/docs/launcher-commands.md` § Least privilege).
launchDesktop({ boot, mode: e2eMode, startVoice: commandOverlay });
