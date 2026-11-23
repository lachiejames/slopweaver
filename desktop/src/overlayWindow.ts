/**
 * How the voice's window sits over the owner's desktop, as data the main process applies. One transparent window, never a
 * second one, at one of two sizes:
 *
 * - **The whole primary display**, menu bar and Dock included, while what it draws spans it — the stage, a screen
 *   focus's dim, the orb landing from the stage — so expanding stays a change of state rather than a move and a focus
 *   change at once, and while a page that predates the extent report, or the shell's edge
 *   strips, is loaded. The display, never its work area: a presence glow around the
 *   screen border must go full-screen around the menu bar and under the Dock, not stay localized to the application
 *   section. The page keeps its controls inside
 *   the work area by the {@link overlayInset} the shell sends beside each fit. A call's edge glow and a share's frame
 *   are drawn by four screen-edge strips instead (`edgeGlow.ts`), so neither holds this window whole.
 * - **The corner the widget occupies** otherwise, the open messenger and a call included, on the work area. Over the whole work area it is the window macOS's
 *   ⌘⇧5 picker finds above any maximised app, with that app's exact bounds, so a shot of "Chrome" is a shot of the
 *   voice: pressing ⌘⇧5 on a window, like Chrome, during a call says it is unable to
 *   take a screenshot. Click-through alone does not stop it — the window already ignores the
 *   pointer there. The window itself is capturable like any other, so a shot of the orb has the orb in it.
 *
 * Either way the orb rests on one floor line ({@link overlayFloorLine}): with the Dock along the bottom, the orb's centre
 * on the Dock strip's centre, below every app window, at the same position on the X axis and centred with the Dock on
 * the Y axis; with no Dock there, {@link TOOLBAR_BAND} above the work area's bottom, where an app keeps its own bottom
 * bar, so the corner never sits on that app's controls (an overlay over Google Meet's meeting controls is in the way).
 *
 * Pure.
 */
import type { OverlayArea, OverlayExtent, OverlayInset, OverlayMode, OverlayPageCommand } from "./desktopBridge";
import type { OverlayControlsReport } from "./desktopBridgeGeometry";
import type { Bounds } from "./persistedState";

/**
 * The corner's width in the page's CSS pixels: the open messenger's 28rem cap plus the widget's 1.25rem margin either
 * side at 16px, and 24px for shadows. At least that, so the widget's `calc(100vw - 2.5rem)` cap never binds inside the
 * corner — a caption it squeezed would report narrower and never widen again (`site/components/voice/VoiceWidget.tsx`,
 * `WIDGET`, and `CallCard.tsx`'s card). The messenger opens inside the corner, never over the whole display, since that
 * window is what ⌘⇧5's picker selected wherever the owner pointed. Only the height is
 * measured (`overlayPlacement`); the width is this static cap, so a page needs no new field an older shell would refuse.
 * The corner's three sizes are CSS pixels because the page's zoom scales them: Electron shares zoom per origin, so a
 * console window the owner zoomed zooms the voice's page too.
 */
export const CORNER_WIDTH = 512;

/**
 * The strip along the work area's left edge the corner leaves uncovered while the owner drags the messenger's edge,
 * screen points, so the corner never spans the whole work area and turns into the whole display ⌘⇧5 finds above
 * another app. The
 * page bounds its widest messenger by the same strip (`site/lib/messengerSize.ts` `UNCOVERED_STRIP_PX`).
 */
export const MANIPULATION_STRIP = 32;

/** Room above the widget's own top for the orb's badge and the shadows, which hang outside its box, CSS pixels. */
export const CORNER_SLACK = 24;

/** The shortest the corner gets, so a widget measured before its first layout still has its orb, CSS pixels. */
export const CORNER_MIN_HEIGHT = 120;

