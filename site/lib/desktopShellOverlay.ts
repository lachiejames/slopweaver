/**
 * The overlay window's half of the desktop shell's wire (`./desktopShell.ts`): the voice's mode, the commands the shell
 * sends it, its status, and how much of the work area it asks for and is given. Pure.
 */
import { isRecord } from "./desktopShellWire";
import type { VoiceView } from "./voiceStage";

/** Whether the voice is the full stage or the orb in the corner. */
export type OverlayMode = "collapsed" | "expanded";

/** What the tray or the console window asks of the voice. */
export type OverlayCommand = "activate" | "collapse" | "expand";

/**
 * What the shell sends the voice: any {@link OverlayCommand}, `fold` — close the options beside the orb, because the owner
 * clicked into another app (`desktop/src/overlayWindow.ts` `overlayCommandOnBlur`) — or `hang-up`, ending the call
 * for an update the owner pressed, which the shell starts again once the update lands. Never one the console window asks
 * for.
 */
export type OverlayShellCommand = OverlayCommand | "fold" | "hang-up";

/** Where the voice stands, as the overlay reports it to the shell. */
export interface OverlayStatus {
  readonly callActive: boolean;
  readonly mode: OverlayMode;
}

/**
 * How much of the work area the voice needs drawn, as the overlay reports it, so the shell can shrink its window to
 * the corner whenever the answer is "the widget alone" (`desktop/src/overlayWindow.ts` says why).
 */
export interface OverlayExtent {
  /** Something drawn spans the display: the stage, a screen focus, or the edge glow under an older shell. */
  readonly wholeArea: boolean;
  /** CSS pixels from the window's bottom edge up to the top of the widget in the corner. */
  readonly height: number;
  /** How many times the page has asked for the whole work area ({@link askedFor}), echoed in {@link OverlayArea}. */
  readonly asks: number;
}

/** The shell's word after every fit of the overlay's window ({@link overlayAreaOf}). */
export interface OverlayArea {
  /** The window is whole: the primary display, menu bar and Dock included. */
  readonly whole: boolean;
  /** The asks of the last extent the shell applied; 0 before it has applied one. */
  readonly asks: number;
}

/**
 * Where the work area sits inside the overlay's window, CSS pixels from each edge ({@link overlayInsetOf}): the menu
 * bar and the Dock while the window is the whole display, so the orb, the panel and the stage's content stay off them
 * while the glow runs to the screen's edge (`desktop/src/overlayWindow.ts`); zero in the corner.
 */
export interface OverlayInset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** No inset: a browser, the corner, or a shell from before the window ran under the menu bar and the Dock. */
export const NO_INSET: OverlayInset = { bottom: 0, left: 0, right: 0, top: 0 };

/**
 * The overlay's mode for a voice view: the stage is expanded, the corner and no call at all are collapsed.
 *
 * @param view the widget's view
 * @returns the mode the shell sizes its glass and pointer to
 */
export function overlayModeOf({ view }: { view: VoiceView }): OverlayMode {
  return view === "stage" ? "expanded" : "collapsed";
}

/**
 * What the overlay tells the shell it needs: the whole display while the stage or a screen focus is up,
 * else the height of the widget in the corner, measured from the widget's floor — the window's own bottom edge in the
 * corner, which the shell anchors there, and the floor line's height above the display's bottom while whole —
 * so the widget never moves between the two sizes and a corner measured while whole is not a Dock too tall.
 *
 * @param wholeArea something drawn needs the whole display
 * @param viewportHeight the window's inner height, CSS pixels
 * @param floor how far the widget's floor sits above the window's bottom edge, CSS pixels ({@link overlayFloorOf})
 * @param widgetTop the top of the widget's box in the window, CSS pixels — negative when it outgrew the window
 * @param asks the page's count of asks for the whole display, {@link askedFor}
 * @returns the extent to report
 */
export function overlayExtentOf({
  asks,
  wholeArea,
  viewportHeight,
  floor,
  widgetTop,
}: {
  asks: number;
  wholeArea: boolean;
  viewportHeight: number;
  floor: number;
  widgetTop: number;
}): OverlayExtent {
  return { asks, height: Math.max(0, Math.ceil(viewportHeight - floor - widgetTop)), wholeArea };
}

/** What the page has asked the shell for: the whole work area or not, and how many times it has asked for it. */
export interface OverlayAsk {
  readonly wholeArea: boolean;
  readonly asks: number;
}

/**
 * The page's ask, moved to what it needs now. Every turn from the corner to the whole work area is a new ask, so the
 * shell's word can be matched to the newest one; the count never moves otherwise. A page starts on
 * {@link FIRST_ASK}: the shell holds a page that has not reported over the whole work area, so needing it first is
 * no new ask.
 *
 * @param before the ask so far
 * @param wholeArea something drawn needs the whole work area now
 * @returns the ask now — `before` itself when nothing moved
 */
export function askedFor({ before, wholeArea }: { before: OverlayAsk; wholeArea: boolean }): OverlayAsk {
  if (before.wholeArea === wholeArea) {
    return before;
  }
  if (wholeArea) {
    return { asks: before.asks + 1, wholeArea };
  }
  return { asks: before.asks, wholeArea };
}

/**
 * Whether the corner orb carries its X, revealed when the owner hovers it, that takes the overlay off their screen while the
 * call runs on. Only under a shell that can hide its window,
 * and never once the view is the stage, whose own controls move it to the corner first. That is the view the owner chose,
 * not the stage being drawn: the corner orb is still painted while the window grows to cover the desktop, and an X
 * pressed then would hide a stage that has already told the shell it is up.
 *
 * @param canHide the shell carries `hideOverlay`
 * @param staged the view is the stage or a preview of it, whether or not it has been drawn yet
 * @returns true when the X is drawn on the orb
 */
