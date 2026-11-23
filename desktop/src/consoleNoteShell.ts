/**
 * The console's floating note, applied to Electron: one script-free panel in the top-right corner, under the
 * fleet's note while that one is up, raised while a failed recovery stands and taken down the moment the console
 * serves again. The decisions are `consoleNote.ts`; `main.ts` owns the failure and the recovery.
 */
import { app, BrowserWindow, screen } from "electron";

import type { BuildIdentity } from "./buildIdentity";
import {
  CONSOLE_NOTE_HEIGHT,
  CONSOLE_NOTE_WIDTH,
  consoleNoteLinkOf,
  consoleNotePosition,
  consoleNoteUrl,
  consoleNoteView,
} from "./consoleNote";
import type { CheckoutError, ConsoleError } from "./errors";
import { fleetNoteBounds } from "./fleetWindows";

/** The failure standing now, and which one it is. */
export interface StandingFailure {
  readonly failure: ConsoleError | CheckoutError;
  readonly serial: number;
}

/** What the note reads from, and asks of, the rest of the shell. */
export interface ConsoleNoteHost {
  /** The failure standing now, or `undefined` while the console serves or is coming up. */
  readonly standing: () => StandingFailure | undefined;
  /** Which Slopweaver this is. */
  readonly identity: () => BuildIdentity;
  /** A window's title, naming the build. */
  readonly titleFor: (options: { readonly page: string }) => string;
  /** Bring the console back once more — the owner's Retry. */
  readonly retry: () => void;
  /** Open the folder picker for a clone to serve the console from. */
  readonly chooseCheckout: () => void;
}

/** What the window shows as its title, before the build's name is added. */
const NOTE_TITLE = "Slopweaver needs you";

let host: ConsoleNoteHost | undefined;
let note: BrowserWindow | undefined;
let loaded: string | undefined;
/** The failure the owner closed the note on, by "Not now" or its own close button; the next failure raises it again. */
let dismissedSerial: number | undefined;
/** The shell itself is closing the note, so the close is not the owner's "Not now". */
let closingItself = false;

/**
 * Hand the note what it reads from. Called once, before the first draw.
 *
 * @param noteHost the rest of the shell
 */
export function startConsoleNote({ noteHost }: { noteHost: ConsoleNoteHost }): void {
  host = noteHost;
}

/**
 * Act on a link the note navigated to — only when it names the failure standing now, so a note drawn for an older
 * failure presses nothing.
 *
 * @param url where the note tried to go
 */
function actOnLink({ url }: { url: string }): void {
  const link = consoleNoteLinkOf({ url });
  const standing = host?.standing();
  if (host === undefined || link === undefined || standing === undefined || link.serial !== standing.serial) {
    return;
  }
  if (link.kind === "retry") {
    host.retry();
  } else if (link.kind === "choose-checkout") {
    host.chooseCheckout();
  } else if (link.kind === "dismiss") {
    dismissedSerial = link.serial;
    drawConsoleNote();
  } else if (host.identity().dev) {
    app.quit();
  }
}

/**
 * The note's window, made hidden and shown once its page has drawn.
 *
 * @param position where it goes
 * @param title its title, naming the build
 * @returns the window
 */
function createNote({ position, title }: { position: { x: number; y: number }; title: string }): BrowserWindow {
  const created = new BrowserWindow({
    ...position,
    alwaysOnTop: true,
    backgroundColor: "#0f1115",
    fullscreenable: false,
    height: CONSOLE_NOTE_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title,
    type: "panel",
    useContentSize: true,
    webPreferences: { contextIsolation: true, javascript: false, nodeIntegration: false, sandbox: true },
    width: CONSOLE_NOTE_WIDTH,
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
    actOnLink({ url });
  });
  created.once("ready-to-show", () => {
    created.showInactive();
  });
  created.on("closed", () => {
    // The owner's own close button is "Not now" for the failure standing: without this the next redraw — the fleet's poll
    // every half minute — would raise it straight back.
    if (note !== created) {
      return;
    }
    const standing = host?.standing();
    if (!closingItself && standing !== undefined) {
      dismissedSerial = standing.serial;
    }
    closingItself = false;
    note = undefined;
    loaded = undefined;
  });
  return created;
}

/** Raise, move or take down the note from the failure standing now. */
export function drawConsoleNote(): void {
  const standing = host?.standing();
  if (host === undefined || standing === undefined || dismissedSerial === standing.serial) {
    if (note !== undefined) {
      closingItself = true;
      note.close();
    }
    return;
  }
  const position = consoleNotePosition({ above: fleetNoteBounds(), workArea: screen.getPrimaryDisplay().workArea });
  const title = host.titleFor({ page: NOTE_TITLE });
  if (note === undefined || note.isDestroyed()) {
    closingItself = false;
    loaded = undefined;
    note = createNote({ position, title });
  } else {
    note.setPosition(position.x, position.y);
  }
  const url = consoleNoteUrl({
    title: NOTE_TITLE,
    view: consoleNoteView({ failure: standing.failure, identity: host.identity(), serial: standing.serial }),
  });
  if (url !== loaded) {
    loaded = url;
    void note.loadURL(url);
  }
}
