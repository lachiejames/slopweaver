/**
 * Where a region the voice names on the owner's screen lands inside its own window, to bring one section of the screen into focus
 * over a page in another app, and only when the owner asks.
 *
 * The voice points at a box in the still it last took (`nativeCaptureShell.ts`), sent as fractions of that picture.
 * The still is the WHOLE display, menu bar and Dock included, and so is the voice's window while it draws a focus
 * (`overlayWindow.ts`), so the box is placed on the display, clipped to what the window covers, then turned into the
 * page's CSS pixels — a box in the menu bar or the Dock is lifted like any other. Retina scale never enters: the still
 * and the display are the same shape at any scale. Pure.
 */
import type { FocusFractions } from "./desktopBridgeGeometry";
import type { Bounds } from "./persistedState";

/** The display a still was taken of, as main recorded it at the look. */
export interface LookedDisplay {
  readonly id: number;
  readonly bounds: Bounds;
}

/** Where to draw the lifted region, in CSS pixels of the voice's whole-display window. */
export interface FocusRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The shell's answer to the page: the rect to draw, or why there is none, in a line the voice can say. */
export type FocusRegionReply = { readonly rect: FocusRect } | { readonly why: string };

/** The fewest screen points a side may keep after the clip and still be worth drawing. */
export const MIN_DRAWN_POINTS = 8;

/**
 * The rect to lift, or why not: the display must be the one looked at, unchanged, and the primary one the voice's
 * window covers; a box the clip leaves as a sliver is refused rather than drawn as one.
 *
 * @param region the box as fractions of the still
 * @param looked the display the last still was taken of, `undefined` when there has been no look
 * @param now the display the voice's window is on at this moment
 * @param primaryId the primary display's id, whose bounds the window covers
 * @param area what the voice's window covers while it draws a focus — the primary display's bounds — in screen points
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the rect in window CSS pixels, or a refusal
 */
export function focusRectOf({
  region,
  looked,
  now,
  primaryId,
  area,
  zoomFactor,
}: {
  region: FocusFractions;
  looked: LookedDisplay | undefined;
  now: LookedDisplay;
  primaryId: number;
  area: Bounds;
  zoomFactor: number;
}): FocusRegionReply {
  if (looked === undefined) {
    return { why: "the voice has not looked at the owner's screen yet, so there is nothing to point at" };
  }
  if (looked.id !== now.id || !sameBounds({ a: looked.bounds, b: now.bounds })) {
    return { why: "the owner's screen changed since the voice looked; look again" };
  }
  if (now.id !== primaryId) {
    return { why: "the voice can only draw on the owner's main display, and it looked at another one" };
  }
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return { why: "the voice's window reports no zoom to draw at" };
  }
  const display = now.bounds;
  const x0 = display.x + region.left * display.width;
  const y0 = display.y + region.top * display.height;
  const x1 = x0 + region.width * display.width;
  const y1 = y0 + region.height * display.height;
  const left = Math.max(x0, area.x);
  const top = Math.max(y0, area.y);
  const right = Math.min(x1, area.x + area.width);
  const bottom = Math.min(y1, area.y + area.height);
  if (right - left < MIN_DRAWN_POINTS || bottom - top < MIN_DRAWN_POINTS) {
    return { why: "that box is too thin to draw round; say where in words" };
  }
  // Rounded outward to whole CSS pixels, so the lifted box never cuts into the thing it lifts.
  const cssLeft = Math.floor((left - area.x) / zoomFactor);
  const cssTop = Math.floor((top - area.y) / zoomFactor);
  const cssRight = Math.ceil((right - area.x) / zoomFactor);
  const cssBottom = Math.ceil((bottom - area.y) / zoomFactor);
  return { rect: { height: cssBottom - cssTop, left: cssLeft, top: cssTop, width: cssRight - cssLeft } };
}

/**
 * Whether two bounds are the same rectangle.
 *
 * @returns true when every edge matches
 */
function sameBounds({ a, b }: { a: Bounds; b: Bounds }): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
