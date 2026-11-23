/**
 * How big the messenger is: Small, the size it has always opened at; Large, a fifth taller; or whatever the owner dragged
 * its left or top edge to (free resizing by the edges, a couple of presets and a reset in ONE menu). Full screen is the stage, not a size.
 *
 * Pure: the presets, the bounds, the drag's arithmetic and the stored string. The card hangs off the orb, above it and
 * reaching left unless the orb was dragged elsewhere (`messengerPlace.ts`), so the edges away from the orb are the ones
 * that move, and dragging either away from the orb grows it. The narrowest
 * it gets is today's width, because the header holds the state, up to six call controls and close on one row;
 * a wider one is room the shell must grow its corner by, so it is reported
 * ({@link cornerWidthPx}) and offered only under a shell that takes the report.
 */
import { CORNER_CARD_HEIGHT_REM } from "./callTrays";

/** The messenger's size, rem. */
export interface MessengerSize {
  readonly widthRem: number;
  readonly heightRem: number;
}

/** What is stored: a preset by name, or a size the owner dragged to as `custom:<widthRem>:<heightRem>`. */
export type MessengerSizeStorage = "small" | "large" | `custom:${string}`;

/** The edges and corners a drag resizes from: the ones away from the orb, on whichever side of it the card opens. */
export type MessengerResizeEdge =
  "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * One row of the size menu: keep a preset, open the stage, or reset — Small, the size it opens at, with the orb back
 * where it has always rested (`messengerPlace.ts`), so a dragged orb is one press from home.
 */
export type MessengerSizeAction = "small" | "large" | "fullscreen" | "reset";

/** A size menu row that keeps something rather than opening the stage. */
export type MessengerSizePick = Exclude<MessengerSizeAction, "fullscreen">;

/** The `localStorage` key the size is kept under, for this console's origin. */
export const MESSENGER_SIZE_KEY = "slopweaver.messenger-size";

/** The size the messenger has always opened at. */
export const SMALL_MESSENGER_SIZE: MessengerSize = { heightRem: CORNER_CARD_HEIGHT_REM, widthRem: 28 };

/** Large: about a fifth taller, the voice's proposal the owner approved; as wide, so it needs nothing of the shell. */
export const LARGE_MESSENGER_SIZE: MessengerSize = {
  heightRem: Math.round(CORNER_CARD_HEIGHT_REM * 1.2 * 100) / 100,
  widthRem: 28,
};

/** The smallest a drag takes it: today's width, which the header's one row needs, and room for its fixed rows. */
export const MIN_MESSENGER_SIZE: MessengerSize = { heightRem: 18, widthRem: 28 };

/**
 * What the corner keeps around the card's width, CSS pixels: the widget's 1.25rem margin either side at 16px and 24px
 * for shadows. Restated from `desktop/src/overlayWindow.ts` `CORNER_WIDTH` (28rem at 16px plus this is its 512), which
 * this tree cannot import; `overlayWindow.test.ts` holds the two together.
 */
export const CORNER_CLEARANCE_PX = 64;

/**
 * How much of the screen's width the corner always leaves uncovered at the messenger's widest, CSS pixels: the shell's
 * `MANIPULATION_STRIP` (`desktop/src/overlayWindow.ts`), the work area's left edge a drag's window never covers.
 */
export const UNCOVERED_STRIP_PX = 32;

/** What the card keeps clear above and below it on screen, rem: `callTrays.ts`'s clearance, restated as a bound. */
const SCREEN_CLEAR_REM = 9.8;

/** The largest size a stored string may name, rem — no screen is wider, and a bigger number is a corrupt one. */
const STORED_CEILING_REM = 400;

/** A stored custom size. */
const CUSTOM = /^custom:(\d{1,3}(?:\.\d{1,2})?):(\d{1,3}(?:\.\d{1,2})?)$/u;

/**
 * A number kept to two places, so a stored size reads back to the same string.
 *
 * @param value the number
 * @returns it to two decimal places
 */
function twoPlaces({ value }: { value: number }): number {
  return Math.round(value * 100) / 100;
}

/**
 * Whether a stored value is a size, read strictly: a preset's name, or a custom size inside the bounds.
 *
 * @param value what `localStorage` held
 * @returns whether it is one
 */
