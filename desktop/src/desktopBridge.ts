/**
 * The wire between the shell's two windows and the main process: which window a renderer is, and every message
 * either may send. Two windows because the voice overlays the owner's entire
 * desktop and expands and collapses at will: the console window shows the pages, and a transparent window
 * over the whole work area owns the ONE voice call (`overlayWindow.ts`).
 *
 * Everything here is parsed rather than trusted: the pages are local, but they are still web content, so a value
 * that is not exactly one of these shapes is dropped. The site's half of these types is `site/lib/desktopShell*.ts`
 * — a separate project, so the shape is written twice and each side checks what it receives. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import { MAX_CONSOLE_CARD_PATH } from "./consoleCardAddress";

/** Which window a renderer is: the console's pages, or the voice over the desktop. */
export type DesktopRole = "main" | "overlay";

/** Whether the voice is the full stage or the orb in the corner. */
export type OverlayMode = "collapsed" | "expanded";

/** What the tray or the console window asks of the voice: start or open it, or move it between its two views. */
export type OverlayCommand = "activate" | "collapse" | "expand";

/**
 * What the shell itself sends the voice's page: any {@link OverlayCommand}, `fold` — close the options beside the
 * orb, because the owner clicked into another app — or `hang-up`, ending the call for an update the owner pressed
 * (`updateShell.ts`). Never one the console window may ask for, so it is not parsed off a request; a page from
 * before either reads it as no command and ignores it.
 */
export type OverlayPageCommand = OverlayCommand | "fold" | "hang-up";

/**
 * The console page the owner is on, so the voice in the other window still knows it — and the card they have open
 * there, which every word they say lands on (`docs/console/card-landing.md`). Without `open` the voice window's speech
 * lands on no card.
 */
export interface DesktopPageIdentity {
  readonly path: string;
  readonly title: string;
  readonly open?: string;
  /** That card's title as the page drew it, for the messenger band: a bounded line nothing here parses or sends on. */
  readonly openTitle?: string;
  /**
   * What the page body registered for the voice's `read_page`, as the console window's own `pageRead` fitted it: a
   * JSON string the shell never parses, `null` when the page registers none. Absent from a console built before it,
   * which the voice's window says rather than calling the page empty.
   */
  readonly reading?: string | null;
}

/**
 * The longest page reading the shell carries, in UTF-16 code units: the console fits it to the 16 KiB `read_page`
 * bound in UTF-8 bytes first (`site/lib/pageVoice.ts` `PAGE_READ_MAX_BYTES`), so this only stops a runaway message.
 */
export const PAGE_READING_WIRE_MAX_CHARS = 24 * 1024;

/** Where the voice stands, as the overlay reports it. */
export interface OverlayStatus {
  readonly callActive: boolean;
  readonly mode: OverlayMode;
}

/**
 * How much of the work area the voice needs drawn, as the overlay reports it (`overlayWindow.ts` sizes the window
 * from it). Its own message rather than two more status fields, because an app from before it reads a status with
 * any other key as no status at all and would never show the voice.
 */
export interface OverlayExtent {
  /** Something it draws spans the display: the stage, a screen focus, or the edge glow a page from before the strips draws. */
  readonly wholeArea: boolean;
  /** CSS pixels from the window's bottom edge up to the top of the widget in the corner. */
  readonly height: number;
  /**
   * How many times the page has asked for the whole work area, echoed back with the shell's word on it, so a word
   * the shell sent before the latest ask cannot open the stage in the corner.
   */
  readonly asks: number;
}

/**
 * The shell's word to the overlay's page after every fit: whether the window is whole — the primary display, menu bar
 * and Dock included — and the asks it has seen.
 */
export interface OverlayArea {
  readonly whole: boolean;
  /** {@link OverlayExtent.asks} of the last extent applied; 0 before the page has reported one. */
  readonly asks: number;
}

/**
 * Where the work area sits inside the overlay's window, in the page's CSS pixels from each edge: the menu bar above it
 * and the Dock beside it while the window is the whole display, zero in the corner. Its own message rather than two
 * more fields on {@link OverlayArea}, because a page from before it reads an area word with any other key as no word
 * at all and would never draw its stage.
 */
export interface OverlayInset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * The argument a window's renderer is started with, naming its role. The sandboxed preload can import nothing,
 * so it reads this prefix with its own copy of the string; `preload.ts` says so beside it.
 */
