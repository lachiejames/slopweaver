/**
 * The console's side of the desktop shell (`desktop/`). In the shell the console is drawn in two windows: `main`,
 * the pages, and `overlay`, a transparent window over the owner's whole desktop that owns the ONE voice call, which can be
 * expanded and collapsed at will. In a browser there is no shell, and nothing here changes what the console
 * does.
 *
 * The shell's preload puts one object on the page, `window.slopweaverDesktop`. Its shape is written here and in
 * `desktop/src/desktopBridge.ts` — two projects, so twice — and each side checks what it receives: this module
 * accepts the object only when every method the console calls is a function. Pure.
 */
import { type CarriedPageReading, carriedReadingOf, type DesktopPageIdentityWire } from "./desktopPageReading";
import { GLOW_OPTIONAL_METHODS, type GlowBridge } from "./desktopShellGlow";
import type { OverlayCommand, OverlayExtent, OverlayStatus } from "./desktopShellOverlay";
import { PLACE_OPTIONAL_METHODS, type PlaceBridge } from "./desktopShellPlace";
import type { UpdateBridge, UpdateOfferWire } from "./desktopShellUpdate";
import { isRecord } from "./desktopShellWire";
import type { OverlayCall } from "./overlayCrashRecovery";
import { openKeyOf } from "./pageVoice";
import { prCardKeyParts } from "./prCardKey";
import type { FocusFractions } from "./screenFocus";
import { TRIAGE_OPTIONAL_METHODS, type TriageBridge } from "./triageBridge";
import type { VoiceFailureNotice } from "./voiceFailureToast";

/** Where the console is drawn: a browser, the shell's console window, or the shell's voice over the desktop. */
export type DesktopRole = "browser" | "main" | "overlay";

/**
 * The console page the owner is on, carried from the console window to the voice, with the card they have open there —
 * the card every word they say lands on (`docs/console/card-landing.md`). Without the card, nothing said in the voice
 * window lands on any card.
 */
export interface DesktopPageIdentity {
  readonly path: string;
  readonly title: string;
  readonly open?: string;
  /** That card's title as the page drew it, for the messenger band. Never in `read_page`, a relay or a call file. */
  readonly openTitle?: string;
  /**
   * What the page body registered for `read_page`, fitted by the console window's own `pageRead`: `null` when the page
   * registers none, absent when the reading did not cross — an older shell or console — which `read_page` says rather
   * than calling the page empty. Without it the voice's window answers `read_page`
   * on `/queue` with "registers no reading of its own" while the console window's Queue registers one.
   */
  readonly reading?: CarriedPageReading | null;
}

