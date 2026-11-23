/**
 * The overlay losing focus: once focus has settled, a move into another app folds the page to the orb (transiently,
 * the owner's stored state untouched) so nothing stays over what the owner activated — the stage always, the messenger only with no
 * call up — while a move into one of Slopweaver's own windows sends nothing. Which it is, is `overlayWindow.ts`'s
 * `overlayCommandOnBlur`; this is the thin effectful half that waits for focus to land and sends the command.
 *
 * `BaseWindow.getFocusedWindow`, never `BrowserWindow`'s: the console is a `BaseWindow`, which
 * `BrowserWindow.getFocusedWindow` never returns. Liveness is read at the settled moment, so a window torn down
 * meanwhile is sent nothing.
 */
import { BaseWindow, type BrowserWindow } from "electron";

import type { OverlayStatus } from "./desktopBridge";
import { overlayCommandOnBlur } from "./overlayWindow";

/**
 * How long after the overlay's blur its destination is read. On macOS the window taking focus gets it AFTER the
 * overlay's blur fires, so a read inside the blur sees no focused window even when the owner clicked the console; a timer
 * rather than `setImmediate` lets that focus land across native event-loop turns, and is short enough that a fold
 * into another app still reads as immediate.
 */
const BLUR_SETTLE_MS = 100;

/**
 * Install the blur handler on a freshly created overlay. Called once per overlay, from `main.ts`'s `createOverlay`.
 *
 * @param created the overlay window just made
 * @param state the shell's own reads at the settled moment: whether the page listens, whether `created` is still the
 *   overlay, and the voice's last reported status (its view, and whether a call is up)
 */
export function installOverlayBlur({
  created,
  state,
}: {
  created: BrowserWindow;
  state: () => { listening: boolean; current: boolean; status: OverlayStatus | undefined };
}): void {
  const contents = created.webContents;
  let blurSettle: ReturnType<typeof setTimeout> | undefined;
  created.on("blur", () => {
    clearTimeout(blurSettle);
    blurSettle = setTimeout(() => {
      blurSettle = undefined;
      const { current, listening, status } = state();
      const command = overlayCommandOnBlur({
        callActive: status?.callActive === true,
        focusOwned: BaseWindow.getFocusedWindow() !== null,
        listening,
        live: current && !contents.isDestroyed(),
        mode: status?.mode,
      });
      if (command !== undefined) {
        contents.send("slopweaver:overlay-command", command);
      }
    }, BLUR_SETTLE_MS);
  });
}