export function overlayHideControlShown({ canHide, staged }: { canHide: boolean; staged: boolean }): boolean {
  return canHide && !staged;
}

/**
 * Whether the overlay needs the whole display now: only for what is drawn across it. Everything else — the orb, the
 * open messenger, a call — keeps to the corner, sized to the widget, because a whole-display window is what macOS's
 * window picker selects wherever the owner points and what draws over ⌘⇧5's own veil.
 * The call's edge glow is drawn by the shell's screen-edge strips (`desktop/src/edgeGlowShell.ts`), so it does not
 * flip the window between corner and display with every voice turn.
 *
 * @param staged the stage is drawn, or a preview of it
 * @param focusShown the screen-focus frame is drawn, dimming the whole screen round one region
 * @param edgeInOverlay the page itself draws the edge glow, under a shell from before its strips: a call holds the
 *   display for its whole length then, a fade outliving it included
 * @param landing the corner's orb is still landing from the stage
 * @returns true while anything drawn, or about to be, needs the whole display
 */
export function overlayWantsWhole({
  staged,
  focusShown,
  edgeInOverlay,
  landing,
}: {
  staged: boolean;
  focusShown: boolean;
  edgeInOverlay: boolean;
  landing: boolean;
}): boolean {
  return staged || focusShown || edgeInOverlay || landing;
}

/** A page's ask before it has drawn anything: the whole work area, where the shell holds it, never asked for. */
export const FIRST_ASK: OverlayAsk = { asks: 0, wholeArea: true };

/** The shell's word before any has arrived: the window is whole, as the shell holds a page that has not reported. */
export const FIRST_AREA: OverlayArea = { asks: 0, whole: true };

/**
 * The shell's word on the overlay's window — what the stage, the panel and the edge glow wait for, so none of them
 * paints into the corner while the shell grows the window. The shell's word rather than a measure, because the
 * page's CSS pixels are scaled by a zoom the console window can set for it.
 *
 * @param value what the shell sent
 * @returns the word, or `undefined` when it is not exactly a whole flag and a whole, non-negative count of asks
 */
export function overlayAreaOf({ value }: { value: unknown }): OverlayArea | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { asks, whole } = value;
  if (typeof whole !== "boolean" || typeof asks !== "number" || !Number.isSafeInteger(asks) || asks < 0) {
    return undefined;
  }
  return { asks, whole };
}

/**
 * The shell's inset word: where the work area sits inside the overlay's window.
 *
 * @param value what the shell sent
 * @returns the inset, or `undefined` when it is not exactly four finite, non-negative edges
 */
export function overlayInsetOf({ value }: { value: unknown }): OverlayInset | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 4) {
    return undefined;
  }
  const { bottom, left, right, top } = value;
  if (!isEdge(bottom) || !isEdge(left) || !isEdge(right) || !isEdge(top)) {
    return undefined;
  }
  return { bottom, left, right, top };
}

/**
 * The shell's floor word: how far above the overlay window's bottom edge the widget rests — level with a bottom Dock,
 * else clear of an app's own bottom bar (`desktop/src/overlayWindow.ts`, `overlayFloorLine`).
 *
 * @param value what the shell sent
 * @returns the floor in CSS pixels, or `undefined` when it is not one finite, non-negative number
 */
export function overlayFloorOf({ value }: { value: unknown }): number | undefined {
  return isEdge(value) ? value : undefined;
}

/**
 * One inset edge: a finite, non-negative count of CSS pixels.
 *
 * @param value one field of the inset word
 * @returns true when it is one
 */
function isEdge(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Whether what needs the whole work area may draw: the shell's word says the window is whole, and it was sent after
 * the shell read the page's newest ask. A "whole" from before that ask can describe a window the shell has since
 * shrunk to the corner.
 *
 * @param area the shell's latest word
 * @param ask the page's ask now
 * @returns true to draw the stage, the panel and the edge glow
 */
export function overlayCovers({ area, ask }: { area: OverlayArea; ask: OverlayAsk }): boolean {
  return area.whole && area.asks === ask.asks;
}

/**
 * One command off the shell.
 *
 * @param value what the shell sent
 * @returns the command, or `undefined` when it is not one
 */
export function overlayCommandOf({ value }: { value: unknown }): OverlayShellCommand | undefined {
  if (value === "activate" || value === "collapse" || value === "expand" || value === "fold" || value === "hang-up") {
    return value;
  }
  return undefined;
}

/**
 * One overlay status off the shell: exactly `{ callActive, mode }`.
 *
 * @param value what the shell sent
 * @returns the status, or `undefined` for anything that is not exactly one
 */
export function overlayStatusOf({ value }: { value: unknown }): OverlayStatus | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const callActive = value["callActive"];
  const mode = value["mode"];
  if (typeof callActive !== "boolean" || (mode !== "collapsed" && mode !== "expanded")) {
    return undefined;
  }
  return { callActive, mode };
}

/**
 * One forwarded overlay report: a status, or `null` — the shell's word that no voice page reports, which clears
 * what the console window holds. Anything else is dropped rather than read as "no call", so a malformed message
 * can never take a live call's status away.
 *
 * @param value what the shell sent
 * @returns the report to apply — its `status` absent for `null` — or `undefined` when it is not one
 */
export function overlayReportOf({
  value,
}: {
  value: unknown;
}): { readonly status: OverlayStatus | undefined } | undefined {
  if (value === null) {
    return { status: undefined };
  }
  const status = overlayStatusOf({ value });
  if (status === undefined) {
    return undefined;
  }
  return { status };
}