/**
 * The band above the work area's bottom edge an app keeps its own bottom bar in, screen points, never scaled by the
 * voice's zoom because it is the other app's geometry. Measured off a screenshot (a 1512x982-point
 * display at 1.3228 pixels a point): Google Meet's chat and activities buttons in a maximised Chrome ran from about 16
 * to 78 points above the Dock's top, under an orb that sat from 20 to 76. Lifted by this, the orb's bottom is 92. The
 * orb rests here only where there is no Dock strip along the bottom to sit in.
 */
export const TOOLBAR_BAND = 72;

/**
 * How far the orb's centre sits above the widget's floor, CSS pixels: the widget's `1.25rem` bottom margin at 16px
 * plus half its `size-14` orb (`site/components/voice/VoiceWidget.tsx`, `WIDGET` and the orb's button). Restated
 * because neither tree can import the other; `overlayWindow.test.ts` reads both off that file.
 */
export const ORB_CENTRE_LIFT = 20 + 28;

/**
 * The shortest strip below the work area that is a Dock to sit in, screen points. An auto-hidden Dock still leaves a
 * sliver of a few points out of the work area (not measured on the owner's machine, which shows its Dock), and the smallest
 * Dock macOS draws, at a 16-point tile, leaves a strip taller than this.
 */
export const DOCK_MIN_STRIP = 16;

/**
 * The screen line the widget's floor rests on, screen points down from the top of the coordinate space:
 *
 * - **A page from before the floor word**: the work area's bottom. It rests the widget on the inset's bottom edge, so a
 *   corner anywhere else would drop its orb each time the window turned whole, and the console's production build can
 *   serve that older page under a newer shell until it rebuilds.
 * - **The Dock along the bottom**: the orb's centre on the Dock strip's centre, below every app window and level with
 *   the Dock beside it, rounded to a whole point so the corner's bounds stay whole; never below the display's bottom,
 *   which a zoomed page on a short Dock would otherwise reach.
 * - **No Dock strip along the bottom** — at the side, or auto-hidden: {@link TOOLBAR_BAND} above the work area's
 *   bottom, clear of an app's own bottom bar.
 *
 * @param display the primary display's bounds, in screen points
 * @param workArea the primary display's work area, in screen points
 * @param hearsFloor the overlay's page subscribed to the floor word since it last loaded
 * @param zoomFactor the page's zoom, which turns its CSS pixels into screen points
 * @returns the floor line's y, screen points
 */
export function overlayFloorLine({
  display,
  hearsFloor,
  workArea,
  zoomFactor,
}: {
  display: Bounds;
  hearsFloor: boolean;
  workArea: Bounds;
  zoomFactor: number;
}): number {
  const workBottom = workArea.y + workArea.height;
  if (!hearsFloor) {
    return workBottom;
  }
  const displayBottom = display.y + display.height;
  const dockStrip = displayBottom - workBottom;
  if (dockStrip < DOCK_MIN_STRIP) {
    return Math.max(workArea.y, workBottom - TOOLBAR_BAND);
  }
  return Math.min(displayBottom, Math.round(workBottom + dockStrip / 2 + ORB_CENTRE_LIFT * zoomFactor));
}

/** Where the window goes, and whether that is whole — the page draws its stage only once it is. */
export interface OverlayPlacement {
  readonly bounds: Bounds;
  readonly whole: boolean;
}

/** A macOS window level by Electron's name for it, as `BrowserWindow.setAlwaysOnTop` takes one. */
export type OverlayLevel =
  | "dock"
  | "floating"
  | "main-menu"
  | "modal-panel"
  | "normal"
  | "pop-up-menu"
  | "screen-saver"
  | "status"
  | "torn-off-menu";

/**
 * The window's level while whole, and the edge strips' (`edgeGlowShell.ts`): the menu bar's own (24, `main-menu`) —
 * above the Dock (20), and ordered above the menu bar's window, which was ordered front before it, so the glow runs
 * round the screen's real edge. No higher: ⌘⇧5 dims the screen and draws its selection frame in a window at this same
 * level, created after the voice's and so ordered above it, while anything above 24 drew undimmed over that veil, out
 * of the owner's reach (MEASURED
 * with `CGWindowListCopyWindowInfo` while ⌘⇧5 was open: toolbar 1499, veil 24, overlay 1000 at `screen-saver`). The
 * trade: an open menu-bar menu (101) and a status item's own window (25) now draw over the glow. Click-through
 * everywhere but the voice's own controls, so nothing beneath loses a click to it.
 */