/** The shell's object, as the console uses it. */
export interface DesktopBridge extends TriageBridge, GlowBridge, PlaceBridge {
  readonly role: "main" | "overlay";
  /**
   * The test-instance marker the shell started this window with — `e2e` for the desktop TEST instance's (`slopweaver
   * desktop e2e`). Absent on the owner's own app and under a shell from before the marker. Read it through
   * {@link bridgeInstance}, which takes any value present as the test instance's.
   */
  readonly instance?: unknown;
  readonly requestOverlay: (input: { readonly command: OverlayCommand }) => void;
  readonly onOverlayCommand: (listener: (command: unknown) => void) => () => void;
  readonly reportOverlayStatus: (input: { readonly status: OverlayStatus }) => void;
  readonly publishPageIdentity: (input: { readonly identity: DesktopPageIdentityWire }) => void;
  readonly onPageIdentity: (listener: (identity: unknown) => void) => () => void;
  /**
   * The console window: the overlay's status each time the shell hears it, `null` while no voice page reports.
   * Optional, and outside {@link METHODS}: a shell built before it is still the shell, so its console window keeps
   * handing starts to the overlay rather than reading as a browser that could open a second call.
   */
  readonly onOverlayStatus?: (listener: (status: unknown) => void) => () => void;
  /** The console window: the overlay's status now, for a page loaded after its last report. Optional as above. */
  readonly overlayStatusNow?: () => Promise<unknown>;
  /**
   * The voice's window: show the console window on one Queue or Alignment card (`./openCard.ts` `cardPagePath`), which
   * the shell checks is exactly a `/queue?open=` or `/alignment?open=` address before it loads it. Optional as above:
   * an older shell's voice says it cannot move the console rather than navigating its own `/voice` window.
   */
  readonly presentConsoleCard?: (input: { readonly path: string }) => Promise<void>;
  /**
   * A shell built before Alignment cards: the same, for a `/queue?open=` address only. Read only when
   * {@link presentConsoleCard} is absent, and never handed an Alignment card.
   */
  readonly presentQueueCard?: (input: { readonly path: string }) => Promise<void>;
  /**
   * The voice's window: one still of the owner's screen as they see it, the voice included — no share to start.
   * What comes back is read by `nativeScreenStillOf` (`./desktopShellWire.ts`). Optional as above: under an
   * older shell the voice keeps asking the owner for a share.
   */
  readonly captureScreen?: (input?: { readonly typedAsk: true }) => Promise<unknown>;
  /**
   * The voice's window: a shell that takes `{ typedAsk: true }` on {@link captureScreen} and so can look with no call.
   * Never inferred from `captureScreen` itself: an older shell has that, ignores the argument, and refuses with no call.
   */
  readonly supportsTypedScreenLook?: boolean;
  /** The voice's window: tell the shell whether the messenger is open, the one condition its band channel reads under. */
  readonly reportMessengerOpen?: (input: { readonly report: { readonly open: boolean } }) => void;
  /**
   * The voice's window: which application is in front for the messenger band, names only and only while the messenger
   * is open (`frontAppBandOf`, `./messengerBand.ts`). Optional as above: under an older shell the band keeps to the page.
   */
  readonly frontAppBand?: () => Promise<unknown>;
  /**
   * The voice's window: lift one region of the still it last took, on the owner's ask. The shell answers
   * with where to draw it in this window, read by `focusRectReplyOf` (`./desktopShellWire.ts`). Optional as above: under an older shell
   * the voice says where the thing is in words.
   */
  readonly focusRegion?: (input: { readonly region: FocusFractions }) => Promise<unknown>;
  /**
   * The voice's window: which application is in front and its window's title, names only and only during a call, for
   * the drift watch, read by `frontWindowActivityOf` (`./driftWatch.ts`). Optional as above:
   * under an older shell the voice never notices a drift.
   */
  readonly frontWindow?: () => Promise<unknown>;
  /**
   * The voice's window: how much of the work area it needs drawn (`overlayExtentOf`, `./desktopShellOverlay.ts`). Optional as above: an
   * older shell keeps its window over the whole work area, as it always did.
   */
  readonly reportOverlayExtent?: (input: { readonly extent: OverlayExtent }) => void;
  /**
   * The voice's window: how wide its corner must be for the messenger's size, CSS pixels, and whether a drag of the
   * messenger's edge holds the pointer (`../components/voice/useMessengerSize.ts`). Optional as above: under an older
   * shell the corner keeps its width and the messenger offers no edge to drag, since that shell lets the pointer go
   * once it leaves the card; the size menu still works.
   */
  readonly reportOverlayWidth?: (input: {
    readonly report: { readonly width: number; readonly manipulating: boolean };
  }) => void;
  /**
   * The voice's window: the call it holds, `null` for none (`./overlayCrashRecovery.ts`), so the shell knows what a
   * renderer death ends. Optional as above: an older shell reloads a crashed voice knowing nothing, as it always did.
   */
  readonly reportOverlayCall?: (input: { readonly call: OverlayCall | null }) => void;
  /** The voice's window: what the shell held for a call its renderer died under, read by `overlayCrashRecoveryOf`. */
  readonly takeOverlayRecovery?: () => Promise<unknown>;
  /** The voice's window: whether the shell holds it over the whole display now (`overlayAreaOf`, `./desktopShellOverlay.ts`). */
  readonly onOverlayArea?: (listener: (area: unknown) => void) => () => void;
  /**
   * The voice's window: where the work area sits inside it (`overlayInsetOf`, `./desktopShellOverlay.ts`), sent before every area word.
   * Optional as above: an older shell keeps its whole window on the work area, where no inset is right.
   */
  readonly onOverlayInset?: (listener: (inset: unknown) => void) => () => void;
  /**
   * The voice's window: how far above its bottom edge the orb rests (`overlayFloorOf`, `./desktopShellOverlay.ts`), clear of an app's own
   * bottom bar, sent beside every inset. Optional as above: an older shell rests the corner on the work area itself.
   */
  readonly onOverlayFloor?: (listener: (floor: unknown) => void) => () => void;
  /**
   * The voice's window: take the owner's keyboard, as the orb's messenger opens, so its box can be typed in and a click into
   * another app is the window's blur and folds it (`site/components/voice/Messenger.tsx`). Optional as above: under an
   * older shell a second press folds it.
   */
  readonly focusOverlay?: () => void;
  /**
   * The voice's window: leave the owner's screen while the call runs on, when they press the X on the orb; the menu bar's
   * Show voice brings it back. Optional as above: under an older shell the orb
   * draws no X (`overlayHideControlShown`, `./desktopShellOverlay.ts`).
   */
  readonly hideOverlay?: () => void;
  /**
   * The console window: register the page's own navigator, which the shell calls with a console path to go to in
   * place — the card the voice opens, the Queue from the menu bar — and which says whether it took it
   * ({@link shellNavigationPathOf}). Optional as above: under an older shell every move is a whole load, as before.
   */
  readonly onNavigate?: (listener: (path: unknown) => boolean) => () => void;
  /**
   * The console window: which commit the running app was built from and which one is installed now, read by
   * `shellBuildOf` (`./desktopShellWire.ts`). Optional as above: under an app built before it, the sidebar says the app's build is not
   * known and how to stamp it.
   */
  readonly shellBuild?: () => Promise<unknown>;
  /**
   * The console window: the shell takes a page identity carrying the open card (`./desktopPageReading.ts`). Absent under
   * an older shell, which drops an identity with any third key — so the console sends it none, and the voice there
   * keeps the page but no card.
   */
  readonly carriesOpenCard?: boolean;
  /**
   * The console window: the shell takes a page identity carrying the page's reading (`./desktopPageReading.ts`). Absent
   * under an older shell, which drops an identity with a `reading` key — so the console sends it none, and the voice
   * there says the reading did not reach it.
   */
  readonly carriesPageReading?: boolean;
  /** The console window: the shell takes a page identity carrying the open card's title, as with the two above. */
  readonly carriesOpenTitle?: boolean;
  /**
   * The voice's window: ask the console tab on screen for the Queue it holds now, answered by the shell as
   * `{ kind: "served", snapshot }` or `{ kind: "unreached", why }` (`./queueScreenVoice.ts`). Optional as above: under an
   * older shell the voice says the Queue on screen did not reach it.
   */
  readonly requestVoiceQueue?: () => Promise<unknown>;
  /** The console window: answer the voice window's ask with this page's snapshot, as a string. Optional as above. */
  readonly onVoiceQueueRequest?: (listener: () => unknown) => () => void;
  /**
   * The voice's window: hand the console window one failure of something the voice tried, for its toast
   * ({@link voiceFailureNoticeWireOf}). Optional as above: under an older shell the voice's activity record says the
   * app predates the toast.
   */
  readonly reportVoiceFailure?: (input: { readonly notice: VoiceFailureNotice }) => void;
  /** The console window: each failure the shell forwards from the voice's window. Optional as above. */
  readonly onVoiceFailure?: (listener: (notice: unknown) => void) => () => void;
  /**
   * The console window: open one card as a new tab in this app, by its key alone — the failure toast's "Open in new
   * tab", never the owner's browser. The shell builds the path itself, never one the page sends. Optional as above:
   * under an older shell the toast offers no button.
   */
  readonly openQueueCardInNewTab?: (input: { readonly key: string }) => void;
  /**
   * The console window: select one local page's `index.html` in Finder, by its slug alone, so the owner can drag it into
   * Slack. The shell rebuilds the file under its own pages directory; what it answers is read by
   * `revealReply.ts`. Optional as above: under an older shell the viewer offers no button.
   */
  readonly revealPageInFinder?: (input: { readonly slug: string }) => Promise<unknown>;
  /*
   * The console window, the one-click update (`desktop/src/updateShell.ts`, `./updateAction.ts`). Every one optional
   * as above, and the sidebar draws its Update button only under a shell that carries all of them
   * ({@link updateBridgeOf}); under an older one it names the step in words, as before.
   */
  /** End the voice call for an update, owed a restart once it settles; answers `null`, or why it could not. */
  readonly endCallForUpdate?: () => Promise<unknown>;
  /** Launch `slopweaver desktop update`; answers `null` once it runs, or why it could not. */
  readonly startUpdate?: () => Promise<unknown>;
  /** Quit and reopen the app on the build already installed. */
  readonly relaunchForUpdate?: () => void;
  /** Reload every console page onto the build the console serves now, restarting a call ended for it. */
  readonly reloadForUpdate?: () => void;
  /**
   * A swap's call ended: the shell holds the swap's deadline and reloads onto the console then, so the call restarts
   * even when this page is reloaded under the wait. Absent under a shell from before it, where the page's own deadline
   * is the only one.
   */
  readonly beginSwapForUpdate?: () => void;
  /** What the sidebar's button offers, for the menu bar to offer too; `null` for nothing. */
  readonly publishUpdateOffer?: (input: { readonly offer: UpdateOfferWire | null }) => void;
  /** The update's standing now, read by `updateStateOf` (`./desktopShellUpdate.ts`). */
  readonly updateState?: () => Promise<unknown>;
  /** Each change to the update's standing. */
  readonly onUpdateState?: (listener: (state: unknown) => void) => () => void;
  /** The menu bar's update item was clicked: do what the button does. */
  readonly onUpdateRun?: (listener: (value: unknown) => void) => () => void;
  /** The menu bar's "Check for Updates…": look again, and open the build fold. */
  readonly onUpdateCheck?: (listener: (value: unknown) => void) => () => void;
}