export const ROLE_ARGUMENT = "--slopweaver-role=";

/**
 * The argument a window's renderer is started with when the app is the desktop TEST instance
 * (`--slopweaver-desktop-e2e=<dir>`), so the page marks every call it places as the walk's, never the owner's. The preload
 * matches only `${INSTANCE_ARGUMENT}e2e` exactly, with its own copy of the string.
 */
export const INSTANCE_ARGUMENT = "--slopweaver-instance=";

/**
 * The renderer arguments that mark a window as the test instance's: the exact marker, or none on the owner's own app.
 *
 * @param e2e whether this launch is the desktop test instance
 * @returns the arguments to add to the window's `additionalArguments`
 */
export function instanceArguments({ e2e }: { e2e: boolean }): readonly string[] {
  if (!e2e) {
    return [];
  }
  return [`${INSTANCE_ARGUMENT}e2e`];
}

/** The longest page title or open key carried across; a page's own title is a line, never a document. */
const MAX_TEXT = 512;

/**
 * The longest page path carried back, with headroom over any card address the shell loads: the load adds the shell's
 * own `sw-surface` flag and the page reports its whole address. A path refused here would leave the overlay
 * holding the page before it, so a card the voice opened over one the owner had open would read as theirs; twice the load bound only stops a runaway report.
 */
const MAX_PAGE_PATH = MAX_CONSOLE_CARD_PATH * 2;

/**
 * One command off the wire.
 *
 * @param value what was sent
 * @returns the command, or `undefined` when it is not one
 */
export function parseOverlayCommand({ value }: { value: unknown }): OverlayCommand | undefined {
  if (value === "activate" || value === "collapse" || value === "expand") {
    return value;
  }
  return undefined;
}

/**
 * One status report off the wire.
 *
 * @param value what was sent
 * @returns the status, or `undefined` when it is not exactly one
 */
export function parseOverlayStatus({ value }: { value: unknown }): OverlayStatus | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { callActive, mode } = value;
  if (typeof callActive !== "boolean" || (mode !== "collapsed" && mode !== "expanded")) {
    return undefined;
  }
  return { callActive, mode };
}

/**
 * One extent report off the wire.
 *
 * @param value what was sent
 * @returns the extent, or `undefined` when it is not exactly one with a finite, non-negative height and a whole,
 *   non-negative count of asks
 */
export function parseOverlayExtent({ value }: { value: unknown }): OverlayExtent | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    return undefined;
  }
  const { asks, height, wholeArea } = value;
  if (typeof wholeArea !== "boolean" || typeof height !== "number" || !Number.isFinite(height) || height < 0) {
    return undefined;
  }
  if (typeof asks !== "number" || !Number.isSafeInteger(asks) || asks < 0) {
    return undefined;
  }
  return { asks, height, wholeArea };
}

/**
 * How wide the corner must be for the messenger the owner sized (`site/lib/messengerSize.ts`), and whether they are
 * dragging an edge right now. Its own message, for the reason {@link OverlayExtent} gives: a shell from before it never
 * hears it and keeps `CORNER_WIDTH`, and a page from before it never sends it.
 */
export interface OverlayWidthReport {
  /** The corner's width, CSS pixels: the card's and the clearance around it. */
  readonly width: number;
  /** An edge is being dragged: the corner takes the room the drag can reach, and keeps the pointer until it ends. */
  readonly manipulating: boolean;
}

/** The widest corner a report may ask for, CSS pixels — wider than any display; past it the report is corrupt. */
const MAX_OVERLAY_WIDTH = 16_384;

/**
 * One width report off the wire.
 *
 * @param value what was sent
 * @returns the report, or `undefined` when it is not exactly one with a finite width in bounds
 */
export function parseOverlayWidthReport({ value }: { value: unknown }): OverlayWidthReport | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { manipulating, width } = value;
  if (typeof manipulating !== "boolean" || typeof width !== "number" || !Number.isFinite(width)) {
    return undefined;
  }
  if (width <= 0 || width > MAX_OVERLAY_WIDTH) {
    return undefined;
  }
  return { manipulating, width };
}

/**
 * Where the owner dragged the presence orb and the box the widget draws there (`site/lib/desktopShellPlace.ts`), so
 * the corner can sit anywhere on the work area with nothing off screen. Its
 * own message, for the reason {@link OverlayExtent} gives: a shell from before it never hears it and keeps its corner,
 * and a page from before it never sends it.
 */