export const WHOLE_LEVEL: OverlayLevel = "main-menu";

/**
 * The corner's level: the whole window's, so a fit that trades corner and display never re-sets the level and with it
 * re-orders the window above a ⌘⇧5 veil already up (`main.ts` `fitOverlay` sets it only on a change). Above the Dock
 * (20), because the corner runs into the Dock's strip and a Dock long enough to reach the right edge would otherwise
 * draw over the orb. Such a Dock has one icon under the orb, and every click but the voice's own controls passes through.
 */
export const CORNER_LEVEL: OverlayLevel = "main-menu";

/** What the main process does to the window for one mode. */
export interface OverlayPresentation {
  /** The native glass behind the page: only behind the expanded stage, never the whole desktop behind an orb. */
  readonly vibrancy: "under-window" | null;
  /** Take the keyboard, so Escape and Alt+V reach the stage. */
  readonly focus: boolean;
}

/**
 * Where the window goes: the primary display's whole bounds, menu bar and Dock included, negative origins too, or the
 * corner the widget occupies, its right edge on the work area's and its bottom on the floor line
 * ({@link overlayFloorLine}), so the widget never moves on screen between the two. The corner runs from the work
 * area's top down to that line, into the Dock's strip when the orb sits level with the Dock. A corner clamped to all
 * of that room is no corner, so it is the whole display: the page may draw there, inside the inset.
 *
 * @param display the primary display's bounds, in screen points
 * @param workArea the primary display's work area, in screen points
 * @param floorLine the screen line the widget's floor rests on ({@link overlayFloorLine})
 * @param extent what the page last reported, `undefined` while no page that reports one is loaded
 * @param cornerWidthCss the corner's width the page asked for at the size the owner gave the messenger, CSS pixels;
 *   `undefined` from a page that does not report one, which gets {@link CORNER_WIDTH}. Never narrower than that, so a
 *   report can only widen the corner
 * @param manipulating the owner is dragging the messenger's edge: the corner takes all its room bar a strip
 *   ({@link MANIPULATION_STRIP}) for the drag, so the window resizes once as it begins and once as it ends rather than
 *   on every move, and the card grows inside it
 * @param wholeArea the shell's own reasons for the whole display: the stage is up, or a share's frame is drawn
 * @param zoomFactor the page's zoom, which turns its CSS pixels into screen points
 * @returns the bounds to set, and whether the page may draw what needs the whole screen in them
 */
export function overlayPlacement({
  display,
  floorLine,
  workArea,
  extent,
  cornerWidthCss,
  manipulating,
  wholeArea,
  zoomFactor,
}: {
  display: Bounds;
  floorLine: number;
  workArea: Bounds;
  extent: OverlayExtent | undefined;
  cornerWidthCss: number | undefined;
  manipulating: boolean;
  wholeArea: boolean;
  zoomFactor: number;
}): OverlayPlacement {
  const wholeDisplay = {
    bounds: { height: display.height, width: display.width, x: display.x, y: display.y },
    whole: true,
  };
  if (extent === undefined || extent.wholeArea || wholeArea) {
    return wholeDisplay;
  }
  const cssHeight = Math.max(CORNER_MIN_HEIGHT, Math.ceil(extent.height) + CORNER_SLACK);
  const room = Math.max(0, floorLine - workArea.y);
  if (manipulating && workArea.width > MANIPULATION_STRIP) {
    const width = workArea.width - MANIPULATION_STRIP;
    return { bounds: { height: room, width, x: workArea.x + MANIPULATION_STRIP, y: floorLine - room }, whole: false };
  }
  let cssWidth = CORNER_WIDTH;
  if (cornerWidthCss !== undefined) {
    cssWidth = Math.max(CORNER_WIDTH, cornerWidthCss);
  }
  const width = Math.min(workArea.width, Math.ceil(cssWidth * zoomFactor));
  const height = Math.min(room, Math.ceil(cssHeight * zoomFactor));
  if (width === workArea.width && height === room) {
    return wholeDisplay;
  }
  return { bounds: { height, width, x: workArea.x + workArea.width - width, y: floorLine - height }, whole: false };
}

