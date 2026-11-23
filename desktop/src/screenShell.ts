/**
 * The voice's messages about the owner's screen: look at it (`slopweaver:capture-screen`, one still) and
 * lift one region of what it looked at (`slopweaver:focus-region`). Together because the second
 * points into the first: main remembers which display the last still was of, and a region is only ever placed on that
 * display, unchanged since. Both are the voice window's alone and both need a call up (`noCallRefusal`), as does which
 * window is in front (`slopweaver:front-window`, names only, for the drift watch). A look also goes
 * on a typed ask with the messenger open (`lookRefusal`), and the messenger band reads what is in
 * front on a channel of its own (`frontAppBandShell.ts`). Beside them, where the owner's pointer sits in the voice's window
 * after a fit moved it (`slopweaver:overlay-cursor`), call or none.
 */
import { type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, screen } from "electron";

import { parseFocusRegion } from "./desktopBridgeGeometry";
import { installFrontAppBand } from "./frontAppBandShell";
import type { FrontWindowReply } from "./frontWindow";
import { readFrontWindow } from "./frontWindowShell";
import { captureAskOf, type NativeCaptureReply, noCallRefusal } from "./nativeCapture";
import { captureScreenNatively } from "./nativeCaptureShell";
import { pointerInOverlay } from "./overlayWindow";
import { type FocusRegionReply, focusRectOf, type LookedDisplay } from "./screenFocus";
import type { ShellEvent, ShellState } from "./shellState";

/**
 * Install both handlers. Called once, from `main.ts`'s own message install.
 *
 * @param voiceNow the voice's window as it is now, `undefined` while there is none
 * @param isVoiceSender whether a message came from the voice's window, on the console, from its top frame
 * @param shellNow the shell's state at the moment of asking
 * @param overlayMicTracks the live microphone tracks the voice's own window reports
 * @param report a shell event to apply
 */
export function installScreenHandlers({
  voiceNow,
  isVoiceSender,
  shellNow,
  overlayMicTracks,
  report,
}: {
  voiceNow: () => BrowserWindow | undefined;
  isVoiceSender: (input: { event: IpcMainEvent | IpcMainInvokeEvent }) => boolean;
  shellNow: () => ShellState;
  overlayMicTracks: () => number;
  report: (event: ShellEvent) => void;
}): void {
  let lastLook: LookedDisplay | undefined;
  const { messenger } = installFrontAppBand({
    callUp: () =>
      noCallRefusal({
        overlayAudioTracks: overlayMicTracks(),
        overlayCallActive: shellNow().overlay?.callActive === true,
      }) === undefined,
    isVoiceSender,
    voiceNow,
  });
  // The voice sees the owner's screen natively: one still of the display it is on, taken here on its ask, so no screen share
  // is ever asked of the owner (`nativeCapture.ts`, `nativeCaptureShell.ts`).
  ipcMain.handle("slopweaver:capture-screen", async (event, value: unknown): Promise<NativeCaptureReply> => {
    const voice = voiceNow();
    if (!isVoiceSender({ event }) || voice === undefined) {
      throw new Error("only the voice's window may look at the owner's screen");
    }
    const ask = captureAskOf({ value });
    if (ask === undefined) {
      return { why: "a look carries nothing, or exactly that a typed message asked for it" };
    }
    return captureScreenNatively({
      looked: ({ display }) => {
        lastLook = display;
      },
      messenger,
      overlayMicTracks,
      report,
      shellNow,
      typedAsk: ask.typedAsk,
      window: voice,
    });
  });
  // On the owner's ask, the voice lifts one region of the still it last took and the page dims the rest (`screenFocus.ts`).
  ipcMain.handle("slopweaver:focus-region", (event, value: unknown): FocusRegionReply => {
    const voice = voiceNow();
    if (!isVoiceSender({ event }) || voice === undefined) {
      throw new Error("only the voice's window may lift a region of the owner's screen");
    }
    const noCall = noCallRefusal({
      overlayAudioTracks: overlayMicTracks(),
      overlayCallActive: shellNow().overlay?.callActive === true,
    });
    if (noCall !== undefined) {
      return { why: noCall };
    }
    const region = parseFocusRegion({ value });
    if (region === undefined) {
      return { why: "the region is not four fractions of the picture boxing something inside it" };
    }
    const display = screen.getDisplayMatching(voice.getBounds());
    const primary = screen.getPrimaryDisplay();
    return focusRectOf({
      area: primary.bounds,
      looked: lastLook,
      now: { bounds: display.bounds, id: display.id },
      primaryId: primary.id,
      region,
      zoomFactor: voice.webContents.getZoomFactor(),
    });
  });
  // Which application is in front and its window's title, read for the drift watch while the owner holds a stated plan on a
  // call (`frontWindow.ts`). Names only, never a frame, and the same two gates as a look.
  ipcMain.handle("slopweaver:front-window", async (event): Promise<FrontWindowReply> => {
    if (!isVoiceSender({ event }) || voiceNow() === undefined) {
      throw new Error("only the voice's window may read which window is in front");
    }
    const callRefusal = (): string | undefined =>
      noCallRefusal({
        overlayAudioTracks: overlayMicTracks(),
        overlayCallActive: shellNow().overlay?.callActive === true,
      });
    const noCall = callRefusal();
    if (noCall !== undefined) {
      return { why: noCall };
    }
    const reply = await readFrontWindow();
    // The read takes up to its 3 s timeout, and the owner may hang up inside it: a call that ended meanwhile gets no sample.
    const endedDuring = callRefusal();
    if (endedDuring !== undefined) {
      return { why: endedDuring };
    }
    return reply;
  });
  // A fit resized the voice's window under a pointer that has not moved, and the page asks where it is now, so a
  // second press on the orb meets the orb rather than the wallpaper beneath a window passing it through
  // (`pointerInOverlay`). Nothing while the window is hidden, so a pointer a hide released is taken again once main
  // says the window is revealed (`slopweaver:overlay-revealed`) and the page asks again.
  ipcMain.handle("slopweaver:overlay-cursor", (event): { x: number; y: number } | null => {
    const voice = voiceNow();
    if (!isVoiceSender({ event }) || voice === undefined || voice.isDestroyed() || !voice.isVisible()) {
      return null;
    }
    const at = pointerInOverlay({
      bounds: voice.getBounds(),
      cursor: screen.getCursorScreenPoint(),
      zoomFactor: voice.webContents.getZoomFactor(),
    });
    if (at === undefined) {
      return null;
    }
    return { x: at.x, y: at.y };
  });
}
