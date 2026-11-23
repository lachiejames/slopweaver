/**
 * Where the voice's window goes once the owner has dragged its orb somewhere, and everything one fit of it decides
 * (the orb can be dragged around, and nothing is ever off screen). The page owns the place and the box it draws there (`site/lib/messengerPlace.ts`); the
 * shell owns the work area, the bounds and the pointer:
 *
 * - **At rest the window is cropped round the widget**, wherever on the work area the orb is, and never wider than the
 *   work area bar {@link MANIPULATION_STRIP}: a window over the whole work area is the one ⌘⇧5's picker finds above the
 *   owner's app (`overlayWindow.ts`). Clamped to the work area, so nothing it holds is ever off screen.
 * - **While anything drags** — the orb, or an edge of the card beside an orb that has been moved — the window takes
 *   the whole work area bar that strip, so the drag reaches anywhere and the window resizes once as it begins and once
 *   as it ends. It reaches the work area's bottom rather than the floor line the corner rests on, which with the Dock
 *   at the side sits above it.
 * - **The orb where it has always rested** is no place at all: the corner fits exactly as it did before
 *   (`overlayPlacement`), and so does every fit under a page that never reports a place.
 *
 * The page draws the orb at its place in whichever window holds it, by the shell's origin word ({@link overlayOrigin})
 * sent beside every fit: where the work area's right and bottom edges sit in from the window's own.
 *
 * Pure.
 */
import type {
  OverlayArea,
  OverlayExtent,
  OverlayHome,
  OverlayInset,
  OverlayOrigin,
  OverlayPlaceReport,
  OverlayWidthReport,
} from "./desktopBridge";
import {
  MANIPULATION_STRIP,
  ORB_CENTRE_LIFT,
  type OverlayPlacement,
  overlayAreaWord,
  overlayFloor,
  overlayFloorLine,
  overlayInset,
  overlayPlacement,
} from "./overlayWindow";
import type { Bounds } from "./persistedState";

/**
 * What the voice's page last reported, as `overlayReports.ts` holds it. Spelled here rather than read off that module,
 * which imports Electron, so the pure placement stays loadable wherever its tests run.
 */
export interface HeldOverlayReports {
  readonly extent: OverlayExtent | undefined;
  readonly width: OverlayWidthReport | undefined;
  readonly place: OverlayPlaceReport | undefined;
}

/**
 * The window's bounds for an orb the owner has dragged: cropped round the widget's frame at rest, the orb's centre on
 * its place, or the work area bar the strip while anything drags. Never wider than that, and clamped inside the work
 * area and down to the floor line, so a frame reported for a larger display still lands wholly on this one.
 *
 * @param workArea the primary display's work area, in screen points
 * @param floorLine the screen line the corner rests the widget's floor on (`overlayFloorLine`): below the work area
 *   with a Dock along the bottom, and the window reaches down to it so the orb can go back to where it rested
 * @param anchor the orb's centre, CSS pixels from the work area's right and bottom edges
 * @param frame the widget's box with its slack and the orb's centre inside it, CSS pixels
 * @param manipulating the orb, or an edge of the card, is being dragged
 * @param zoomFactor the page's zoom, which turns its CSS pixels into screen points
 * @returns the bounds, whole screen points
 */
export function placedOverlayBounds({
  workArea,
  floorLine,
  anchor,
  frame,
  manipulating,
  zoomFactor,
}: {
  workArea: Bounds;
  floorLine: number;
  anchor: NonNullable<OverlayPlaceReport["anchor"]>;
  frame: OverlayPlaceReport["frame"];
  manipulating: boolean;
  zoomFactor: number;
}): Bounds {
  const right = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  // Down to the floor line where the corner rests the orb level with a Dock below the work area, so a dragged orb can
  // always come back to where it rested; stopping at the work area left a dragged-up orb unable to go back down.
  const bottom = Math.max(workBottom, floorLine);
  const tall = bottom - workArea.y;
  const across = Math.max(1, workArea.width - MANIPULATION_STRIP);
  if (manipulating) {
    return { height: tall, width: across, x: right - across, y: workArea.y };
  }
  const width = Math.min(across, Math.ceil(frame.width * zoomFactor));
  const height = Math.min(tall, Math.ceil(frame.height * zoomFactor));
  const clamp = ({ value, low, high }: { value: number; low: number; high: number }): number =>
    Math.min(high, Math.max(low, value));
  return {
    height,
    width,
    x: clamp({
      high: right - width,
      low: workArea.x,
      value: Math.round(right - (anchor.right + frame.orbX) * zoomFactor),
    }),
    y: clamp({
      high: bottom - height,
      low: workArea.y,
      value: Math.round(workBottom - (anchor.bottom + frame.orbY) * zoomFactor),
    }),
  };
}