export interface OverlayPlaceReport {
  /** The orb's centre, CSS pixels from the work area's right and bottom edges; `null` where it has always rested. */
  readonly anchor: { readonly right: number; readonly bottom: number } | null;
  /** The widget's box with its slack, CSS pixels, and the orb's centre inside it: what the window crops round at rest. */
  readonly frame: { readonly width: number; readonly height: number; readonly orbX: number; readonly orbY: number };
  /** The orb is being dragged: the window takes the work area, and keeps the pointer until the drag ends. */
  readonly manipulating: boolean;
}

/**
 * Where the work area's right and bottom edges sit in from the overlay window's own, CSS pixels, sent beside every
 * fit: positive where the window runs past the work area (the whole display, or a corner down into the Dock's strip),
 * negative where it is cropped inside it, so the page draws an orb at its place whichever window holds it.
 */
export interface OverlayOrigin {
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where the orb rests when it has no place of its own: its centre's height above the work area's bottom edge, CSS
 * pixels, negative where it rests level with a Dock below the work area (`overlayPlace.ts` `overlayHome`). Its own
 * channel, so a page from before it never hears it and keeps its drag inside the work area.
 */
export interface OverlayHome {
  readonly bottom: number;
}

/**
 * Whether a value is a finite number between two bounds, inclusive.
 *
 * @param value what was sent
 * @param low the smallest it may be
 * @param high the largest it may be
 * @returns true when it is one
 */
function between({ value, low, high }: { value: unknown; low: number; high: number }): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
}

/**
 * The place half of a place report: `null`, or exactly two distances in bounds — the right one non-negative, the
 * bottom one of either sign, since the orb may be dragged back down level with a Dock below the work area
 * (`OverlayHome`). The window is clamped to the screen whatever the place says.
 *
 * @param value what was sent as the report's anchor
 * @returns the anchor, `null` for the default, or `undefined` when it is neither
 */
function parsePlaceAnchor({ value }: { value: unknown }): OverlayPlaceReport["anchor"] | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { bottom, right } = value;
  if (typeof bottom !== "number" || typeof right !== "number") {
    return undefined;
  }
  const inBounds =
    between({ high: MAX_OVERLAY_WIDTH, low: 0, value: right }) &&
    between({ high: MAX_OVERLAY_WIDTH, low: -MAX_OVERLAY_WIDTH, value: bottom });
  return inBounds ? { bottom, right } : undefined;
}

/**
 * One place report off the wire.
 *
 * @param value what was sent
 * @returns the report, or `undefined` when it is not exactly one: a place of two non-negative distances in bounds or
 *   `null`, a frame in bounds with the orb inside it, and a boolean
 */
export function parseOverlayPlaceReport({ value }: { value: unknown }): OverlayPlaceReport | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    return undefined;
  }
  const { anchor: sentAnchor, frame: sentFrame, manipulating } = value;
  const anchor = parsePlaceAnchor({ value: sentAnchor });
  if (typeof manipulating !== "boolean" || anchor === undefined) {
    return undefined;
  }
  if (!isRecord(sentFrame) || Object.keys(sentFrame).length !== 4) {
    return undefined;
  }
  const { height, orbX, orbY, width } = sentFrame;
  if (typeof width !== "number" || typeof height !== "number" || typeof orbX !== "number" || typeof orbY !== "number") {
    return undefined;
  }
  const sized = [width, height].every((side) => between({ high: MAX_OVERLAY_WIDTH, low: 1, value: side }));
  const orbInside = between({ high: width, low: 0, value: orbX }) && between({ high: height, low: 0, value: orbY });
  if (!sized || !orbInside) {
    return undefined;
  }
  return { anchor, frame: { height, orbX, orbY, width }, manipulating };
}

/**
 * The call the overlay's page holds, as it reports it, so main still knows which call was up when the renderer dies
 * and can hand the page it reloads what to end and what to reconnect (`overlayRecovery.ts`). The transcript's id
 * exists from the moment a call opens; the plan call's only once the console minted it. Its own message rather than
 * more status fields, for the reason {@link OverlayExtent} gives.
 */
export interface OverlayCall {
  readonly transcriptCallId: string;
  readonly planCallId: string | null;
}