/**
 * Where the widget's floor sits above the window's bottom edge, sent to the page beside every fit, so the orb rests
 * over the same screen line in the corner, whose bottom edge is that line, and across the whole display. Rounded up
 * to whole CSS pixels, like {@link overlayInset}, which the stage keeps: only the widget moves.
 *
 * @param placement where the fit put the window
 * @param floorLine the screen line the widget's floor rests on ({@link overlayFloorLine})
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the floor's height above the window's bottom edge, CSS pixels
 */
export function overlayFloor({
  floorLine,
  placement,
  zoomFactor,
}: {
  floorLine: number;
  placement: OverlayPlacement;
  zoomFactor: number;
}): number {
  const { bounds } = placement;
  return Math.max(0, Math.ceil((bounds.y + bounds.height - floorLine) / zoomFactor));
}

/**
 * The shell's word to the page after a fit. It echoes the asks of the extent the fit applied, and the page trusts a
 * "whole" only once it echoes the page's latest ask: a word sent before main read that ask can say "whole" about a
 * window main is shrinking, which would draw the stage into the corner for a round trip.
 *
 * @param extent what the page last reported, `undefined` while no page that reports one is loaded
 * @param placement where the fit put the window
 * @returns the word to send
 */
export function overlayAreaWord({
  extent,
  placement,
}: {
  extent: OverlayExtent | undefined;
  placement: OverlayPlacement;
}): OverlayArea {
  if (extent === undefined) {
    return { asks: 0, whole: placement.whole };
  }
  return { asks: extent.asks, whole: placement.whole };
}

/**
 * Where the work area sits inside the window, sent to the page beside every fit so its orb, panel and stage content
 * stay off the menu bar and the Dock while the window runs under both. Rounded up to whole CSS pixels, so a control
 * never sits a fraction of a point into the Dock. In the corner it is zero on every edge but the bottom, which is the
 * corner's run into the Dock's strip when the orb sits level with the Dock; only the stage reads that edge, and it
 * draws only while the window is whole.
 *
 * @param placement where the fit put the window
 * @param workArea the primary display's work area, in screen points
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the inset from each of the window's edges, CSS pixels
 */
export function overlayInset({
  placement,
  workArea,
  zoomFactor,
}: {
  placement: OverlayPlacement;
  workArea: Bounds;
  zoomFactor: number;
}): OverlayInset {
  const { bounds } = placement;
  const css = ({ points }: { points: number }): number => Math.max(0, Math.ceil(points / zoomFactor));
  return {
    bottom: css({ points: bounds.y + bounds.height - (workArea.y + workArea.height) }),
    left: css({ points: workArea.x - bounds.x }),
    right: css({ points: bounds.x + bounds.width - (workArea.x + workArea.width) }),
    top: css({ points: workArea.y - bounds.y }),
  };
}

/**
 * The longest the window stays see-through across a move while it waits for the page's first frame at the new bounds
 * ({@link overlayMoveHides}); past it, it shows whatever it holds rather than leave the orb gone.
 */
export const MOVE_REVEAL_CEILING_MS = 250;

/**
 * Whether a fit hides the window until the page has drawn at its new bounds. macOS shows a resized window's last frame
 * pinned to its top-left corner until the page draws again, and the floor word reaches the page just before the
 * resize: between them the orb showed for half a second a little higher in the corner, or somewhere else on the owner's whole
 * screen as the corner grew to the display. See-through for that frame, nothing is
 * drawn in the wrong place; a window not on screen has nothing to hide.
 *
 * @param before the window's bounds now
 * @param after the bounds the fit is about to set
 * @param visible the window is on screen
 * @returns true when the window moves or resizes while shown
 */
