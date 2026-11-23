/**
 * The fleet's two windows, applied to Electron: the sessions page and the floating note. `fleetShell.ts` decides what
 * each shows and whether the note is up; this module owns the windows, loads what it is handed, and passes every
 * click back.
 *
 * Both run with JavaScript OFF and no preload: a page that cannot run script needs no bridge, and its only way to ask
 * for anything is a `slopweaver-fleet:` link this module intercepts and hands to the shell, which checks it against
 * the hand step standing at that moment.
 */
import { app, BrowserWindow, screen } from "electron";

import { type FleetLink, fleetLinkOf } from "./fleetPage";

/** What the windows read from, and tell, the rest of the shell. */
export interface FleetWindowsHost {
  /** A page or the note navigated to one of its links. */
  readonly actOnLink: (options: { readonly link: FleetLink }) => void;
  /** The console window is open, so closing the sessions page keeps the Dock icon. */
  readonly consoleWindowOpen: () => boolean;
  /** Draw everything from the current reading. */
  readonly draw: () => void;
  /** The menu's fleet line, and the console's note under this one, need redrawing. */
  readonly redrawTray: () => void;
  /** A window's title, naming Slopweaver and, in a dev run, the dev build (`buildIdentity.ts`). */
  readonly titleFor: (options: { readonly page: string }) => string;
}

let host: FleetWindowsHost | undefined;
let fleetWindow: BrowserWindow | undefined;
let noteWindow: BrowserWindow | undefined;
/** What each window last loaded, so an unchanged reading never reloads it and closes the owner's fold. */
let fleetLoaded: string | undefined;
let noteLoaded: string | undefined;

/**
 * The host, once `startFleetWindows` has run.
 *
 * @returns the host
 */
function hostOf(): FleetWindowsHost {
  if (host === undefined) {
    throw new Error("the fleet windows were used before startFleetWindows");
  }
  return host;
}

/**
 * Give the windows the shell they report to. Nothing is drawn yet.
 *
 * @param windowsHost what the windows read from the rest of the shell
 */
export function startFleetWindows({ windowsHost }: { windowsHost: FleetWindowsHost }): void {
  host = windowsHost;
}

/**
 * Whether the sessions page is open, so closing the console window keeps the Dock icon.
 *
 * @returns true while its window exists
 */
export function fleetWindowOpen(): boolean {
  return fleetWindow !== undefined;
}

/**
 * Where the floating note stands, so the console's own note can sit under it rather than over it.
 *
 * @returns the note window's bounds, or `undefined` while no note is up
 */
export function fleetNoteBounds(): Electron.Rectangle | undefined {
  if (noteWindow === undefined || !noteWindow.isVisible()) {
    return undefined;
  }
  return noteWindow.getBounds();
}

/**
 * Keep a fleet window on its own page: a navigation is only ever one of the page's links, and it is acted on there.
 *
 * @param target the sessions page or the floating note
 */
function guardNavigation({ target }: { target: BrowserWindow }): void {
  const contents = target.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const link = fleetLinkOf({ url });
    if (link !== undefined) {
      hostOf().actOnLink({ link });
    }
  });
}

/**
 * Hold a fleet window to its own title, so neither the document's `<title>` nor a dev run's bare Electron name ever
 * stands in for it.
 *
 * @param target the sessions page or the floating note
 * @param page what the window is, before the build's name is added
 */
function brandTitle({ target, page }: { target: BrowserWindow; page: string }): void {
  const title = hostOf().titleFor({ page });
  target.setTitle(title);
  target.on("page-title-updated", (event) => {
    event.preventDefault();
    target.setTitle(title);
  });
}

/**
 * The web preferences both fleet windows share: no script at all, no preload, nothing to bridge.
 *
 * @returns the preferences
 */
function webPreferences(): Electron.WebPreferences {
  return { contextIsolation: true, javascript: false, nodeIntegration: false, sandbox: true };
}

/** Show the sessions page, creating its window when it was closed. */
export function showFleetWindow(): void {
  if (fleetWindow !== undefined) {
    fleetWindow.show();
    fleetWindow.focus();
    return;
  }
  const created = new BrowserWindow({
    backgroundColor: "#0f1115",
    height: 720,
    minHeight: 360,
    minWidth: 480,
    title: "Sessions",
    webPreferences: webPreferences(),
    width: 760,
  });
  fleetWindow = created;
  fleetLoaded = undefined;
  if (process.platform === "darwin") {
    void app.dock?.show();
  }
  brandTitle({ page: "Sessions", target: created });
  guardNavigation({ target: created });
  created.on("closed", () => {
    fleetWindow = undefined;
    fleetLoaded = undefined;
    if (process.platform === "darwin" && !hostOf().consoleWindowOpen()) {
      app.dock?.hide();
    }
  });
  hostOf().draw();
}

/**
 * Load the sessions page, when it is open and the page changed.
 *
 * @param url the page the current reading draws
 */
export function drawFleetPage({ url }: { readonly url: string }): void {
  if (fleetWindow !== undefined && url !== fleetLoaded) {
    fleetLoaded = url;
    void fleetWindow.loadURL(url);
  }
}

/**
 * Show the floating note at a page, creating its window when none is up, or take it down.
 *
 * @param url the note to show, or `undefined` to take it down
 */
export function drawFleetNote({ url }: { readonly url: string | undefined }): void {
  if (url === undefined) {
    noteWindow?.close();
    return;
  }
  if (noteWindow === undefined) {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = 380;
    // Content-sized for the longest note, a four-line sign-in naming its email: at 150 the window's own title bar
    // pushed the button and "Not now" out of sight (seen in the lockout drill), leaving nothing to press.
    // The stall note's three sentences and its command block need the extra height.
    const created = new BrowserWindow({
      alwaysOnTop: true,
      backgroundColor: "#0f1115",
      fullscreenable: false,
      height: 300,
      useContentSize: true,
      maximizable: false,
      minimizable: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      title: "Slopweaver fleet",
      type: "panel",
      webPreferences: webPreferences(),
      width,
      x: workArea.x + workArea.width - width - 16,
      y: workArea.y + 16,
    });
    created.setAlwaysOnTop(true, "floating");
    created.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true, visibleOnFullScreen: true });
    brandTitle({ page: "Slopweaver fleet", target: created });
    guardNavigation({ target: created });
    created.once("ready-to-show", () => {
      created.showInactive();
      // The console's note sits under this one, so it moves when this one comes up.
      hostOf().redrawTray();
    });
    created.on("closed", () => {
      noteWindow = undefined;
      noteLoaded = undefined;
      hostOf().redrawTray();
    });
    noteWindow = created;
  }
  if (url !== noteLoaded) {
    noteLoaded = url;
    void noteWindow.loadURL(url);
  }
}
