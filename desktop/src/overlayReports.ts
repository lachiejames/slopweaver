/**
 * What the voice's page last said about the room it needs: how tall (`OverlayExtent`) and how wide
 * (`OverlayWidthReport`) its corner must be, where the owner dragged its orb (`OverlayPlaceReport`), and whether an
 * edge or the orb is being dragged right now. Held here rather than in `main.ts`, which reads them for every fit and
 * every pointer decision; each report is parsed strictly and taken only from the overlay's own renderer.
 */
import { type IpcMainEvent, ipcMain } from "electron";

import {
  type OverlayExtent,
  type OverlayPlaceReport,
  type OverlayWidthReport,
  parseOverlayExtent,
  parseOverlayPlaceReport,
  parseOverlayWidthReport,
} from "./desktopBridge";
import type { HeldOverlayReports } from "./overlayPlace";

/** How much of the work area the overlay's page last said it needs; `undefined` until a page that reports one does. */
let extent: OverlayExtent | undefined;

/** How wide the page last said its corner must be; `undefined` from a page that never says, which keeps the default. */
let width: OverlayWidthReport | undefined;

/** Where the page last said its orb is; `undefined` from a page that never says, which keeps the corner. */
let place: OverlayPlaceReport | undefined;

/**
 * What the overlay's page last reported.
 *
 * @returns the extent, the width and the place, each `undefined` until its page reports it
 */
export function overlayReports(): HeldOverlayReports {
  return { extent, place, width };
}

/**
 * The overlay's page is gone: the next page may predate any report, and one that never sends the extent sits over
 * the whole work area, so none of the last page's reports stands.
 */
export function forgetOverlayReports(): void {
  extent = undefined;
  width = undefined;
  place = undefined;
}

/**
 * Take the overlay page's extent, width and place reports, refitting the window on each and re-deciding the pointer on
 * a width or place report, each of which carries whether a drag holds it.
 *
 * @param fit refits the overlay to what was reported
 * @param applyPointer decides again whether the window takes the pointer
 * @param fromOverlay whether a message came from the overlay's own renderer
 */
export function installOverlayReports({
  fit,
  applyPointer,
  fromOverlay,
}: {
  fit: () => void;
  applyPointer: () => void;
  fromOverlay: (input: { event: IpcMainEvent }) => boolean;
}): void {
  ipcMain.on("slopweaver:overlay-extent", (event, value: unknown) => {
    const reported = parseOverlayExtent({ value });
    if (fromOverlay({ event }) && reported !== undefined) {
      extent = reported;
      fit();
    }
  });
  ipcMain.on("slopweaver:overlay-width", (event, value: unknown) => {
    const reported = parseOverlayWidthReport({ value });
    if (fromOverlay({ event }) && reported !== undefined) {
      width = reported;
      // The pointer first, so a drag beginning holds it before the window grows under the cursor.
      applyPointer();
      fit();
    }
  });
  // A place report the shell cannot read drops the place rather than keeping the last one: the window goes back to
  // the corner holding nothing, so a drag can never stay held on a report that ended it but did not parse (Codex
  // r3-place-6). The page's next report puts the orb back where it was.
  ipcMain.on("slopweaver:overlay-place", (event, value: unknown) => {
    if (!fromOverlay({ event })) {
      return;
    }
    place = parseOverlayPlaceReport({ value });
    applyPointer();
    fit();
  });
}