export function isMessengerSizeStorage(value: unknown): value is MessengerSizeStorage {
  if (value === "small" || value === "large") {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const match = CUSTOM.exec(value);
  if (match === null) {
    return false;
  }
  const widthRem = Number(match[1]);
  const heightRem = Number(match[2]);
  const inWidth = widthRem >= MIN_MESSENGER_SIZE.widthRem && widthRem <= STORED_CEILING_REM;
  return inWidth && heightRem >= MIN_MESSENGER_SIZE.heightRem && heightRem <= STORED_CEILING_REM;
}

/**
 * The size a stored value names.
 *
 * @param stored a value {@link isMessengerSizeStorage} accepted
 * @param canWiden the shell can grow its window wider; when it cannot, a width kept under one that could draws at
 *   the default, which is all an older shell's corner holds
 * @returns the size
 */
export function messengerSizeOf({
  stored,
  canWiden,
}: {
  stored: MessengerSizeStorage;
  canWiden: boolean;
}): MessengerSize {
  if (stored === "small") {
    return SMALL_MESSENGER_SIZE;
  }
  if (stored === "large") {
    return LARGE_MESSENGER_SIZE;
  }
  const [, width, height] = stored.split(":");
  let widthRem = Number(width);
  if (!canWiden) {
    widthRem = SMALL_MESSENGER_SIZE.widthRem;
  }
  return { heightRem: Number(height), widthRem };
}

/**
 * The stored value for a size: a preset's name when it is one, else the custom string.
 *
 * @returns what to store
 */
export function messengerSizeStorageOf({ size }: { size: MessengerSize }): MessengerSizeStorage {
  const sameAs = (preset: MessengerSize): boolean =>
    preset.widthRem === size.widthRem && preset.heightRem === size.heightRem;
  if (sameAs(SMALL_MESSENGER_SIZE)) {
    return "small";
  }
  if (sameAs(LARGE_MESSENGER_SIZE)) {
    return "large";
  }
  return `custom:${String(twoPlaces({ value: size.widthRem }))}:${String(twoPlaces({ value: size.heightRem }))}`;
}

/**
 * The largest the messenger may be on this screen: the screen less the corner's clearance across, and less what the
 * card keeps clear above and below it; never under the minimum. Under a shell that cannot grow its corner, today's
 * width is the widest, since the window will not get any wider.
 *
 * @param screenPx the screen's work area the page can see (`window.screen.availWidth` and `availHeight`)
 * @param rootFontPx one rem, CSS pixels
 * @param canWiden the shell takes the corner's width
 * @returns the size bound
 */
export function messengerMaximum({
  screenPx,
  rootFontPx,
  canWiden,
}: {
  screenPx: { readonly width: number; readonly height: number };
  rootFontPx: number;
  canWiden: boolean;
}): MessengerSize {
  const heightRem = Math.max(MIN_MESSENGER_SIZE.heightRem, screenPx.height / rootFontPx - SCREEN_CLEAR_REM);
  if (!canWiden) {
    return { heightRem: twoPlaces({ value: heightRem }), widthRem: MIN_MESSENGER_SIZE.widthRem };
  }
  // A strip of the screen stays uncovered, so the corner never spans the whole work area: one that did would turn into
  // the whole display, the window ⌘⇧5 finds above the owner's app (`desktop/src/overlayWindow.ts` `overlayPlacement`).
  const across = screenPx.width - CORNER_CLEARANCE_PX - UNCOVERED_STRIP_PX;
  const widthRem = Math.max(MIN_MESSENGER_SIZE.widthRem, across / rootFontPx);
  return { heightRem: twoPlaces({ value: heightRem }), widthRem: twoPlaces({ value: widthRem }) };
}

/**
 * Which way each axis of a drag of an edge grows the card: `-1` where moving left or up grows it (its left or top
 * edge), `1` where moving right or down does, `0` on an axis the edge does not move.
 *
 * @param edge what is being dragged
 * @returns the sign across and up
 */
function edgeSigns({ edge }: { edge: MessengerResizeEdge }): { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 } {
  let x: -1 | 0 | 1 = 0;
  if (edge.endsWith("left")) {
    x = -1;
  } else if (edge.endsWith("right")) {
    x = 1;
  }
  let y: -1 | 0 | 1 = 0;
  if (edge.startsWith("top")) {
    y = -1;
  } else if (edge.startsWith("bottom")) {
    y = 1;
  }
  return { x, y };
}

/**
 * The size a drag has reached: moving an edge away from the orb grows the card along it — the left edge left, the top
 * edge up, or the right and bottom edges of a card opened below and to the right of an orb dragged to the top left —
 * each kept inside the bounds. The movement comes from {@link cardDragDeltaPx}, measured against the card, because the
 * window itself moves as it grows.
 *
 * @param edge what is being dragged
 * @param start the size the drag began at
 * @param deltaPx how far the dragged edge has moved since, CSS pixels, right and down positive
 * @param rootFontPx one rem, CSS pixels
 * @param maximum the largest it may be ({@link messengerMaximum})
 * @returns the size now
 */
export function resizeMessenger({
  edge,
  start,
  deltaPx,
  rootFontPx,
  maximum,
}: {
  edge: MessengerResizeEdge;
  start: MessengerSize;
  deltaPx: { readonly x: number; readonly y: number };
  rootFontPx: number;
  maximum: MessengerSize;
}): MessengerSize {
  const clamp = ({ value, low, high }: { value: number; low: number; high: number }): number =>
    twoPlaces({ value: Math.min(high, Math.max(low, value)) });
  const signs = edgeSigns({ edge });
  const widthRem = start.widthRem + (signs.x * deltaPx.x) / rootFontPx;
  const heightRem = start.heightRem + (signs.y * deltaPx.y) / rootFontPx;
  return {
    heightRem: clamp({ high: maximum.heightRem, low: MIN_MESSENGER_SIZE.heightRem, value: heightRem }),
    widthRem: clamp({ high: maximum.widthRem, low: MIN_MESSENGER_SIZE.widthRem, value: widthRem }),
  };
}

/**
 * Whether this screen has room for the smallest messenger with its clearances. One that does not (a page zoomed far
 * in) draws the card narrower than its smallest size, under its CSS cap, so an edge dragged there would not follow the
 * pointer and nothing is offered to drag.
 *
 * @param screenPx the room, CSS pixels
 * @param rootFontPx one rem, CSS pixels
 * @returns the smallest messenger fits, across and up
 */
export function messengerRoomy({
  screenPx,
  rootFontPx,
}: {
  screenPx: { readonly width: number; readonly height: number };
  rootFontPx: number;
}): boolean {
  const across = (screenPx.width - CORNER_CLEARANCE_PX - UNCOVERED_STRIP_PX) / rootFontPx;
  const up = screenPx.height / rootFontPx - SCREEN_CLEAR_REM;
  return across >= MIN_MESSENGER_SIZE.widthRem && up >= MIN_MESSENGER_SIZE.heightRem;
}

/**
 * The screen's work area in the page's CSS pixels. Chromium reports the screen and the window's outer size in screen
 * points but the viewport in CSS pixels, so under a zoom the screen reads larger than the page can draw; the window's
 * own outer and inner widths give the ratio between the two, the shell's window being frameless.
 *
 * @param availPx the screen's work area as `window.screen` reports it
 * @param outerWidth the window's width as `window.outerWidth` reports it
 * @param innerWidth the viewport's width, CSS pixels
 * @returns the work area, CSS pixels; as reported for a window not yet laid out
 */
export function screenRoomCssPx({
  availPx,
  outerWidth,
  innerWidth,
}: {
  availPx: { readonly width: number; readonly height: number };
  outerWidth: number;
  innerWidth: number;
}): { readonly width: number; readonly height: number } {
  if (innerWidth <= 0 || outerWidth <= 0) {
    return availPx;
  }
  const pointsPerCssPx = outerWidth / innerWidth;
  return { height: availPx.height / pointsPerCssPx, width: availPx.width / pointsPerCssPx };
}

/**
 * How far a drag has moved, for {@link resizeMessenger}, measured from the card itself rather than the screen: the
 * pointer and the card's own box are both in the page's CSS pixels, so the page's zoom and the window growing under the
 * drag cancel out, where a screen-point delta read against a rem would let the edge outrun the pointer.
 *
 * @param edge what is being dragged; its opposite edges are the ones that stay put, beside the orb
 * @param start the size the drag began at
 * @param rootFontPx one rem, CSS pixels
 * @param cardPx the card's edges now, client CSS pixels
 * @param pointerPx the pointer now, client CSS pixels
 * @param grabPx where the press landed, from the dragged edges themselves
 * @returns the movement that puts the dragged edge under the pointer
 */
export function cardDragDeltaPx({
  edge,
  start,
  rootFontPx,
  cardPx,
  pointerPx,
  grabPx,
}: {
  edge: MessengerResizeEdge;
  start: MessengerSize;
  rootFontPx: number;
  cardPx: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  pointerPx: { readonly x: number; readonly y: number };
  grabPx: { readonly x: number; readonly y: number };
}): { readonly x: number; readonly y: number } {
  const signs = edgeSigns({ edge });
  const edgeX = pointerPx.x - grabPx.x;
  const edgeY = pointerPx.y - grabPx.y;
  let widthPx = edgeX - cardPx.left;
  if (signs.x === -1) {
    widthPx = cardPx.right - edgeX;
  }
  let heightPx = edgeY - cardPx.top;
  if (signs.y === -1) {
    heightPx = cardPx.bottom - edgeY;
  }
  // No movement answers a plain zero, never the `-0` a product with zero can be.
  const moved = ({ sign, grownPx }: { sign: -1 | 0 | 1; grownPx: number }): number =>
    sign === 0 || grownPx === 0 ? 0 : sign * grownPx;
  return {
    x: moved({ grownPx: widthPx - start.widthRem * rootFontPx, sign: signs.x }),
    y: moved({ grownPx: heightPx - start.heightRem * rootFontPx, sign: signs.y }),
  };
}

/**
 * Where a press on an edge landed, from the edges it drags, for {@link cardDragDeltaPx}.
 *
 * @param edge what is being dragged
 * @param cardPx the card's edges at the press, client CSS pixels
 * @param pressPx the press, client CSS pixels
 * @returns the press less each dragged edge's line, `0` on an axis the edge does not move
 */
export function cardGrabPx({
  edge,
  cardPx,
  pressPx,
}: {
  edge: MessengerResizeEdge;
  cardPx: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  pressPx: { readonly x: number; readonly y: number };
}): { readonly x: number; readonly y: number } {
  const signs = edgeSigns({ edge });
  let x = 0;
  if (signs.x !== 0) {
    x = pressPx.x - (signs.x === -1 ? cardPx.left : cardPx.right);
  }
  let y = 0;
  if (signs.y !== 0) {
    y = pressPx.y - (signs.y === -1 ? cardPx.top : cardPx.bottom);
  }
  return { x, y };
}

/**
 * A kept size as this screen can draw it: one kept on a larger display, or a preset taller than this one, is drawn at
 * the room there is, so the card the owner sees resting is the one a drag starts from.
 *
 * @param size the kept size
 * @param maximum the room on this screen ({@link messengerMaximum})
 * @returns the size to draw, never past the room and never grown
 */
export function fitMessenger({ size, maximum }: { size: MessengerSize; maximum: MessengerSize }): MessengerSize {
  return {
    heightRem: Math.min(size.heightRem, maximum.heightRem),
    widthRem: Math.min(size.widthRem, maximum.widthRem),
  };
}

/**
 * The corner's width the shell must give the messenger at this size, CSS pixels.
 *
 * @param rootFontPx one rem, CSS pixels
 * @returns the card's width and the corner's clearance around it, rounded up to a whole pixel
 */
export function cornerWidthPx({ size, rootFontPx }: { size: MessengerSize; rootFontPx: number }): number {
  return Math.ceil(size.widthRem * rootFontPx + CORNER_CLEARANCE_PX);
}

/**
 * The size menu, in order: the two sizes, the stage, then the reset.
 *
 * @returns each row's action and words
 */
export function messengerSizeMenu(): readonly { readonly action: MessengerSizeAction; readonly label: string }[] {
  return [
    { action: "small", label: "Small" },
    { action: "large", label: "Large" },
    { action: "fullscreen", label: "Full screen" },
    { action: "reset", label: "Reset size and position" },
  ];
}
