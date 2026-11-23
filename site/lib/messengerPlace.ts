/**
 * Where the presence orb rests, and which side of it the messenger opens on. The orb can be dragged anywhere, and the
 * messenger follows it, so neither the orb nor the widget ever sits off screen.
 *
 * Pure: the stored string, the drag's arithmetic, the bounds that keep the orb on the screen, the side the card opens
 * on and the room it has there, and the CSS that draws the widget at a place. A place is the orb's centre as its
 * distance from the work area's right and bottom edges, CSS pixels, so a place kept on a larger display stays the same
 * distance from the corner the orb has always sat in, clamped to the screen it is on now. The default place is no
 * place at all: the orb rests where it always has, level with a bottom Dock (`desktop/src/overlayWindow.ts`
 * `overlayFloorLine`), drawn by the widget's own CSS rather than by this module. The shell says where that is
 * (`OverlayHome`), so a drag can bring the orb back down to it, and a drag that ends exactly there is kept as the
 * default again.
 */
import {
  CORNER_CLEARANCE_PX,
  type MessengerResizeEdge,
  type MessengerSize,
  MIN_MESSENGER_SIZE,
  UNCOVERED_STRIP_PX,
} from "./messengerSize";

/** The orb's centre, as its distance from the work area's right and bottom edges, CSS pixels. */
export interface MessengerAnchor {
  readonly right: number;
  readonly bottom: number;
}

/** What is stored: the place it has always rested, or one the owner dragged it to, as `at:<right>:<bottom>`. */
export type MessengerPlaceStorage = "default" | `at:${string}`;

/** Which side of the orb the card opens on: the half of the screen with more room, across and up. */
export interface MessengerPanelSide {
  /** `left`: the card's right edge on the orb's, reaching left; `right`: its left edge on the orb's, reaching right. */
  readonly horizontal: "left" | "right";
  readonly vertical: "above" | "below";
}

/**
 * Where the orb rests with no place of its own, by the shell's word: its centre's height above the work area's bottom
 * edge, CSS pixels, negative where the corner rests it level with a Dock below the work area.
 */
export interface OverlayHome {
  readonly bottom: number;
}

/** Where the shell's word says the work area's right and bottom edges sit in from the window's own, CSS pixels. */
export interface OverlayOrigin {
  readonly right: number;
  readonly bottom: number;
}

/** The widget's box and the orb's centre inside it, CSS pixels: what the shell crops its window around at rest. */
export interface MessengerFrame {
  readonly width: number;
  readonly height: number;
  readonly orbX: number;
  readonly orbY: number;
}

/** A box on the page, client CSS pixels, as `getBoundingClientRect` reports one. */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The `localStorage` key the place is kept under, for this console's origin. */
export const MESSENGER_PLACE_KEY = "slopweaver.messenger-place";

/** The side the card has always opened on: above the orb, reaching left from its right edge. */
export const DEFAULT_PANEL_SIDE: MessengerPanelSide = { horizontal: "left", vertical: "above" };

/** Half the orb's `size-14`, rem (`site/components/voice/VoiceWidget.tsx`'s orb). */
const ORB_HALF_REM = 1.75;

/** What the widget keeps between itself and the work area's edge, rem: its `1.25rem` margin. */
const MARGIN_REM = 1.25;

/** The widget's `gap-2` between the card and the orb, rem. */
const GAP_REM = 0.5;

/**
 * What the shell's window keeps round the widget's box at rest, CSS pixels, for the shadows, the badge and the X that
 * hang outside it: `desktop/src/overlayWindow.ts` `CORNER_SLACK`, restated because neither tree imports the other.
 */
export const FRAME_SLACK_PX = 24;

/** How far a press moves before it is a drag of the orb rather than a press on it, CSS pixels. */
const DRAG_THRESHOLD_PX = 4;

/** The largest a stored distance may be, CSS pixels — no screen is wider, and a bigger number is a corrupt one. */
const STORED_CEILING_PX = 16_384;