export function overlayMoveHides({
  before,
  after,
  visible,
}: {
  before: Bounds;
  after: Bounds;
  visible: boolean;
}): boolean {
  const moves =
    before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height;
  return visible && moves;
}

/**
 * The window's level for a placement. Whole and corner share one level now ({@link WHOLE_LEVEL} says why), kept as a
 * function so a fit still asks it, and a level that ever differs again takes effect only on a change.
 *
 * @param placement where the fit put the window
 * @returns the level to set
 */
export function overlayLevel({ placement }: { placement: OverlayPlacement }): OverlayLevel {
  return placement.whole ? WHOLE_LEVEL : CORNER_LEVEL;
}

/**
 * What one mode looks like natively. Vibrancy is window-wide, so left on behind the collapsed orb it would blur
 * the entire desktop even with the page transparent.
 *
 * @param mode the voice's view
 * @returns the native presentation
 */
export function overlayPresentation({ mode }: { mode: OverlayMode }): OverlayPresentation {
  if (mode === "expanded") {
    return { focus: true, vibrancy: "under-window" };
  }
  return { focus: false, vibrancy: null };
}

/**
 * Whether the window takes the pointer: always while the stage is up, because while it has the owner's focus it is modal
 * and owns the work area; otherwise only while the pointer is over one of the voice's own controls, so every other
 * click lands on whatever the owner is working in underneath.
 *
 * A drag of the messenger's edge keeps the pointer from its press to its release wherever the pointer goes, since the
 * page's own pointer capture cannot hold a window that has stopped taking the pointer.
 *
 * @param mode the voice's view
 * @param overInteractive the pointer is over an element marked `data-overlay-interactive`
 * @param manipulating the owner is dragging the messenger's edge
 * @returns true to take the pointer, false to pass it through
 */
export function overlayCapturesPointer({
  mode,
  overInteractive,
  manipulating,
}: {
  mode: OverlayMode;
  overInteractive: boolean;
  manipulating: boolean;
}): boolean {
  return mode === "expanded" || overInteractive || manipulating;
}

/**
 * Where the pointer sits in the page after a fit moved the window under it, in the page's CSS pixels, so the page
 * can hit-test a pointer that has not moved. A press on the orb opens its messenger, which turns the window from its
 * corner to the whole display; the page drops the pointer on that resize, and with the pointer resting on the orb no
 * move came to take it again, so the window passed the second press through to the wallpaper beneath it and macOS
 * revealed the desktop. `undefined` while the pointer is off the window, which a
 * move onto it re-tests by itself, and for a zoom no page can have, which no point can be placed by.
 *
 * @param cursor the pointer's screen position, in screen points
 * @param bounds the window's bounds after the fit, in screen points
 * @param zoomFactor the page's zoom, which turns screen points into its CSS pixels
 * @returns the pointer's position in the page, or `undefined` when it is not over the window
 */
export function pointerInOverlay({
  bounds,
  cursor,
  zoomFactor,
}: {
  bounds: Bounds;
  cursor: { readonly x: number; readonly y: number };
  zoomFactor: number;
}): { readonly x: number; readonly y: number } | undefined {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return undefined;
  }
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
    return undefined;
  }
  return { x: x / zoomFactor, y: y / zoomFactor };
}

/**
 * How far a report's viewport, scaled to screen points, may sit from the window's own size and still describe it,
 * screen points: the window's bounds are whole points while the page's CSS viewport at a fractional zoom is not.
 */
export const VIEWPORT_SLACK = 2;