/** A call id as the console mints one: a UUID, lower or upper case (`site/lib/talkTranscript.ts` `isCallId`). */
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * One call report off the wire: `null` is no call up.
 *
 * @param value what was sent
 * @returns the call, `null` for none, or `undefined` when it is neither exactly
 */
export function parseOverlayCall({ value }: { value: unknown }): OverlayCall | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { planCallId, transcriptCallId } = value;
  if (typeof transcriptCallId !== "string" || !CALL_ID.test(transcriptCallId)) {
    return undefined;
  }
  if (planCallId !== null && (typeof planCallId !== "string" || !CALL_ID.test(planCallId))) {
    return undefined;
  }
  return { planCallId, transcriptCallId };
}

/** The keys a page may send in its identity, and no other. */
const PAGE_IDENTITY_KEYS: ReadonlySet<string> = new Set(["path", "title", "open", "openTitle", "reading"]);

/**
 * One page identity off the wire: a console path and a title, the open card's key when one is open, each one bounded
 * line, and the page body's reading when the console carries it — a bounded string kept opaque, or `null`. The voice's
 * page checks the key's shape and parses the reading itself, bar one: a bare `pr:<number>` ({@link PR_CARD_KEY}) names
 * whichever repository's pull request shared the number, so it is dropped here and the page alone carried, as
 * `site/lib/desktopShell.ts`'s `pageIdentityOf` does.
 *
 * @param value what was sent
 * @returns the identity, or `undefined` when it is not exactly one
 */
export function parsePageIdentity({ value }: { value: unknown }): DesktopPageIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  const { open, openTitle, path, reading, title } = value;
  if (!keys.every((key) => PAGE_IDENTITY_KEYS.has(key)) || typeof path !== "string" || typeof title !== "string") {
    return undefined;
  }
  const bounded = path.length <= MAX_PAGE_PATH && title.length <= MAX_TEXT && !/[\r\n]/u.test(title);
  if (!bounded || !path.startsWith("/") || path.startsWith("//") || /[\r\n]/u.test(path)) {
    return undefined;
  }
  let identity: DesktopPageIdentity = { path, title };
  if ("open" in value) {
    if (typeof open !== "string" || open === "" || open.length > MAX_TEXT || /[\r\n]/u.test(open)) {
      return undefined;
    }
    if (!open.startsWith("pr:") || PR_CARD_KEY.test(open)) {
      identity = { ...identity, open };
    }
  }
  if ("openTitle" in value) {
    if (typeof openTitle !== "string" || openTitle === "" || openTitle.length > MAX_TEXT || /[\r\n]/u.test(openTitle)) {
      return undefined;
    }
    // A title belongs to a card: one whose key was dropped above leaves nothing for it to name.
    if (identity.open !== undefined) {
      identity = { ...identity, openTitle };
    }
  }
  if ("reading" in value) {
    const carried = reading === null || (typeof reading === "string" && reading.length <= PAGE_READING_WIRE_MAX_CHARS);
    if (!carried) {
      return undefined;
    }
    identity = { ...identity, reading };
  }
  return identity;
}

/**
 * The console window's answer to one request to go to a page in place (`moveOnShow`, `surface.ts`): the request's
 * id, and whether the page took it. The preload answers for the document that received the request, so an answer
 * can never speak for a page loaded after it; a page from before this answers `taken: false` and is loaded whole.
 */
export interface NavigationAck {
  readonly id: string;
  readonly taken: boolean;
}

/** The longest request id main mints; a counter's decimal digits. */
const MAX_NAVIGATION_ID = 32;

/**
 * One navigation answer off the wire.
 *
 * @param value what was sent
 * @returns the answer, or `undefined` when it is not exactly an id and a taken flag
 */
export function parseNavigationAck({ value }: { value: unknown }): NavigationAck | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { id, taken } = value;
  if (typeof id !== "string" || id === "" || id.length > MAX_NAVIGATION_ID || typeof taken !== "boolean") {
    return undefined;
  }
  return { id, taken };
}

/**
 * One failure of something the voice tried for the owner, as the console window's toast shows it (`site/lib/voiceFailureToast.ts`):
 * the one line, the reason behind its disclosure, and — only for a card that did not open — that card's key.
 */
