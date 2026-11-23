/**
 * Applying a fit to the voice's window without the orb ever showing where it is not. macOS shows a resized window's
 * last frame pinned to its top-left corner until the page draws again, and the floor word reaches the page just before
 * the resize, so a fit used to flash the orb for half a second a little higher in the corner, or somewhere else on the
 * owner's whole screen as the corner grew to the display. So the window goes see-through
 * for a move and comes back once the page has drawn at its new bounds (`overlayMoveHides` decides when).
 */
import type { BrowserWindow } from "electron";

import type { OverlayArea, OverlayHome, OverlayInset, OverlayOrigin } from "./desktopBridge";
import { MOVE_REVEAL_CEILING_MS, type OverlayPlacement, overlayMoveHides } from "./overlayWindow";

/** Resolves in the page once it has drawn a frame since it was asked: after the second animation frame from now. */
const NEXT_FRAME_DRAWN =
  "new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(() => drawn(true))))";

/** Counts the moves that hid the window, so only the newest one's frame shows it again. */
let moves = 0;

/**
 * Apply a fit: the inset, floor and origin words before the resize, so a measure taken between the two errs to a
 * corner too tall, never one that clips the orb; then the bounds; then the word that lets the page draw what needs the
 * whole display. See-through across all of it when the window moves while shown.
 *
 * @param target the overlay window
 * @param placement where the fit puts it
 * @param inset where the work area sits inside those bounds
 * @param floor where the widget's floor sits above the window's bottom edge, CSS pixels
 * @param origin where the work area's right and bottom edges sit in from the window's, for a dragged orb's place
 * @param home where the orb rests with no place of its own, the lowest a drag may bring it
 * @param area the word on whether the window is whole now
 */
export function applyOverlayFit({
  target,
  placement,
  inset,
  floor,
  origin,
  home,
  area,
}: {
  target: BrowserWindow;
  placement: OverlayPlacement;
  inset: OverlayInset;
  floor: number;
  origin: OverlayOrigin;
  home: OverlayHome;
  area: OverlayArea;
}): void {
  const contents = target.webContents;
  const live = !contents.isDestroyed();
  const hides = overlayMoveHides({
    after: placement.bounds,
    before: target.getBounds(),
    visible: target.isVisible(),
  });
  if (hides) {
    target.setOpacity(0);
  }
  if (live) {
    contents.send("slopweaver:overlay-inset", inset);
    contents.send("slopweaver:overlay-floor", floor);
    contents.send("slopweaver:overlay-origin", origin);
    contents.send("slopweaver:overlay-home", home);
  }
  target.setBounds(placement.bounds);
  if (live) {
    contents.send("slopweaver:overlay-area", area);
  }
  if (hides) {
    revealOnNextFrame({ target });
  }
}

/**
 * Show the window again once its page has drawn, or after {@link MOVE_REVEAL_CEILING_MS}, whichever is first — a page
 * reloading or gone never leaves the orb invisible. A newer move's reveal supersedes this one.
 *
 * @param target the overlay window just moved
 */
function revealOnNextFrame({ target }: { target: BrowserWindow }): void {
  moves += 1;
  const move = moves;
  const reveal = (): void => {
    if (move === moves && !target.isDestroyed()) {
      target.setOpacity(1);
    }
  };
  const ceiling = new Promise<void>((done) => {
    setTimeout(done, MOVE_REVEAL_CEILING_MS);
  });
  void Promise.race([target.webContents.executeJavaScript(NEXT_FRAME_DRAWN), ceiling]).then(reveal, reveal);
}