/**
 * Where the voice's own controls sit on the owner's screen, from the page's last controls report, so main can take the
 * pointer the moment the owner's cursor is over one (`overlayPointerShell.ts`). The page's own hit test needs a forwarded move
 * to reach a renderer that may be busy mid-call, and the click that came before it went through to the wallpaper,
 * which macOS took as "reveal the desktop": clicking the orb while Slopweaver is not the focused desktop app hid
 * everything and showed the desktop.
 *
 * A report measured in a viewport the window no longer has — a fit resized it and the page has not reported again —
 * or under a zoom no page can have cannot be placed at all, which is `undefined` and never "no controls": the watch
 * then judges nothing, where an empty list is a judgement that the cursor is off every control. Each box
 * is clipped to the window, and one clipped away is dropped.
 *
 * @param bounds the overlay window's bounds now, screen points
 * @param report the page's last controls report
 * @param zoomFactor the page's zoom, which turns its CSS pixels into screen points
 * @returns each control's box on screen, screen points, or `undefined` when the report cannot be placed
 */
export function overlayControlBounds({
  bounds,
  report,
  zoomFactor,
}: {
  bounds: Bounds;
  report: OverlayControlsReport;
  zoomFactor: number;
}): readonly Bounds[] | undefined {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return undefined;
  }
  const { viewport } = report;
  const fits =
    Math.abs(viewport.width * zoomFactor - bounds.width) <= VIEWPORT_SLACK &&
    Math.abs(viewport.height * zoomFactor - bounds.height) <= VIEWPORT_SLACK;
  if (!fits) {
    return undefined;
  }
  const placed: Bounds[] = [];
  for (const box of report.boxes) {
    const left = Math.max(bounds.x, bounds.x + box.left * zoomFactor);
    const top = Math.max(bounds.y, bounds.y + box.top * zoomFactor);
    const right = Math.min(bounds.x + bounds.width, bounds.x + (box.left + box.width) * zoomFactor);
    const bottom = Math.min(bounds.y + bounds.height, bounds.y + (box.top + box.height) * zoomFactor);
    if (right > left && bottom > top) {
      placed.push({ height: bottom - top, width: right - left, x: left, y: top });
    }
  }
  return placed;
}

/**
 * Whether a screen point is over one of the voice's controls: inside a box's left and top edges, outside its right and
 * bottom ones, so two boxes that touch never both claim the line between them.
 *
 * @param boxes each control's box on screen ({@link overlayControlBounds})
 * @param point the cursor, screen points
 * @returns true when the point is over one
 */
export function pointOnControl({
  boxes,
  point,
}: {
  boxes: readonly Bounds[];
  point: { readonly x: number; readonly y: number };
}): boolean {
  return boxes.some(
    (box) => point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height,
  );
}

/**
 * How many readings in a row the watch must see the cursor off every control, while the page still says "over", before
 * it drops the page's answer: three readings, about 48 ms. A chosen bound, not a measured one — long enough that a
 * control the page sees a frame before its report reaches main is not dropped and taken back in a flap, short enough
 * that a hung page holds clicks outside every control for a blink rather than for good.
 */
const PAGE_STALE_READINGS = 3;

/**
 * One reading of main's cursor watch, against the two answers it holds. The watch's own answer is replaced. The page's
 * is dropped once it has disagreed for {@link PAGE_STALE_READINGS} readings in a row — saying "over" while the cursor
 * is off every reported control — whether or not the watch ever saw the cursor on one: a page too busy to hear the
 * move off would otherwise keep the window taking clicks outside every control. The
 * reported boxes cover whatever a control draws outside itself (`preload.ts` `reportControls`), so off all of them is
 * off every control the page's own hit test could find.
 *
 * Only boxes the page measured AFTER its answer can overrule it: until the report it sends right behind each answer has
 * arrived, a reading off every box counts nothing, because the boxes main holds may be from before a control moved
 * under the cursor and the page's own answer is then the newer one.
 *
 * A reading that could not judge — no report yet, the window hidden, the stage up, or a report measured for another
 * size mid-resize — changes nothing: the watch keeps its own answer and never counts against the page's. The orb's own
 * press resizes the window, and a release then is what passed the owner's second press to the wallpaper,
 * so a pointer either answer holds is held through the resize until a reading can judge again. The
 * residue is the hung page's own: one that never re-measures after a resize keeps a held pointer until it does.
 *
 * @param pageOver what the page last said
 * @param watchOver what the watch last said
 * @param next what this reading says: on a control, off every one, or `undefined` when it could not judge
 * @param disagreeing how many readings in a row before this one had the page saying over and the watch saying off
 * @param pageMeasured whether the controls this reading tested were reported after the page's last answer
 * @returns both answers after this reading, the disagreeing count to carry, whether either answer changed, and whether
 *   the page's was dropped and so must be told to test again
 */