export interface VoiceFailureNoticeWire {
  readonly summary: string;
  readonly detail: string;
  readonly cardKey?: string;
}

/** The longest one-line summary carried (`NOTICE_SUMMARY_MAX`). */
const MAX_NOTICE_SUMMARY = 200;

/** The longest reason carried (`NOTICE_WIRE_DETAIL_MAX`). */
const MAX_NOTICE_DETAIL = 2000;

/**
 * A card key a failure toast may open — `site/lib/desktopShell.ts`'s `QUEUE_CARD_KEY`, restated because `site/` is
 * another project: a Queue kind, one colon, then a bounded id with nothing that could leave the `open` parameter.
 */
const QUEUE_CARD_KEY = /^(ask|hand|draft|post|review|import|pr|act):[A-Za-z0-9._-]{1,160}$/u;

/**
 * A pull request's key names its repository: `pr:<owner>.<repo>.<number>`, `site/lib/prCardKey.ts`'s grammar restated.
 * A bare `pr:<number>` names whichever repository's pull request shared the number, so it opens nothing.
 */
const PR_CARD_KEY = /^pr:[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[1-9][0-9]*$/u;

/** Whether a key names one Queue card: {@link QUEUE_CARD_KEY}, and {@link PR_CARD_KEY} for a pull request. */
function isQueueCardKey({ key }: { key: string }): boolean {
  return QUEUE_CARD_KEY.test(key) && (!key.startsWith("pr:") || PR_CARD_KEY.test(key));
}

/**
 * A voice failure the shell forwards to the console window, when the voice's window sent it: exactly a non-empty
 * bounded one-line summary and a bounded reason, plus a card key when a card did not open. A failure the owner
 * would otherwise only hear about from the voice is shown inside the app's own window, never over other apps.
 *
 * @param role which window sent it, or `undefined` when the sender is neither
 * @param value what was sent
 * @returns the notice to forward, or `undefined` when it is not exactly one from the voice's window
 */
export function parseVoiceFailureNotice({
  role,
  value,
}: {
  role: DesktopRole | undefined;
  value: unknown;
}): VoiceFailureNoticeWire | undefined {
  if (role !== "overlay" || !isRecord(value)) {
    return undefined;
  }
  const fields = Object.keys(value).toSorted().join(",");
  if (fields !== "detail,summary" && fields !== "cardKey,detail,summary") {
    return undefined;
  }
  const { cardKey, detail, summary } = value;
  if (typeof summary !== "string" || typeof detail !== "string") {
    return undefined;
  }
  if (summary.trim() === "" || summary.length > MAX_NOTICE_SUMMARY || /[\r\n]/u.test(summary)) {
    return undefined;
  }
  if (detail.length > MAX_NOTICE_DETAIL) {
    return undefined;
  }
  if (!("cardKey" in value)) {
    return { detail, summary };
  }
  if (typeof cardKey !== "string" || !isQueueCardKey({ key: cardKey })) {
    return undefined;
  }
  return { cardKey, detail, summary };
}

/**
 * The console path the failure toast's "Open in new tab" opens as a new tab in this app: the card's page —
 * `/alignment` for an act, `/queue` for every other card, as `src/hand/consoleLink.ts` builds it — and the key as its one
 * `open` parameter. The toast's call to action deep-links to the Queue card,
 * and queue cards and briefings open inside the desktop app in new tabs, so the card opens here and never in the
 * owner's browser.
 *
 * Least privilege: only the console window may ask, and it sends a key and never a path, so no page can steer a tab
 * anywhere but one of the owner's own console's cards.
 *
 * @param role which window asked
 * @param value what it sent: the card's key
 * @returns the console path, or why it will not be opened
 */
export function queueCardTabPath({
  role,
  value,
}: {
  role: DesktopRole | undefined;
  value: unknown;
}): Result<string, string> {
  if (role !== "main") {
    return err("only the console window may open a card in a new tab");
  }
  if (typeof value !== "string" || !isQueueCardKey({ key: value })) {
    return err("not a card key");
  }
  let page = "/queue";
  if (value.startsWith("act:")) {
    page = "/alignment";
  }
  return ok(`${page}?${new URLSearchParams({ open: value }).toString()}`);
}

/**
 * Whether a value is a plain object, so its fields can be read by name — the shell's one guard for every message
 * a renderer sends and every file it reads back.
 *
 * @returns true for a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