/**
 * A stored place: two whole numbers of CSS pixels, the bottom one of either sign — below the work area's bottom edge is
 * where the orb rests level with a Dock along the bottom, and a drag may bring it back down there.
 */
const STORED_PLACE = /^at:(\d{1,5}):(-?\d{1,5})$/u;

/**
 * Whether a stored value is a place, read strictly: the default, or two whole distances inside the bounds.
 *
 * @param value what `localStorage` held
 * @returns whether it is one
 */
export function isMessengerPlaceStorage(value: unknown): value is MessengerPlaceStorage {
  if (value === "default") {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const match = STORED_PLACE.exec(value);
  if (match === null) {
    return false;
  }
  return Number(match[1]) <= STORED_CEILING_PX && Math.abs(Number(match[2])) <= STORED_CEILING_PX;
}

/**
 * The place a stored value names.
 *
 * @param stored a value {@link isMessengerPlaceStorage} accepted
 * @returns the orb's centre, or `undefined` for the default place
 */
export function messengerAnchorOf({ stored }: { stored: MessengerPlaceStorage }): MessengerAnchor | undefined {
  if (stored === "default") {
    return undefined;
  }
  const [, right, bottom] = stored.split(":");
  return { bottom: Number(bottom), right: Number(right) };
}

/**
 * The stored value for a place, each distance kept to a whole CSS pixel.
 *
 * @param anchor the orb's centre
 * @returns what to store
 */
export function messengerPlaceStorageOf({ anchor }: { anchor: MessengerAnchor }): MessengerPlaceStorage {
  const whole = ({ value, low }: { value: number; low: number }): string =>
    String(Math.min(STORED_CEILING_PX, Math.max(low, Math.round(value))));
  return `at:${whole({ low: 0, value: anchor.right })}:${whole({ low: -STORED_CEILING_PX, value: anchor.bottom })}`;
}

/**
 * A place kept wholly on the screen: the orb and the widget's margin round it inside the work area, and clear of the
 * strip along its left edge the shell's window leaves uncovered while anything drags ({@link UNCOVERED_STRIP_PX}).
 *
 * @param anchor the orb's centre, as asked for
 * @param room the work area, CSS pixels
 * @param rootFontPx one rem, CSS pixels
 * @param home where the orb rests with no place of its own, by the shell's word (`overlayHome`): the orb may come down
 *   as low as that, level with a Dock below the work area; `undefined` under a shell that does not say
 * @returns the nearest place on the screen; a screen too small for the orb gets the corner's
 */
export function clampMessengerAnchor({
  anchor,
  room,
  rootFontPx,
  home,
}: {
  anchor: MessengerAnchor;
  room: { readonly width: number; readonly height: number };
  rootFontPx: number;
  home?: OverlayHome | undefined;
}): MessengerAnchor {
  const low = orbMarginPx({ rootFontPx });
  // Never past the ceiling the place is kept and sent at, so the shell never refuses the report a drag ends on, on a
  // work area wider than any display today.
  const clamp = ({ value, floor, high }: { value: number; floor: number; high: number }): number =>
    Math.min(STORED_CEILING_PX, Math.max(floor, Math.min(Math.max(floor, high), value)));
  // Every edge is a whole pixel, so a drag stopped against one is kept exactly where it was shown, never rounded by the
  // stored place into a nudge on release (a 16.2px rem's 48.6px margin). The one exception is home itself, which may
  // be fractional: it is reached only in the corner, where a drag ending there is kept as the default rather than
  // rounded (anywhere else along that line it would round on release). Home's right is the default's own margin,
  // unrounded, so letting go there draws the default exactly where the drag showed it (a 16.1px rem's corner is 48.3px
  // in, the whole-pixel edge 49).
  const right = clamp({ floor: low, high: Math.floor(room.width - low - UNCOVERED_STRIP_PX), value: anchor.right });
  let lowest = low;
  if (home !== undefined) {
    lowest = Math.min(low, Math.ceil(home.bottom));
    if (right === low) {
      lowest = Math.min(low, home.bottom);
    }
  }
  const bottom = clamp({ floor: lowest, high: Math.floor(room.height - low), value: anchor.bottom });
  if (home !== undefined && right === low && bottom === home.bottom) {
    return { bottom, right: homeMarginPx({ rootFontPx }) };
  }
  return { bottom, right };
}

/**
 * How far in from the work area's right edge the default draws the orb's centre: its half and its margin, exactly.
 *
 * @param rootFontPx one rem, CSS pixels
 * @returns the margin, CSS pixels, fractional under a rem that is not a whole number of pixels
 */
function homeMarginPx({ rootFontPx }: { rootFontPx: number }): number {
  return (ORB_HALF_REM + MARGIN_REM) * rootFontPx;
}

/**
 * The orb's half and its margin from the work area's edge, rounded up to a whole pixel: the nearest any place keeps the
 * orb's centre to an edge.
 *
 * @param rootFontPx one rem, CSS pixels
 * @returns the margin, whole CSS pixels
 */
function orbMarginPx({ rootFontPx }: { rootFontPx: number }): number {
  return Math.ceil((ORB_HALF_REM + MARGIN_REM) * rootFontPx);
}

/**
 * Whether a drag ended exactly where the orb rests with no place of its own: in the corner, against the work area's
 * right margin and down on the home line, which is where a drag pressed into the corner stops. Kept as the default
 * rather than as a place, so the corner fits exactly as it always has. A drag pressed into the corner stops at the
 * default's own margin, fractional or not ({@link clampMessengerAnchor}), so letting go there moves the orb by none.
 *
 * @param anchor where the drag ended
 * @param home where the orb rests with no place of its own, by the shell's word
 * @param rootFontPx one rem, CSS pixels
 * @returns true when it is home
 */
export function isMessengerHome({
  anchor,
  home,
  rootFontPx,
}: {
  anchor: MessengerAnchor;
  home: OverlayHome;
  rootFontPx: number;
}): boolean {
  return anchor.right === homeMarginPx({ rootFontPx }) && anchor.bottom === home.bottom;
}

/**
 * The side of the orb the card opens on: towards the middle of the screen, so a card beside an orb dragged to the top
 * left opens below it and to its right. An orb on the middle line keeps the side it has always opened on.
 *
 * @param anchor the orb's centre
 * @param room the work area, CSS pixels
 * @returns the side
 */
export function messengerPanelSide({
  anchor,
  room,
}: {
  anchor: MessengerAnchor;
  room: { readonly width: number; readonly height: number };
}): MessengerPanelSide {
  let horizontal: MessengerPanelSide["horizontal"] = "left";
  if (anchor.right > room.width / 2) {
    horizontal = "right";
  }
  let vertical: MessengerPanelSide["vertical"] = "above";
  if (anchor.bottom > room.height / 2) {
    vertical = "below";
  }
  return { horizontal, vertical };
}

/**
 * The largest the card may be on its side of the orb, so all of it stays on the screen: across, from the orb's far edge
 * to the work area's margin (clear of the left strip), and never so wide the window would span the screen; up or down,
 * from the gap beside the orb to the margin. Never under the smallest size, which a screen with room for a drag always
 * has on the side the card opens on, since that side is the half with more room.
 *
 * @param anchor the orb's centre
 * @param room the work area, CSS pixels
 * @param side the side the card opens on ({@link messengerPanelSide})
 * @param rootFontPx one rem, CSS pixels
 * @returns the size bound
 */
export function messengerPanelRoom({
  anchor,
  room,
  side,
  rootFontPx,
}: {
  anchor: MessengerAnchor;
  room: { readonly width: number; readonly height: number };
  side: MessengerPanelSide;
  rootFontPx: number;
}): MessengerSize {
  const orbHalf = ORB_HALF_REM * rootFontPx;
  const margin = MARGIN_REM * rootFontPx;
  let across = anchor.right + orbHalf - margin;
  if (side.horizontal === "left") {
    across = room.width - anchor.right + orbHalf - margin - UNCOVERED_STRIP_PX;
  }
  across = Math.min(across, room.width - CORNER_CLEARANCE_PX - UNCOVERED_STRIP_PX);
  let up = anchor.bottom - orbHalf - GAP_REM * rootFontPx - margin;
  if (side.vertical === "above") {
    up = room.height - anchor.bottom - orbHalf - GAP_REM * rootFontPx - margin;
  }
  const rem = ({ px, floor }: { px: number; floor: number }): number =>
    Math.max(floor, Math.floor((px / rootFontPx) * 100) / 100);
  return {
    heightRem: rem({ floor: MIN_MESSENGER_SIZE.heightRem, px: up }),
    widthRem: rem({ floor: MIN_MESSENGER_SIZE.widthRem, px: across }),
  };
}

/**
 * The edges a drag of the card resizes it by, on its side of the orb: the ones away from it, and their corner.
 *
 * @param side the side the card opens on
 * @returns the vertical edge, the horizontal edge and the corner between them
 */
export function messengerResizeEdges({ side }: { side: MessengerPanelSide }): readonly MessengerResizeEdge[] {
  let vertical: "top" | "bottom" = "bottom";
  if (side.vertical === "above") {
    vertical = "top";
  }
  return [vertical, side.horizontal, `${vertical}-${side.horizontal}`];
}

/**
 * Whether a press has moved far enough to be a drag of the orb: past {@link DRAG_THRESHOLD_PX}, so a press that
 * wobbles still opens and closes the messenger.
 *
 * @param delta how far the pointer has moved since the press, CSS pixels
 * @returns true once it is a drag
 */
export function orbDragCrossed({ delta }: { delta: { readonly x: number; readonly y: number } }): boolean {
  return Math.hypot(delta.x, delta.y) > DRAG_THRESHOLD_PX;
}

/**
 * The place a drag of the orb has reached: the orb's centre under the pointer where it was grabbed, kept on the screen.
 * Measured against the orb as drawn now, in the page's own CSS pixels, so the page's zoom and the window moving under
 * the drag cancel out — the way a drag of the card's edge is measured against the card (`cardDragDeltaPx`). Whole
 * pixels, as the place is kept (`messengerPlaceStorageOf`), so letting go never nudges the orb off where the drag drew
 * it.
 *
 * @param drawn the place the orb is drawn at now
 * @param orbCentre the orb's centre now, client CSS pixels
 * @param pointer the pointer now, client CSS pixels
 * @param grab where on the orb the press landed, from its centre
 * @param room the work area, CSS pixels
 * @param rootFontPx one rem, CSS pixels
 * @param home where the orb rests with no place of its own, the lowest it may come down to; rounded first and clamped
 *   after, so a drag pressed past it stops exactly on it
 * @returns the place
 */
export function draggedMessengerAnchor({
  drawn,
  orbCentre,
  pointer,
  grab,
  room,
  rootFontPx,
  home,
}: {
  drawn: MessengerAnchor;
  orbCentre: { readonly x: number; readonly y: number };
  pointer: { readonly x: number; readonly y: number };
  grab: { readonly x: number; readonly y: number };
  room: { readonly width: number; readonly height: number };
  rootFontPx: number;
  home?: OverlayHome | undefined;
}): MessengerAnchor {
  const anchor = {
    bottom: Math.round(drawn.bottom + orbCentre.y - (pointer.y - grab.y)),
    right: Math.round(drawn.right + orbCentre.x - (pointer.x - grab.x)),
  };
  return clampMessengerAnchor({ anchor, home, room, rootFontPx });
}

/**
 * The translate that shows the widget, drawn by its inline style at one place, at another: how a drag moves the orb on
 * every frame without laying the widget out again (`useMessengerPlace.ts`). A place is measured in from the right and
 * bottom, so one further from the right edge is drawn further left.
 *
 * @param rendered the place the widget's inline style draws it at
 * @param shown the place it is to be seen at
 * @returns the CSS `transform`, empty when the two are the same place
 */
export function messengerDragTranslate({
  rendered,
  shown,
}: {
  rendered: MessengerAnchor;
  shown: MessengerAnchor;
}): string {
  const x = rendered.right - shown.right;
  const y = rendered.bottom - shown.bottom;
  if (x === 0 && y === 0) {
    return "";
  }
  return `translate(${String(x)}px, ${String(y)}px)`;
}

/**
 * The place of an orb drawn at a point in the window, from the shell's word on where the work area sits in it.
 *
 * @param centre the orb's centre, client CSS pixels
 * @param viewport the window's viewport, CSS pixels
 * @param origin where the work area's right and bottom edges sit in from the window's, CSS pixels
 * @returns the place
 */
export function anchorOfCentre({
  centre,
  viewport,
  origin,
}: {
  centre: { readonly x: number; readonly y: number };
  viewport: { readonly width: number; readonly height: number };
  origin: OverlayOrigin;
}): MessengerAnchor {
  return { bottom: viewport.height - centre.y - origin.bottom, right: viewport.width - centre.x - origin.right };
}

/**
 * The frame the shell crops its window to at rest: the widget's box with {@link FRAME_SLACK_PX} round it, and the orb's
 * centre inside that.
 *
 * @param widget the widget's box
 * @param orb the orb's box
 * @returns the frame, whole CSS pixels across and up
 */
export function messengerFrameOf({ widget, orb }: { widget: ClientBox; orb: ClientBox }): MessengerFrame {
  return {
    height: Math.ceil(widget.height + 2 * FRAME_SLACK_PX),
    orbX: orb.left + orb.width / 2 - (widget.left - FRAME_SLACK_PX),
    orbY: orb.top + orb.height / 2 - (widget.top - FRAME_SLACK_PX),
    width: Math.ceil(widget.width + 2 * FRAME_SLACK_PX),
  };
}

/** The widget's position at a place, as the inline style that overrides its default bottom-right corner. */
export interface PlacedWidgetStyle {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
  readonly maxWidth: string;
  readonly justifyItems: string;
}

/**
 * Where the widget is drawn for a place: the orb's centre at the place in the work area, whichever window the shell
 * holds it in, by the shell's word on where the work area sits in it. The widget hangs off the orb's edges on the card's
 * side, so the card grows away from the orb. No width cap: the card's own size is already bounded by the room on its
 * side ({@link messengerPanelRoom}), and a cap read off a window cropped to the widget would shrink it for good.
 *
 * @param anchor the orb's centre
 * @param origin where the work area's right and bottom edges sit in from the window's, CSS pixels
 * @param side the side the card opens on
 * @returns the style
 */
export function placedWidgetStyle({
  anchor,
  origin,
  side,
}: {
  anchor: MessengerAnchor;
  origin: OverlayOrigin;
  side: MessengerPanelSide;
}): PlacedWidgetStyle {
  const fromRight = String(origin.right + anchor.right);
  const fromBottom = String(origin.bottom + anchor.bottom);
  let across = { justifyItems: "end", left: "auto", right: `calc(${fromRight}px - ${String(ORB_HALF_REM)}rem)` };
  if (side.horizontal === "right") {
    across = { justifyItems: "start", left: `calc(100% - ${fromRight}px - ${String(ORB_HALF_REM)}rem)`, right: "auto" };
  }
  let up = { bottom: `calc(${fromBottom}px - ${String(ORB_HALF_REM)}rem)`, top: "auto" };
  if (side.vertical === "below") {
    up = { bottom: "auto", top: `calc(100% - ${fromBottom}px - ${String(ORB_HALF_REM)}rem)` };
  }
  return { ...across, ...up, maxWidth: "none" };
}