/**
 * Where the work area's right and bottom edges sit in from the window's own, CSS pixels: positive where the window
 * runs past the work area, negative where it is cropped inside it. The page adds it to a place to draw the orb there.
 *
 * @param placement where the fit put the window
 * @param workArea the primary display's work area, in screen points
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the origin, CSS pixels
 */
export function overlayOrigin({
  placement,
  workArea,
  zoomFactor,
}: {
  placement: OverlayPlacement;
  workArea: Bounds;
  zoomFactor: number;
}): OverlayOrigin {
  const { bounds } = placement;
  return {
    bottom: (bounds.y + bounds.height - (workArea.y + workArea.height)) / zoomFactor,
    right: (bounds.x + bounds.width - (workArea.x + workArea.width)) / zoomFactor,
  };
}

/**
 * Where the orb rests when it has no place of its own, as a place: its centre's height above the work area's bottom
 * edge, CSS pixels, negative where the corner rests it level with a Dock below the work area. Sent beside every fit, so
 * a drag can bring the orb back down to it and the page can tell a drag that ended there from any other place.
 *
 * @param floorLine the screen line the corner rests the widget's floor on (`overlayFloorLine`)
 * @param workArea the primary display's work area, in screen points
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the home word
 */
export function overlayHome({
  floorLine,
  workArea,
  zoomFactor,
}: {
  floorLine: number;
  workArea: Bounds;
  zoomFactor: number;
}): OverlayHome {
  return { bottom: ORB_CENTRE_LIFT - (floorLine - (workArea.y + workArea.height)) / zoomFactor };
}

/**
 * Whether anything the page draws is being dragged: an edge of the card (the width report) or the orb (the place
 * report). Either holds the pointer from its press to its release (`overlayCapturesPointer`).
 *
 * @param reports what the page last reported
 * @returns true while either drags
 */
export function overlayManipulating({ reports }: { reports: HeldOverlayReports }): boolean {
  return reports.width?.manipulating === true || reports.place?.manipulating === true;
}

/** One fit of the voice's window: where it goes, and the words its page hears beside it. */
export interface OverlayFit {
  readonly placement: OverlayPlacement;
  readonly area: OverlayArea;
  readonly inset: OverlayInset;
  readonly floor: number;
  readonly origin: OverlayOrigin;
  readonly home: OverlayHome;
}

/**
 * One fit, from the display and what the page last reported: the whole display while anything it draws spans it, the
 * window round a dragged orb's place ({@link placedOverlayBounds}), or the corner it has always had.
 *
 * @param display the primary display's bounds and work area, in screen points
 * @param reports what the page last reported
 * @param hearsFloor the overlay's page subscribed to the floor word since it last loaded
 * @param expanded the stage is up
 * @param zoomFactor the page's zoom, which turns its CSS pixels into screen points
 * @returns the placement and the inset, floor, origin and area words
 */
export function overlayFitGeometry({
  display,
  reports,
  hearsFloor,
  expanded,
  zoomFactor,
}: {
  display: { readonly bounds: Bounds; readonly workArea: Bounds };
  reports: HeldOverlayReports;
  hearsFloor: boolean;
  expanded: boolean;
  zoomFactor: number;
}): OverlayFit {
  const { workArea } = display;
  const { extent, place, width } = reports;
  const floorLine = overlayFloorLine({ display: display.bounds, hearsFloor, workArea, zoomFactor });
  const manipulating = overlayManipulating({ reports });
  const whole = extent === undefined || extent.wholeArea || expanded;
  let placement: OverlayPlacement;
  if (!whole && place?.anchor != null) {
    const bounds = placedOverlayBounds({
      anchor: place.anchor,
      floorLine,
      frame: place.frame,
      manipulating,
      workArea,
      zoomFactor,
    });
    placement = { bounds, whole: false };
  } else {
    placement = overlayPlacement({
      cornerWidthCss: width?.width,
      display: display.bounds,
      extent,
      floorLine,
      manipulating,
      wholeArea: expanded,
      workArea,
      zoomFactor,
    });
  }
  return {
    area: overlayAreaWord({ extent, placement }),
    floor: overlayFloor({ floorLine, placement, zoomFactor }),
    home: overlayHome({ floorLine, workArea, zoomFactor }),
    inset: overlayInset({ placement, workArea, zoomFactor }),
    origin: overlayOrigin({ placement, workArea, zoomFactor }),
    placement,
  };
}