/**
 * The bridge's update half, when the shell carries every part of it.
 *
 * @param bridge the shell's object
 * @returns the update half, or `undefined` under a shell from before it
 */
export function updateBridgeOf({ bridge }: { bridge: DesktopBridge }): UpdateBridge | undefined {
  const {
    endCallForUpdate,
    startUpdate,
    relaunchForUpdate,
    reloadForUpdate,
    publishUpdateOffer,
    updateState,
    onUpdateState,
    onUpdateRun,
    onUpdateCheck,
  } = bridge;
  if (
    endCallForUpdate === undefined ||
    startUpdate === undefined ||
    relaunchForUpdate === undefined ||
    reloadForUpdate === undefined ||
    publishUpdateOffer === undefined ||
    updateState === undefined ||
    onUpdateState === undefined ||
    onUpdateRun === undefined ||
    onUpdateCheck === undefined
  ) {
    return undefined;
  }
  const required = {
    endCallForUpdate,
    onUpdateCheck,
    onUpdateRun,
    onUpdateState,
    publishUpdateOffer,
    relaunchForUpdate,
    reloadForUpdate,
    startUpdate,
    updateState,
  };
  // The one part an older shell may lack and still update: the swap falls back on the page's own deadline.
  const { beginSwapForUpdate } = bridge;
  if (beginSwapForUpdate === undefined) {
    return required;
  }
  return { ...required, beginSwapForUpdate };
}

