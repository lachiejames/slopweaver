/**
 * Whether the owner's pointer is over one of the voice's controls, which decides whether the overlay takes it (`main.ts`
 * `applyPointer`). Two answers, and either one takes it:
 *
 * - **The page's own.** It hit-tests every forwarded move (`preload.ts` `reportPointer`) and says when that changes.
 * - **Main's own watch.** The page's answer needs the voice's renderer to hear the move, test it and send it before
 *   the window stops passing clicks through, and mid-call that renderer can be busy for longer than the owner's hand takes to
 *   reach the orb and press: the press went through to the wallpaper and macOS revealed the desktop. So the cursor is also read here on a short timer and tested against where the page last said its
 *   controls are (`preload.ts` `reportControls`; `overlayWindow.ts` `overlayControlBounds`, `pointOnControl`), which
 *   never waits on the renderer. The watch also overrules a stale page: a page still saying "over" a few readings
 *   after the cursor is off every control it reported since is dropped and told to test again (`overlayWindow.ts`
 *   `pointerWatchStep`).
 */
import { type BrowserWindow, type IpcMainEvent, ipcMain, screen } from "electron";

import { type OverlayControlsReport, parseOverlayControls, parsePointerReport } from "./desktopBridgeGeometry";
import { overlayControlBounds, pointerWatchStep, pointOnControl } from "./overlayWindow";

/**
 * How often the cursor is read, milliseconds: one frame at 60 Hz, so a hand that reaches the orb and presses inside
 * a frame is the only one that can still beat it. Each read is one cursor query and a few box comparisons.
 */
const CONTROL_SAMPLE_MS = 16;

/** The overlay's page says the pointer is over one of its controls. */
let pageOver = false;
/** Main's own watch says the same. */
let watchOver = false;
/** Where the overlay's page last said its controls are; `undefined` until a page that reports them does. */
let controls: OverlayControlsReport | undefined;
/** Readings in a row with the page saying over and the watch saying off (`overlayWindow.ts` `pointerWatchStep`). */
let disagreeing = 0;
/** A controls report has arrived since the page's last answer, which `preload.ts` sends right behind each one. */
let pageMeasured = false;

/**
 * Whether the pointer is over one of the voice's controls, by either answer.
 *
 * @returns true when the page or main's watch says so
 */
export function pointerOverControl(): boolean {
  return pageOver || watchOver;
}

/**
 * Take the overlay page's two pointer messages, from the overlay only: over a control or not, and where its controls
 * are. Called once, from `main.ts`'s own message install.
 *
 * @param fromOverlay whether a message came from the overlay's window, on the console, from its top frame
 * @param apply take or release the pointer now, from {@link pointerOverControl}
 */
export function installPointerReports({
  apply,
  fromOverlay,
}: {
  apply: () => void;
  fromOverlay: (input: { event: IpcMainEvent }) => boolean;
}): void {
  ipcMain.on("slopweaver:overlay-pointer", (event, value: unknown) => {
    const over = parsePointerReport({ value });
    if (fromOverlay({ event }) && over !== undefined) {
      pageOver = over;
      disagreeing = 0;
      pageMeasured = false;
      apply();
    }
  });
  ipcMain.on("slopweaver:overlay-controls", (event, value: unknown) => {
    // A report refused as malformed clears the last one rather than leaving boxes the page no longer draws, and the
    // watch's answer with it: with nothing to judge against, a watch still saying "over" would never be corrected.
    if (fromOverlay({ event })) {
      controls = parseOverlayControls({ value });
      pageMeasured = controls !== undefined;
      if (controls === undefined && watchOver) {
        watchOver = false;
        apply();
      }
    }
  });
}

/** The overlay's page is gone: neither answer stands, and the next page reports its own controls. */
export function forgetPointer(): void {
  pageOver = false;
  watchOver = false;
  controls = undefined;
  disagreeing = 0;
  pageMeasured = false;
}

/**
 * Start main's watch on a freshly created overlay; it stops itself when that window closes. Called once per overlay,
 * from `main.ts`'s `createOverlay`.
 *
 * @param created the overlay window just made
 * @param watching whether the watch may take the pointer now: false while the window is hidden or replaced, and
 *   while the stage is up, which takes the pointer whole
 * @param apply take or release the pointer now, called each time the watch's answer changes
 */
export function installOverlayPointerWatch({
  apply,
  created,
  watching,
}: {
  apply: () => void;
  created: BrowserWindow;
  watching: () => boolean;
}): void {
  const timer = setInterval(() => {
    const report = controls;
    // A report this size cannot place (mid-resize) judges nothing; one placing no controls says "off every one".
    let next: boolean | undefined;
    if (report !== undefined && !created.isDestroyed() && watching()) {
      const boxes = overlayControlBounds({
        bounds: created.getBounds(),
        report,
        zoomFactor: created.webContents.getZoomFactor(),
      });
      if (boxes !== undefined) {
        next = pointOnControl({ boxes, point: screen.getCursorScreenPoint() });
      }
    }
    const step = pointerWatchStep({ disagreeing, next, pageMeasured, pageOver, watchOver });
    disagreeing = step.disagreeing;
    pageOver = step.pageOver;
    watchOver = step.watchOver;
    if (step.pageDropped) {
      created.webContents.send("slopweaver:overlay-pointer-dropped");
    }
    if (step.changed) {
      apply();
    }
  }, CONTROL_SAMPLE_MS);
  created.on("closed", () => {
    clearInterval(timer);
  });
}