export function pointerWatchStep({
  disagreeing,
  next,
  pageMeasured,
  pageOver,
  watchOver,
}: {
  disagreeing: number;
  next: boolean | undefined;
  pageMeasured: boolean;
  pageOver: boolean;
  watchOver: boolean;
}): { changed: boolean; disagreeing: number; pageDropped: boolean; pageOver: boolean; watchOver: boolean } {
  if (next === undefined) {
    return { changed: false, disagreeing: 0, pageDropped: false, pageOver, watchOver };
  }
  const on = next;
  const count = pageOver && pageMeasured && !next ? disagreeing + 1 : 0;
  const pageDropped = count >= PAGE_STALE_READINGS;
  return {
    changed: on !== watchOver || pageDropped,
    disagreeing: pageDropped ? 0 : count,
    pageDropped,
    pageOver: pageOver && !pageDropped,
    watchOver: on,
  };
}

/**
 * What the page is told once its window has lost focus and focus has settled, judged by where focus LANDED.
 *
 * **Focus went to another app: the page folds.** "fold" is a transient presentation: the page shows the orb alone
 * until the owner's next move and never writes the owner's stored window state, so whatever the owner had open comes
 * back as left.
 *
 * - **The stage does not stay over the app the owner switched to.** The window floats over every app, so a stage left
 *   up after the owner switches to their browser or cmux sits over the whole work area taking every click, and
 *   nothing the owner activates can come forward. Folding it away to the orb clears the work area.
 * - **The orb's messenger folds, with no call up.** A press on the orb opens it and gives the window focus, so its box
 *   takes the owner's typing and a click into another app is this blur, the tap elsewhere that closes it
 *   (`site/components/voice/Messenger.tsx`). What the owner typed is kept for the next press.
 *
 * **On a call the messenger stays.** Focus moves on its own mid-call — a Playwright browser the fleet opens takes it —
 * and folding then hides the messenger the owner is talking beside while the call runs on. A blur cannot say whether
 * the owner or a process moved focus, so during a call none folds the messenger; the stage still does, for the
 * reason above.
 *
 * **Focus went to one of Slopweaver's own windows: nothing is sent.** The console, the fleet window or the overlay
 * itself taking focus is the owner working WITH the voice, not leaving it (focusing the desktop app must not
 * auto-minimise the messenger). The fold is for a click into another app, and this is not one.
 *
 * A retiring page hides the window, which is not the owner leaving. Nor is a window being torn down, whose renderer a
 * send would throw on.
 *
 * @param callActive the voice's last report says a call is up
 * @param focusOwned a window this app owns, the overlay included, holds focus once it has settled
 * @param listening the window's page has reported itself and can take a command
 * @param live the blurred window is still the overlay and its renderer is not destroyed
 * @param mode the voice's last reported view, `undefined` before any report
 * @returns "fold" when focus went to another app off a call or off the stage, or `undefined` to send none
 */
export function overlayCommandOnBlur({
  callActive,
  focusOwned,
  listening,
  live,
  mode,
}: {
  callActive: boolean;
  focusOwned: boolean;
  listening: boolean;
  live: boolean;
  mode: OverlayMode | undefined;
}): Extract<OverlayPageCommand, "fold"> | undefined {
  if (!live || !listening || mode === undefined || focusOwned) {
    return undefined;
  }
  if (callActive && mode === "collapsed") {
    return undefined;
  }
  return "fold";
}