/**
 * A card key a failure toast may offer to open: `site/lib/cardKey.ts`'s `CARD_KEY` without `recipe:`, `align:` and `candidate:`,
 * which name no Queue card. `desktop/src/desktopBridge.ts` restates it, since neither project imports the other.
 */
export const QUEUE_CARD_KEY = /^(ask|hand|draft|post|review|import|pr|act):[A-Za-z0-9._-]{1,160}$/u;

/** The longest one-line summary the shell carries. */
export const NOTICE_SUMMARY_MAX = 200;

/** The longest reason the shell carries: the classifier's own bound, with room for its ellipsis. */
export const NOTICE_WIRE_DETAIL_MAX = 2000;

/**
 * One voice failure off the shell (`desktop/src/desktopBridge.ts` `parseVoiceFailureNotice`): exactly a non-empty
 * one-line summary and a reason that may be empty, each bounded, plus — only on a card that did not open — that card's
 * {@link QUEUE_CARD_KEY}. Any other field, or a `cardKey` that is present but not a key — a bare `pr:<number>` naming
 * no repository included — refuses the whole notice.
 *
 * @param value what the shell sent
 * @returns the notice, or `undefined` when it is not exactly one
 */
export function voiceFailureNoticeWireOf({ value }: { value: unknown }): VoiceFailureNotice | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
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
  if (summary.trim() === "" || summary.length > NOTICE_SUMMARY_MAX || /[\r\n]/u.test(summary)) {
    return undefined;
  }
  if (detail.length > NOTICE_WIRE_DETAIL_MAX) {
    return undefined;
  }
  if (!("cardKey" in value)) {
    return { detail, summary };
  }
  const barePr =
    typeof cardKey === "string" && cardKey.startsWith("pr:") && prCardKeyParts({ key: cardKey }) === undefined;
  if (typeof cardKey !== "string" || !QUEUE_CARD_KEY.test(cardKey) || barePr) {
    return undefined;
  }
  return { cardKey, detail, summary };
}

