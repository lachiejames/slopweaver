/**
 * The overlay's geometry on the wire: whether the pointer is over one of the voice's controls, where those controls
 * sit, and the region of the display the voice asks to lift. Each is parsed rather than trusted, as every message in
 * `desktopBridge.ts` is.
 */
import { isRecord } from "./desktopBridge";

/**
 * Whether a pointer report says the pointer is over one of the voice's own controls.
 *
 * @param value what was sent
 * @returns the flag, or `undefined` when it is not a boolean
 */
export function parsePointerReport({ value }: { value: unknown }): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** One of the voice's own controls as the overlay's page lays it out: a box in CSS pixels from the viewport's top left. */
export interface OverlayControlBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the voice's own controls sit, as the overlay's preload measures them (`preload.ts` `reportControls`), so main
 * can take the pointer the moment the owner's cursor is over one without waiting on the page to hear the move
 * (`overlayPointerShell.ts`). The viewport it was measured in rides along, so a box laid out for the window's previous
 * size is never placed on its new bounds.
 */
export interface OverlayControlsReport {
  readonly boxes: readonly OverlayControlBox[];
  readonly viewport: { readonly width: number; readonly height: number };
}

/**
 * The most boxes one report may carry: the orb, the card, two notes, and the four panels round a lifted region, with
 * room to spare. A report past it is refused whole rather than cut, since a cut one would silently lose a control.
 */
export const MAX_CONTROL_BOXES = 32;

/**
 * One controls report off the wire: exactly its two keys, a viewport of positive finite size, and at most
 * {@link MAX_CONTROL_BOXES} boxes of exactly four finite numbers each, none of negative size. A box may start above
 * or left of the viewport, which a control part-way through a transition does.
 *
 * @param value what was sent
 * @returns the report, or `undefined` when it is not exactly one
 */
export function parseOverlayControls({ value }: { value: unknown }): OverlayControlsReport | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { boxes, viewport } = value;
  if (!isRecord(viewport) || Object.keys(viewport).length !== 2) {
    return undefined;
  }
  const { height: viewHeight, width: viewWidth } = viewport;
  if (!isPositiveFinite(viewWidth) || !isPositiveFinite(viewHeight)) {
    return undefined;
  }
  if (!Array.isArray(boxes) || boxes.length > MAX_CONTROL_BOXES) {
    return undefined;
  }
  const parsed: OverlayControlBox[] = [];
  for (const box of boxes as readonly unknown[]) {
    if (!isRecord(box) || Object.keys(box).length !== 4) {
      return undefined;
    }
    const { height, left, top, width } = box;
    if (!isFiniteNumber(left) || !isFiniteNumber(top) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
      return undefined;
    }
    if (width < 0 || height < 0) {
      return undefined;
    }
    parsed.push({ height, left, top, width });
  }
  return { boxes: parsed, viewport: { height: viewHeight, width: viewWidth } };
}

/**
 * Whether a value is a finite number.
 *
 * @returns true for one
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Whether a value is a finite number above zero.
 *
 * @returns true for one
 */
function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * One region of the display the voice last looked at, each edge a fraction of that picture (0 to 1), which the voice
 * asks the shell to lift on the owner's screen (`screenFocus.ts`).
 */
export interface FocusFractions {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** How far past the picture's edge rounding may carry a box before it is not one. */
const FRACTION_SLACK = 1e-6;

/**
 * One region to lift off the wire: exactly four fractions, each finite, the box non-empty and inside the picture.
 *
 * @param value what was sent
 * @returns the region, or `undefined` when it is not exactly one
 */
export function parseFocusRegion({ value }: { value: unknown }): FocusFractions | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    return undefined;
  }
  const { height, left, top, width } = value;
  if (!isFraction(height) || !isFraction(left) || !isFraction(top) || !isFraction(width)) {
    return undefined;
  }
  const inside = left + width <= 1 + FRACTION_SLACK && top + height <= 1 + FRACTION_SLACK;
  if (width <= 0 || height <= 0 || !inside) {
    return undefined;
  }
  return { height, left, top, width };
}

/**
 * Whether a value is a finite number from 0 to 1.
 *
 * @returns true for a fraction
 */
function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