/** The longest path the shell may ask the console window to go to — its own cap on a Queue card's address. */
const MAX_NAVIGATION_PATH = 8192;

/**
 * A console path the shell asked the console window to go to in place (`desktop/src/surface.ts` `moveOnShow`):
 * exactly a same-origin path — `/` then no second slash, no backslash, whitespace or control character, bounded —
 * never the voice's own page. A card the voice opens must not reload the whole app
 * out from under a briefing the owner is reading; a path taken here is a navigation the page performs itself instead.
 *
 * @param value what the shell sent
 * @returns the path to push, or `undefined` when it is not exactly one
 */
export function shellNavigationPathOf({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || value.length > MAX_NAVIGATION_PATH) {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//") || /[\s\\\p{Cc}]/u.test(value)) {
    return undefined;
  }
  const { pathname } = new URL(value, "http://localhost:1");
  if (pathname === "/voice") {
    return undefined;
  }
  return value;
}

/** The methods the console calls; an object missing any one of them is not the shell. */
const METHODS = [
  "requestOverlay",
  "onOverlayCommand",
  "reportOverlayStatus",
  "publishPageIdentity",
  "onPageIdentity",
] as const;

/** The methods a newer shell adds; each is absent or a function, never anything else. */
const OPTIONAL_METHODS = [
  "onOverlayStatus",
  "overlayStatusNow",
  "presentConsoleCard",
  "presentQueueCard",
  "captureScreen",
  "focusRegion",
  "frontWindow",
  "frontAppBand",
  "reportMessengerOpen",
  "reportOverlayExtent",
  "reportOverlayWidth",
  "reportOverlayCall",
  "takeOverlayRecovery",
  "onOverlayArea",
  "onOverlayInset",
  "onOverlayFloor",
  "focusOverlay",
  "hideOverlay",
  "onNavigate",
  "shellBuild",
  "reportVoiceFailure",
  "onVoiceFailure",
  "openQueueCardInNewTab",
  "revealPageInFinder",
  "endCallForUpdate",
  "startUpdate",
  "relaunchForUpdate",
  "reloadForUpdate",
  "beginSwapForUpdate",
  "publishUpdateOffer",
  "updateState",
  "onUpdateState",
  "onUpdateRun",
  "onUpdateCheck",
  "requestVoiceQueue",
  "onVoiceQueueRequest",
  ...TRIAGE_OPTIONAL_METHODS,
  ...GLOW_OPTIONAL_METHODS,
  ...PLACE_OPTIONAL_METHODS,
] as const;

/** Whether a value carries the shell's role and every method the console calls. */
function isDesktopBridge(value: unknown): value is DesktopBridge {
  if (!isRecord(value) || (value["role"] !== "main" && value["role"] !== "overlay")) {
    return false;
  }
  const flags = [
    value["carriesOpenCard"],
    value["carriesPageReading"],
    value["carriesOpenTitle"],
    value["supportsTypedScreenLook"],
  ];
  // Any test-instance marker keeps the bridge: `bridgeInstance` reads every one present as the test instance's.
  return (
    METHODS.every((method) => typeof value[method] === "function") &&
    OPTIONAL_METHODS.every((method) => value[method] === undefined || typeof value[method] === "function") &&
    flags.every((flag) => flag === undefined || typeof flag === "boolean")
  );
}

/**
 * The marker every call this window places carries: `e2e` whenever the shell passed one at all. A value it did not spell
 * exactly is still a window that is not the owner's app, so it is read as the test instance's rather than dropped into the
 * owner's own, where refusing the bridge would leave the page posting as a plain browser does.
 *
 * @param bridge the shell's object
 * @returns `e2e` for a window the shell marked, `undefined` on the owner's own app
 */
export function bridgeInstance({ bridge }: { bridge: DesktopBridge }): "e2e" | undefined {
  return bridge.instance === undefined ? undefined : "e2e";
}

/**
 * The shell's object, when the value is one.
 *
 * @param value what `window.slopweaverDesktop` holds
 * @returns the bridge, or `undefined` in a browser or for anything that is not exactly the shell's
 */
export function desktopBridgeOf({ value }: { value: unknown }): DesktopBridge | undefined {
  return isDesktopBridge(value) ? value : undefined;
}

/**
 * Where the console is drawn.
 *
 * @param bridge the shell's object, when there is one
 * @returns `browser` with no shell, else the window's role
 */
export function desktopRoleOf({ bridge }: { bridge: DesktopBridge | undefined }): DesktopRole {
  return bridge === undefined ? "browser" : bridge.role;
}

/**
 * One page identity off the shell. An open card whose key is not a card key's shape ({@link openKeyOf}) is dropped
 * and the page kept, so a word the owner says there lands on no card rather than on a key nothing can name. A reading that is
 * not exactly one the console fitted is dropped the same way and reads as one that did not cross, never as a page
 * with none; `null` stays the page's own word that it registers none.
 *
 * @param value what the shell sent
 * @returns the identity, or `undefined` when it is not one
 */
export function pageIdentityOf({ value }: { value: unknown }): DesktopPageIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const path = value["path"];
  const title = value["title"];
  const raw = value["open"];
  if (typeof path !== "string" || typeof title !== "string" || !path.startsWith("/")) {
    return undefined;
  }
  let identity: DesktopPageIdentity = { path, title };
  if (typeof raw === "string") {
    const open = openKeyOf({ open: raw });
    if (open !== undefined) {
      identity = { ...identity, open };
      const openTitle = value["openTitle"];
      if (typeof openTitle === "string" && openTitle !== "") {
        identity = { ...identity, openTitle };
      }
    }
  }
  if ("reading" in value) {
    const reading = carriedReadingOf({ raw: value["reading"] });
    if (reading !== undefined) {
      identity = { ...identity, reading };
    }
  }
  return identity;
}
