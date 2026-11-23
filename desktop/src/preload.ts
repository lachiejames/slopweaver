/**
 * The preload for both of the shell's windows, sandboxed and context-isolated. The window's role — `main`, the
 * console's pages, or `overlay`, the voice over the owner's whole desktop — arrives on the renderer's command line, and
 * the preload:
 *
 * 1. Stamps `<html data-shell="main|overlay">`, so the console can tell where it is drawn. The overlay's page and
 *    ground stay transparent under that attribute, so the owner's desktop shows round the orb; its panels are opaque. Beside it,
 *    `data-window-controls="inset|none"` says whether macOS's window buttons sit over the page with no title strip
 *    (`windowChrome.ts`); it arrives on the command line and again over IPC as the window enters or leaves full
 *    screen, so the sidebar's top row makes room for the buttons only while they are there.
 * 2. Watches the capture tracks the page opens — a screen share (a page from before the voice saw the owner's screen natively,
 *    `captureScreen` below), a microphone — from the page's own world, and
 *    reports each one acquired or released (`mediaCounts.ts` keeps the ledger in the main process). The site stops
 *    a share with `track.stop()`, which fires no `ended`, so `stop` is wrapped too.
 * 3. In the overlay, carries the page's edge-glow report (`reportOverlayGlow`) to the four screen-edge strips main
 *    draws it in (`edgeGlowShell.ts`), which also draw a live share's amber frame and badge round the owner's whole display, so a share is always clear on screen.
 * 4. Pins the window's native appearance to the console's own light/dark choice (`data-sw-mode`), never the
 *    system's: the console's setting is independent of macOS system settings.
 * 5. In the overlay only, reports whether the pointer is over one of the voice's own controls
 *    (`data-overlay-interactive`), and where each of those controls is (`reportControls`), so the main process passes
 *    every other click through to the owner's desktop and can take a press on one without waiting on this page, and carries
 *    the page's extent report, so the window shrinks to its corner while nothing it draws needs more
 *    (`overlayWindow.ts`), and the main process's word back on whether the window is the whole work area now, where
 *    the work area sits inside it and where the orb's floor does. Its
 *    page also asks for the keyboard as the orb's options open (`focusOverlay`), so a click elsewhere folds them, and
 *    asks to leave the owner's screen when they press the X on the orb (`hideOverlay`).
 * 6. In the console window only, hands main's request to go to another page to the page's own navigator
 *    (`onNavigate`) and answers whether it was taken, so a move never reloads the page the owner is on (`moveOnShow`).
 *
 * The page gets ONE object, `window.slopweaverDesktop`, with one named method per operation — never
 * `ipcRenderer`, a channel name or an arbitrary send. The main process checks which window sent each message.
 * A sandboxed preload can require nothing but `electron`, so this file imports nothing else, and spells the
 * channel names, the role argument (`desktopBridge.ts`'s `ROLE_ARGUMENT`) and the test-instance marker
 * (`INSTANCE_ARGUMENT`) itself.
 */
import { contextBridge, ipcRenderer } from "electron";

const ROLE_ARGUMENT = "--slopweaver-role=";

/** `desktopBridge.ts`'s `INSTANCE_ARGUMENT`, spelled here for the same reason as {@link ROLE_ARGUMENT}. */
const INSTANCE_ARGUMENT = "--slopweaver-instance=";

declare global {
  interface Window {
    /** The object this preload exposes below, as the page-world capture observer reaches it. */
    readonly slopweaverDesktop?: { readonly report: (value: unknown) => void };
  }
}

/** The role this renderer was started with; a window started with none is treated as the console's. */
const role: "main" | "overlay" = process.argv.includes(`${ROLE_ARGUMENT}overlay`) ? "overlay" : "main";

/** The test-instance marker main started this renderer with, as written; absent on the owner's own app. */
const instanceArgument = process.argv.find((argument) => argument.startsWith(INSTANCE_ARGUMENT));

/**
 * `e2e` when main started this renderer as the desktop TEST instance's: the page sends it with every call batch, so a
 * call the walk places is never read as the owner's words. Any other value is passed on as written, never dropped, and the
 * console reads every marker present as the test instance's (`site/lib/desktopShell.ts` `bridgeInstance`).
 */
const instance: string | undefined = instanceArgument?.slice(INSTANCE_ARGUMENT.length);

/**
 * Subscribe a page listener to one channel.
 *
 * @param channel the channel the main process sends on
 * @param listener the page's listener, called with the payload alone
 * @returns what removes the subscription
 */
function subscribe({ channel, listener }: { channel: string; listener: (value: unknown) => void }): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
    listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/**
 * The page method that subscribes its listener to one channel, for the bridge's plain subscriptions.
 *
 * @param channel the channel the main process sends on
 * @returns the page method
 */
function hears({ channel }: { channel: string }): (listener: (value: unknown) => void) => () => void {
  return (listener) => subscribe({ channel, listener });
}

/**
 * The page method that sends main one field of its argument on a channel, or nothing at all, for the bridge's plain
 * sends. Main parses whatever arrives, so it stays the authority on what each one carries.
 *
 * @param channel the channel main listens on
 * @param field the one field of the page's argument main is sent; absent for a send that carries nothing
 * @returns the page method
 */
function sends({ channel, field }: { channel: string; field?: string }): (input?: Record<string, unknown>) => void {
  return (input) => ipcRenderer.send(channel, field === undefined ? undefined : input?.[field]);
}

/** One page listener the preload holds by itself rather than per channel, while the page has one installed. */
type ListenerSlot<T> = { current: T | undefined };

/**
 * Install a page listener in its slot, answering what clears it — only while it is still the one held, so a page that
 * installed a newer one in between keeps it.
 *
 * @param slot where the listener is held
 * @param listener the page's listener
 * @returns what removes it
 */
function holdListener<T>({ slot, listener }: { slot: ListenerSlot<T>; listener: T }): () => void {
  slot.current = listener;
  return () => {
    if (slot.current === listener) {
      slot.current = undefined;
    }
  };
}

/** How long a triage press may wait for the page's listener, matching main's own freshness for a note's press. */
const HELD_PRESS_MS = 10_000;

/** The page's one triage press listener (`onTriageCommand`). */
const triageListener: ListenerSlot<(command: unknown) => void> = { current: undefined };

/**
 * Triage presses main sent while the page had no listener, oldest first. `atMs` is `performance.now()`, a monotonic
 * clock, so a wall clock moved backward cannot make a press that waited too long read as fresh.
 */
const heldPresses: { readonly command: unknown; readonly atMs: number }[] = [];

// Installed for the page's whole life, so a press is never sent to a channel nobody hears.
ipcRenderer.on("slopweaver:triage-command", (_event: Electron.IpcRendererEvent, command: unknown) => {
  if (triageListener.current === undefined) {
    heldPresses.push({ atMs: performance.now(), command });
    return;
  }
  triageListener.current(command);
});

/**
 * The console page's own navigator, while it has registered one (`onNavigate`). It is called with the path main asked
 * for and says whether it took it.
 */
const pageNavigator: ListenerSlot<(path: unknown) => unknown> = { current: undefined };

/** The console page's Queue server, while it has registered one (`onVoiceQueueRequest`): its snapshot, as a string. */
const queueServer: ListenerSlot<() => unknown> = { current: undefined };

/** In the overlay, what releases the pointer as a leave does (`reportPointer`), once that watch is running. */
let releasePointer: (() => void) | undefined;

/** In the overlay, what measures and sends the controls now, changed or not (`reportControls`), once that is running. */
let sendControls: (() => void) | undefined;

// Main asks the console window to go to a page in place rather than loading it whole (`surface.ts` `moveOnShow`).
// This document answers for itself, so an answer can never speak for a page loaded after it: with no navigator — a
// page from before this — or one that refuses or throws, it says not taken, and main loads the window whole.
if (role === "main") {
  ipcRenderer.on("slopweaver:navigate", (_event, request: unknown) => {
    if (typeof request !== "object" || request === null || !("id" in request) || !("path" in request)) {
      return;
    }
    let taken = false;
    try {
      taken = pageNavigator.current?.(request.path) === true;
    } catch {
      // Not taken: `taken` is still false.
    }
    ipcRenderer.send("slopweaver:navigate-ack", { id: request.id, taken });
  });
  // The voice's window asks for the Queue on screen (`voiceQueueShell.ts`): this document answers with what its page
  // holds now, or `null` with no server — a page from before this — or one that throws.
  ipcRenderer.on("slopweaver:voice-queue-request", (_event, id: unknown) => {
    let snapshot: unknown = null;
    try {
      snapshot = queueServer.current?.();
    } catch {
      // No snapshot: `snapshot` is still null.
    }
    ipcRenderer.send("slopweaver:voice-queue-reply", { id, snapshot: typeof snapshot === "string" ? snapshot : null });
  });
}

contextBridge.exposeInMainWorld("slopweaverDesktop", {
  // Nothing for a call's look, `{ typedAsk: true }` for a typed one; main reads it strictly (`captureAskOf`).
  captureScreen: (input?: unknown): Promise<unknown> => ipcRenderer.invoke("slopweaver:capture-screen", input),
  // A page identity may carry the open card (`desktopBridge.ts` `parsePageIdentity`); an app built before it drops an
  // identity with any third key, so the console sends one only where this says so.
  carriesOpenCard: true,
  // The open card's title likewise, for the messenger band.
  carriesOpenTitle: true,
  // A page identity may carry the page's reading too, kept opaque (`parsePageIdentity`); an app built before it drops
  // an identity with a `reading` key, so the console sends one only where this says so.
  carriesPageReading: true,
  // This shell takes a typed ask on `captureScreen`; an older one ignores the argument and refuses with no call.
  supportsTypedScreenLook: true,
  focusOverlay: sends({ channel: "slopweaver:overlay-focus" }),
  focusRegion: (input: { region: unknown }) => ipcRenderer.invoke("slopweaver:focus-region", input.region),
  // The messenger band's own channel (`frontAppBand.ts`), apart from the three-field `frontWindow` the watches read.
  frontAppBand: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:front-app-band"),
  reportMessengerOpen: sends({ channel: "slopweaver:messenger-open", field: "report" }),
  frontWindow: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:front-window"),
  // The X on the orb takes the overlay off the owner's screen while the call runs on; the menu bar brings it back. The pointer
  // is released first, as a leave would, so the window passes clicks through when it is shown again rather than
  // keeping the take the X's own hover made; a hidden window hears no move to correct it.
  hideOverlay: (): void => {
    releasePointer?.();
    ipcRenderer.send("slopweaver:overlay-hide");
  },
  onNavigate: (listener: (path: unknown) => unknown): (() => void) => holdListener({ listener, slot: pageNavigator }),
  onOverlayArea: hears({ channel: "slopweaver:overlay-area" }),
  onOverlayInset: hears({ channel: "slopweaver:overlay-inset" }),
  // Subscribing says this page rests its orb on the floor word, so the shell may lift the corner for it.
  onOverlayFloor: (listener: (floor: unknown) => void): (() => void) => {
    const unsubscribe = subscribe({ channel: "slopweaver:overlay-floor", listener });
    ipcRenderer.send("slopweaver:overlay-floor-heard");
    return unsubscribe;
  },
  onOverlayCommand: hears({ channel: "slopweaver:overlay-command" }),
  onOverlayOrigin: hears({ channel: "slopweaver:overlay-origin" }),
  onOverlayHome: hears({ channel: "slopweaver:overlay-home" }),
  onOverlayStatus: hears({ channel: "slopweaver:overlay-status" }),
  onPageIdentity: hears({ channel: "slopweaver:page-identity" }),
  onVoiceQueueRequest: (listener: () => unknown): (() => void) => holdListener({ listener, slot: queueServer }),
  requestVoiceQueue: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:voice-queue"),
  // The console window's toast hears each failure main forwards from the voice's window, which reports it here.
  onVoiceFailure: hears({ channel: "slopweaver:voice-failure" }),
  // A toast's "Open in new tab": the card's key only, which main turns into a console path and opens as a new tab.
  openQueueCardInNewTab: sends({ channel: "slopweaver:open-queue-card-in-new-tab", field: "key" }),
  overlayStatusNow: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:overlay-status-now"),
  presentConsoleCard: ({ path }: { path: unknown }): Promise<void> =>
    ipcRenderer.invoke("slopweaver:present-console-card", path).then(() => undefined),
  publishPageIdentity: sends({ channel: "slopweaver:page-identity", field: "identity" }),
  report: (value: unknown): void => ipcRenderer.send("slopweaver:media-report", value),
  // The viewer's "Reveal in Finder" on a local page: its slug only, which main turns into the page's file itself.
  revealPageInFinder: (input: { slug: unknown }) => ipcRenderer.invoke("slopweaver:reveal-page", input.slug),
  // The call the voice holds, so main knows what a renderer death ends; the page it reloads takes the recovery.
  reportOverlayCall: sends({ channel: "slopweaver:overlay-call", field: "call" }),
  reportOverlayExtent: sends({ channel: "slopweaver:overlay-extent", field: "extent" }),
  // How wide the messenger the owner sized needs its corner, and whether a drag of its edge holds the pointer.
  reportOverlayWidth: sends({ channel: "slopweaver:overlay-width", field: "report" }),
  reportOverlayPlace: sends({ channel: "slopweaver:overlay-place", field: "report" }),
  // The voice's edge glow, drawn by main's screen-edge strips so the voice's window keeps to its corner on a call.
  reportOverlayGlow: sends({ channel: "slopweaver:overlay-glow", field: "report" }),
  reportOverlayStatus: sends({ channel: "slopweaver:overlay-status", field: "status" }),
  reportVoiceFailure: sends({ channel: "slopweaver:voice-failure", field: "notice" }),
  // Rapid triage (`triageShell.ts`): the voice's window says where its pass and clock stand, and hears the menu bar's
  // and the floating notes' presses. Main takes a report from the voice's window alone and parses it again.
  reportTriageClock: sends({ channel: "slopweaver:triage-clock", field: "report" }),
  // A press main sends while the page has no listener (before its first effect, between two) waits in `heldPresses`
  // and goes to the next listener installed, so main's send never lands on nothing. Each press's age is
  // read as it is handed over, so one press the listener is slow over cannot carry a later one past HELD_PRESS_MS.
  onTriageCommand: (listener: (command: unknown) => void): (() => void) => {
    for (const held of heldPresses.splice(0)) {
      if (performance.now() - held.atMs <= HELD_PRESS_MS) {
        listener(held.command);
      }
    }
    return holdListener({ listener, slot: triageListener });
  },
  requestOverlay: ({ command }: { command: unknown }): void => {
    // Only the three a page may ask for ever leave it — the menu bar's own `show` among what never does.
    // Main parses again (`desktopBridge.ts` `parseOverlayCommand`), which stays the authority.
    if (command === "activate" || command === "collapse" || command === "expand") {
      ipcRenderer.send("slopweaver:overlay-request", command);
    }
  },
  role,
  ...(instance === undefined ? {} : { instance }),
  shell: "desktop",
  shellBuild: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:shell-build"),
  // The one-click update (`updateShell.ts`): the sidebar's button and the menu bar's item, one flow.
  endCallForUpdate: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:update-end-call"),
  onUpdateCheck: hears({ channel: "slopweaver:update-check" }),
  onUpdateRun: hears({ channel: "slopweaver:update-run" }),
  onUpdateState: hears({ channel: "slopweaver:update-state" }),
  publishUpdateOffer: sends({ channel: "slopweaver:update-offer", field: "offer" }),
  relaunchForUpdate: sends({ channel: "slopweaver:update-relaunch" }),
  reloadForUpdate: sends({ channel: "slopweaver:update-reload" }),
  beginSwapForUpdate: sends({ channel: "slopweaver:update-swap" }),
  startUpdate: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:update-start"),
  takeOverlayRecovery: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:overlay-recovery"),
  updateState: (): Promise<unknown> => ipcRenderer.invoke("slopweaver:update-state"),
});

/**
 * Runs in the PAGE's world, serialised by Electron — so it closes over nothing and names only globals. Wraps
 * `getDisplayMedia` and `getUserMedia` to report every track they hand out, and `MediaStreamTrack.prototype.stop`
 * plus each track's `ended` to report it released. Original behaviour, receiver and rejections are preserved.
 */
function observeCaptures(): void {
  const bridge = window.slopweaverDesktop;
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (bridge === undefined || devices === undefined) {
    return;
  }
  const load = Math.random().toString(36).slice(2, 8);
  const ids = new WeakMap<MediaStreamTrack, string>();
  let next = 0;
  const release = ({ track }: { track: MediaStreamTrack }): void => {
    const id = ids.get(track);
    if (id !== undefined) {
      bridge.report({ id, kind: "released" });
    }
  };
  const watch = ({ stream, media }: { stream: MediaStream; media: "display" | "audio" }): MediaStream => {
    const tracks = media === "display" ? stream.getVideoTracks() : stream.getAudioTracks();
    for (const track of tracks) {
      next += 1;
      const id = `${load}-${String(next)}`;
      ids.set(track, id);
      bridge.report({ id, kind: "acquired", media });
      track.addEventListener("ended", () => {
        release({ track });
      });
    }
    return stream;
  };
  // Each replacement inherits the browser's own signature from the property it is assigned to.
  const display = devices.getDisplayMedia.bind(devices);
  devices.getDisplayMedia = (options) => display(options).then((stream) => watch({ media: "display", stream }));
  const user = devices.getUserMedia.bind(devices);
  devices.getUserMedia = (constraints) => user(constraints).then((stream) => watch({ media: "audio", stream }));
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function stopAndReport(this: MediaStreamTrack): void {
    release({ track: this });
    stop.call(this);
  };
}

contextBridge.executeInMainWorld({ func: observeCaptures });

/**
 * Run once the parser has built the real `<html>`, or now when it already has.
 *
 * @param run what to run
 */
function whenParsed({ run }: { run: () => void }): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    return;
  }
  run();
}

/** `windowChrome.ts`'s `WINDOW_CONTROLS_ARGUMENT` and channel, spelled here because a sandboxed preload imports nothing. */
const WINDOW_CONTROLS_ARGUMENT = "--slopweaver-window-controls=";
const WINDOW_CONTROLS_CHANNEL = "slopweaver:window-controls";

/**
 * Whether the window's own buttons stand over this page's top-left corner — the state it opened in, then whatever the
 * main process says on a trip into or out of full-screen. Only the two literals are ever taken.
 */
let windowControls: "inset" | "none" = process.argv.includes(`${WINDOW_CONTROLS_ARGUMENT}inset`) ? "inset" : "none";

/**
 * Mark the document as the shell's once the parser has built the real `<html>`, with whether the window's buttons sit
 * over it (`data-window-controls`, which the sidebar's top row keys on). A preload runs before the document has an
 * element at all — `documentElement` is null there, and the throw would end this script before the pointer,
 * appearance and sharing wiring below it. React renders neither attribute, so neither is a hydration difference.
 */
function markShell(): void {
  document.documentElement.dataset["shell"] = role;
  document.documentElement.dataset["windowControls"] = windowControls;
}
whenParsed({ run: markShell });

ipcRenderer.on(WINDOW_CONTROLS_CHANNEL, (_event, state: unknown) => {
  if (state !== "inset" && state !== "none") {
    return;
  }
  windowControls = state;
  whenParsed({ run: markShell });
});

/** `tabStripLook.ts`'s `StripTokens`: each field and the console custom property it is read from. */
const STRIP_TOKENS = [
  ["sidebar", "--c-sidebar"],
  ["bg", "--c-bg"],
  ["card", "--c-card"],
  ["border", "--c-border"],
  ["ink", "--c-ink"],
  ["muted", "--c-muted"],
] as const;

/** The two attributes the console's boot script and its looks set on `<html>`: the colour family, and light or dark. */
const APPEARANCE_ATTRIBUTES = ["data-sw-mode", "data-sw-family"];

let sentMode: string | undefined;
let sentTokens: string | undefined;

/** Tell the main process the console's own light/dark choice, when it has changed. */
function sendMode(): void {
  const mode = document.documentElement.dataset["swMode"];
  if ((mode === "light" || mode === "dark") && mode !== sentMode) {
    sentMode = mode;
    ipcRenderer.send("slopweaver:appearance", mode);
  }
}

/**
 * From a console page in a tab, tell the main process the colours the look it wears paints, when they have changed, so
 * the tab strip wears the same look (`tabStripLook.ts` `parseStripTokens`, the one place they are checked). A page that
 * paints no look — a holding page, or one whose stylesheet the parser has not reached yet — reports nothing.
 */
function sendStripTokens(): void {
  if (role !== "main" || document.documentElement.dataset["swFamily"] === undefined) {
    return;
  }
  const style = getComputedStyle(document.documentElement);
  const read = STRIP_TOKENS.map(([field, property]) => [field, style.getPropertyValue(property).trim()] as const);
  if (read.some(([, colour]) => colour === "")) {
    return;
  }
  const tokens = Object.fromEntries(read);
  const key = JSON.stringify(tokens);
  if (key !== sentTokens) {
    sentTokens = key;
    ipcRenderer.send("slopweaver:strip-palette", tokens);
  }
}

/** Both, on a change to either attribute. */
function sendAppearance(): void {
  sendMode();
  sendStripTokens();
}

/**
 * Watch `<html>` from the moment the parser builds it, not from when parsing ends: the boot script in the head stamps
 * the stored look before the body paints, so the strip takes the look as the page first paints rather than once its
 * last script has loaded. The first read sends only the colours, never light or dark, so a default the boot script is
 * about to replace never reaches the native appearance.
 */
function watchAppearance(): void {
  sendStripTokens();
  new MutationObserver(sendAppearance).observe(document.documentElement, { attributeFilter: APPEARANCE_ATTRIBUTES });
}

/**
 * `<html>`, or `null` before the parser has built it: the DOM's types call it always there, and a preload runs earlier.
 *
 * @returns the element, or `null`
 */
function rootElement(): HTMLElement | null {
  return document.documentElement;
}

if (rootElement() === null) {
  const waiting = new MutationObserver(() => {
    if (rootElement() !== null) {
      waiting.disconnect();
      watchAppearance();
    }
  });
  waiting.observe(document, { childList: true });
} else {
  watchAppearance();
}
whenParsed({ run: sendAppearance });

/**
 * Whether main's answer to `slopweaver:overlay-cursor` is a point in the page; `null` is the pointer off the window.
 *
 * @param value what main answered
 * @returns true for an object with finite numeric `x` and `y`
 */
function isClientPoint(value: unknown): value is { readonly x: number; readonly y: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { x, y } = value as { readonly x?: unknown; readonly y?: unknown };
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

/**
 * In the overlay, say whether the pointer is over one of the voice's own controls. The window passes the pointer
 * through but still forwards its movement, so this hears every move; only a CHANGE is sent. An element with
 * `pointer-events: none` is never the hit, so the widget's transparent wrapper never counts — only what it draws.
 *
 * A control can also vanish from under a pointer that never moves — a caption that clears as the call connects —
 * so while the pointer is over a control every change to the page re-tests the last position in the observer's own
 * microtask, before the page paints the control gone, and every frame re-tests it for whatever moves a
 * control silently. What remains is at most one frame plus one IPC hop: a click landing in that window still meets
 * the overlay. Only a window shape would close it, and Electron's `setShape` is Windows and Linux only.
 *
 * Coming ON to a control needs this page to hear the move first, and mid-call it can be too busy to before the owner's press
 * lands, which then reaches the wallpaper. So main also watches the cursor itself against
 * where {@link reportControls} says the controls are, and takes the pointer on whichever answer comes first.
 */
function reportPointer(): void {
  let over = false;
  let at: { readonly x: number; readonly y: number } | undefined;
  let sweeping = false;
  // Bumped by everything that says where the pointer is, so an answer or a frame about an older moment is dropped.
  let heard = 0;
  // The resize whose re-test is still settling, during which a pointer already taken is held rather than released.
  let settling: number | undefined;
  /** Send the main process a change of whether the pointer is over a control, and sweep while it is. */
  function tell({ next }: { next: boolean }): void {
    if (next === over) {
      return;
    }
    over = next;
    ipcRenderer.send("slopweaver:overlay-pointer", next);
    // The controls as they stood for this answer, right behind it on the same ordered channel: main judges the answer
    // only against boxes at least this new, never against a report from before a control moved.
    sendControls?.();
    if (next && !sweeping) {
      sweeping = true;
      requestAnimationFrame(sweep);
    }
  }
  /** Hit-test the last pointer position; while a resize settles, only ever take the pointer, never release it. */
  function test(): void {
    if (at === undefined) {
      if (settling === undefined) {
        tell({ next: false });
      }
      return;
    }
    const hit = document.elementFromPoint(at.x, at.y);
    const next = hit !== null && hit.closest("[data-overlay-interactive]") !== null;
    if (next || settling === undefined) {
      tell({ next });
    }
  }
  /**
   * While the pointer is taken, re-test every frame: whatever moves a control without an event this hears — a
   * reflow, a font arriving — is caught within one frame. It stops the frame the pointer is released.
   */
  function sweep(): void {
    if (!over) {
      sweeping = false;
      return;
    }
    test();
    requestAnimationFrame(sweep);
  }
  /** Re-test now, when the pointer is taken. */
  function retest(): void {
    if (over) {
      test();
    }
  }
  /**
   * A resized or moved window leaves the last position meaning nothing, and a pointer resting on a control sends no
   * move to say where it is now. The orb's own press resizes the window — its messenger grows the corner to the card — so released
   * here until a move came, the window passed the owner's second press through to the wallpaper, which macOS took as "reveal
   * the desktop". So a pointer already taken is HELD while main says where the
   * pointer sits in the new bounds (`slopweaver:overlay-cursor`) and that point is hit-tested, then tested for real
   * two frames on, once the fit's words have laid the page out (`overlayMove.ts` waits the same two). No answer — the
   * pointer off the window, or the window hidden — releases at once; any move or leave supersedes it.
   */
  function relocate(): void {
    heard += 1;
    const ticket = heard;
    settling = ticket;
    at = undefined;
    /** End this resize's hold with an authoritative test, unless something newer already has. */
    const settle = (): void => {
      if (ticket === heard) {
        settling = undefined;
        test();
      }
    };
    /** Hit-test where main says the pointer is, then settle two frames on. */
    const place = async (): Promise<void> => {
      let value: unknown;
      try {
        value = await ipcRenderer.invoke("slopweaver:overlay-cursor");
      } catch {
        settle();
        return;
      }
      if (ticket !== heard) {
        return;
      }
      if (!isClientPoint(value)) {
        settle();
        return;
      }
      at = value;
      test();
      requestAnimationFrame(() => {
        requestAnimationFrame(settle);
      });
    };
    void place();
  }
  window.addEventListener("resize", relocate);
  // Shown again under a pointer that has not moved — Show voice after the X, or the first reveal — sends no move, so
  // main says so and the resting point is hit-tested the same way (`main.ts` `revealOverlay`).
  ipcRenderer.on("slopweaver:overlay-revealed", relocate);
  document.addEventListener("mousemove", (event) => {
    heard += 1;
    settling = undefined;
    at = { x: event.clientX, y: event.clientY };
    test();
  });
  /** The pointer is off every control: whatever is pending about an older moment is dropped. */
  function release(): void {
    heard += 1;
    settling = undefined;
    at = undefined;
    tell({ next: false });
  }
  document.addEventListener("mouseleave", release);
  releasePointer = release;
  // Main saw the cursor leave every control while this page still said "over" (`overlayWindow.ts` `pointerWatchStep`):
  // forget the answer it dropped and test again, so a pointer really still on a control is taken back.
  ipcRenderer.on("slopweaver:overlay-pointer-dropped", () => {
    over = false;
    test();
  });
  // Text edits too: a caption revised shorter changes only its text node.
  new MutationObserver(retest).observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  // A control that animates away has moved only when its transition or animation ends.
  document.addEventListener("transitionend", retest);
  document.addEventListener("animationend", retest);
}

/** How many frames the controls keep being measured after the last change, so a transition's travel is followed. */
const CONTROLS_SETTLE_FRAMES = 30;

/**
 * The most boxes main takes in one report: `desktopBridgeGeometry.ts`'s `MAX_CONTROL_BOXES`, spelled here because
 * this file imports nothing but `electron`; `desktopBridge.test.ts` holds the two equal.
 */
const CONTROL_BOX_LIMIT = 32;

/** One control's box in CSS pixels, as `reportControls` sends it. */
type ControlBox = { left: number; top: number; width: number; height: number };

/** `contain` values that make an element the containing block of a fixed descendant. */
const CONTAIN_HOLDS_FIXED = new Set(["paint", "layout", "strict", "content"]);

/** `contain` values that turn on paint containment, which clips both axes whatever `overflow` says. */
const CONTAIN_CLIPS_PAINT = new Set(["paint", "strict", "content"]);

/**
 * `will-change` properties that make an element the containing block of a fixed descendant, matched whole, as this
 * Chromium draws them: `container-type`, `content-visibility`, `clip-path`, `mask` and `opacity` hold nothing.
 * `contain` holds one too, read beside containment itself because a table track ignores both.
 */
const WILL_CHANGE_HOLDS_FIXED = new Set([
  "transform",
  "translate",
  "rotate",
  "scale",
  "perspective",
  "filter",
  "backdrop-filter",
  "transform-style",
  "offset",
  "offset-path",
]);

/**
 * Table tracks: rows, columns and their groups. Chromium takes no overflow clip, containment or container on one, so
 * a row with `overflow: hidden` or `contain: paint` clips nothing and holds nothing; a transform or filter still holds.
 */
const TABLE_TRACKS = new Set([
  "table-row",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-column",
  "table-column-group",
]);

/**
 * Computed `display` values of a non-replaced inline box: plain inline, ruby and its annotation, and an inline list
 * item. Each ignores overflow, a transform and containment, and holds a fixed descendant only through a filter.
 */
const NON_REPLACED_INLINE = new Set(["inline", "ruby", "ruby-text", "inline list-item"]);

/**
 * Whether a style turns on layout or paint containment, which makes it the containing block of a fixed descendant
 * and keeps the body's overflow from carrying up to the viewport. `content-visibility` other than `visible` does both.
 *
 * @param style a computed style
 * @returns whether it is contained
 */
function layoutContained({ style }: { style: CSSStyleDeclaration }): boolean {
  return (
    style.contentVisibility !== "visible" || style.contain.split(/\s+/).some((value) => CONTAIN_HOLDS_FIXED.has(value))
  );
}

/**
 * An element's parent as Chromium lays it out: the slot it is assigned to, the host of the shadow root it sits in,
 * or its parent element. A slotted element is clipped and contained by the shadow tree it is drawn in, never by
 * its light-DOM host's own children.
 *
 * @param element the element
 * @returns its parent in the flat tree, or `null` at the top
 */
function flatParent({ element }: { element: Element }): Element | null {
  if (element.assignedSlot !== null) {
    return element.assignedSlot;
  }
  const parent = element.parentNode;
  if (parent instanceof ShadowRoot) {
    return parent.host;
  }
  return element.parentElement;
}

/** What one element's computed style says about clipping what it contains, read once per measurement. */
type ClipStyle = {
  /** Its `position`, which decides which of its ancestors can clip it. */
  readonly position: string;
  /** It clips its overflow left and right. */
  readonly clipsX: boolean;
  /** It clips its overflow top and bottom. */
  readonly clipsY: boolean;
  /** It is the containing block of a `position: fixed` descendant: an SVG `<foreignObject>`, a filter, or on a box that takes them a transform of any spelling or an offset path, a 3D context, containment, a container, or a `will-change` naming one of those. */
  readonly holdsFixed: boolean;
  /** It is the containing block of a `position: absolute` descendant: it is positioned, it holds a fixed one, or its `will-change` names `position`; never while it draws no box. */
  readonly holdsAbsolute: boolean;
  /** Its own border box. */
  readonly rect: DOMRect;
  /** The edge CSS clips its overflow at, in drawn pixels: the padding box, or what `overflow-clip-margin` names. */
  readonly clip: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** It, or an ancestor below the top layer, is drawn through a transform. */
  readonly transformed: boolean;
  /** It is in the top layer, a modal dialog, an open popover or a fullscreen element, drawn over the viewport where no ancestor clips or contains it. */
  readonly topLayer: boolean;
};

/**
 * Read an element's clipping style, once per measurement.
 *
 * @param element the element
 * @param styles the measurement's cache
 * @returns its clipping style
 */
function clipStyleOf({ element, styles }: { element: Element; styles: Map<Element, ClipStyle> }): ClipStyle {
  const known = styles.get(element);
  if (known !== undefined) {
    return known;
  }
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  // A `display: contents` element draws no box. A non-replaced inline one draws boxes that take no overflow clip,
  // transform, containment or container, so of all those only a filter makes it hold anything. An `<svg>` computes to
  // `inline` yet is a replaced element, a viewport that clips what it draws, and so is a `<foreignObject>`.
  const boxless = style.display === "contents";
  const clipsAtAll =
    !boxless &&
    (!NON_REPLACED_INLINE.has(style.display) ||
      element instanceof SVGSVGElement ||
      element instanceof SVGForeignObjectElement);
  const parent = flatParent({ element });
  const topLayer = element.matches(":modal, :popover-open, :fullscreen");
  // An `offset-path` places an element along it through a transform of its own.
  const ownTransform =
    clipsAtAll &&
    (style.transform !== "none" ||
      style.translate !== "none" ||
      style.rotate !== "none" ||
      style.scale !== "none" ||
      style.offsetPath !== "none");
  const transformed =
    ownTransform || (parent !== null && !topLayer && clipStyleOf({ element: parent, styles }).transformed);
  // A border width is a layout length and the rect is drawn after any transform. A rotation makes no per-axis ratio
  // between the two exact, so a transformed element clips at its whole drawn border box, and at nothing once a clip
  // margin pushes it out: never inside what is painted. Untransformed, a layout length is a drawn length.
  // Paint containment clips both axes whatever `overflow` says. `content-visibility` other than `visible` turns it on.
  const paintContained =
    style.contentVisibility !== "visible" || style.contain.split(/\s+/).some((value) => CONTAIN_CLIPS_PAINT.has(value));
  // Overflow clips at the padding box. An axis that `overflow: clip` or paint containment alone clips takes
  // `overflow-clip-margin`, which names its own box and pushes the edge out past it by a length; an axis `hidden`,
  // `scroll` or `auto` clips stays at the padding box.
  const marginX = style.overflowX === "clip" || (paintContained && style.overflowX === "visible");
  const marginY = style.overflowY === "clip" || (paintContained && style.overflowY === "visible");
  const clipMargin = style.overflowClipMargin;
  let named = "padding-box";
  let outset = 0;
  const box = /border-box|content-box/.exec(clipMargin);
  if (box !== null) {
    named = box[0];
  }
  const length = /-?[\d.]+(?=px)/.exec(clipMargin);
  if (length !== null) {
    outset = Number.parseFloat(length[0]);
  }
  const inset = ({ side, margin }: { side: "Top" | "Right" | "Bottom" | "Left"; margin: boolean }): number => {
    // An `<svg>` is a viewport drawn inside its content box, so that is where it clips.
    let edge = margin ? named : "padding-box";
    if (element instanceof SVGSVGElement) {
      edge = "content-box";
    }
    if (edge === "border-box" || transformed) {
      return 0;
    }
    const border = Number.parseFloat(style[`border${side}Width`]);
    return edge === "content-box" ? border + Number.parseFloat(style[`padding${side}`]) : border;
  };
  const outsetX = marginX ? outset : 0;
  const outsetY = marginY ? outset : 0;
  // A skew or rotation carries a clip margin's outset into either axis by more than any per-axis ratio says, so a
  // transformed element pushed out by one clips nothing: reported whole, never cut.
  const tableTrack = TABLE_TRACKS.has(style.display);
  let clipsAny = clipsAtAll && !tableTrack && !(transformed && (outsetX !== 0 || outsetY !== 0));
  // The body's overflow carries up to the viewport, which the window clips, while the root's is `visible` and neither
  // is contained, nor the root a container; otherwise the body clips its own. A container body still carries it.
  if (element === document.body) {
    const root = getComputedStyle(document.documentElement);
    const carried =
      root.overflowX === "visible" &&
      root.overflowY === "visible" &&
      root.containerType === "normal" &&
      !layoutContained({ style: root }) &&
      !layoutContained({ style });
    clipsAny = clipsAny && !carried;
  }
  const willChange = style.willChange.split(/\s*,\s*/);
  const filtered =
    style.filter !== "none" ||
    style.backdropFilter !== "none" ||
    willChange.includes("filter") ||
    willChange.includes("backdrop-filter");
  // An SVG `<foreignObject>` is the viewport its HTML is laid out in, so it holds every positioned box inside it.
  const holdsFixed =
    element instanceof SVGForeignObjectElement ||
    (!boxless && filtered) ||
    (clipsAtAll &&
      (ownTransform ||
        style.perspective !== "none" ||
        style.transformStyle === "preserve-3d" ||
        willChange.some((value) => WILL_CHANGE_HOLDS_FIXED.has(value)) ||
        (!tableTrack &&
          (style.containerType !== "normal" || layoutContained({ style }) || willChange.includes("contain")))));
  const read: ClipStyle = {
    clip: {
      bottom: rect.bottom - inset({ margin: marginY, side: "Bottom" }) + outsetY,
      left: rect.left + inset({ margin: marginX, side: "Left" }) - outsetX,
      right: rect.right - inset({ margin: marginX, side: "Right" }) + outsetX,
      top: rect.top + inset({ margin: marginY, side: "Top" }) - outsetY,
    },
    // A `display: contents` element draws no box and a non-replaced inline one ignores overflow, so neither clips.
    clipsX: clipsAny && (style.overflowX !== "visible" || paintContained),
    clipsY: clipsAny && (style.overflowY !== "visible" || paintContained),
    // `will-change` names a property whose non-initial value would contain a descendant: `position` would (`relative`)
    // for an absolute one, never for a fixed one.
    holdsAbsolute: !boxless && (holdsFixed || style.position !== "static" || willChange.includes("position")),
    holdsFixed,
    // A boxless element is positioned by nothing, so what it holds is placed as though it were not there.
    position: boxless ? "static" : style.position,
    rect,
    topLayer,
    transformed,
  };
  styles.set(element, read);
  return read;
}

/**
 * The part of an element's box that is on screen once every ancestor that clips it has: a row scrolled up out of
 * the messenger's history sits ABOVE the card in layout, and reported whole it took the pointer over a column of the owner's
 * screen up to the menu bar, Chrome's extension icons under it. An ancestor clips the
 * element only when it is on the element's containing-block chain, so a `fixed` or `absolute` box that escapes an
 * `overflow: hidden` parent is still reported where it draws. The document's root is left to the window, which
 * `overlayWindow.ts` `overlayControlBounds` clips every box to, and so is the body while its overflow carries up to
 * the viewport. A top-layer element is drawn over the viewport, so the walk stops at it.
 *
 * @param element the element
 * @param styles the measurement's cache of each ancestor's clipping style
 * @returns its visible box, or `undefined` when none of it is visible
 */
function shownBox({ element, styles }: { element: Element; styles: Map<Element, ClipStyle> }): ControlBox | undefined {
  const { position: ownPosition, rect: own, topLayer } = clipStyleOf({ element, styles });
  let left = own.left;
  let top = own.top;
  let right = own.right;
  let bottom = own.bottom;
  let position = ownPosition;
  // A top-layer element still clips what it holds, and nothing above it in the document clips either of them.
  let lifted = topLayer;
  for (
    let up = flatParent({ element });
    !lifted && up !== null && up !== document.documentElement;
    up = flatParent({ element: up })
  ) {
    const style = clipStyleOf({ element: up, styles });
    lifted = style.topLayer;
    const contains = (position !== "fixed" || style.holdsFixed) && (position !== "absolute" || style.holdsAbsolute);
    if (!contains) {
      continue;
    }
    const { clip } = style;
    if (style.clipsX) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (style.clipsY) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    position = style.position;
  }
  if (right <= left || bottom <= top) {
    return undefined;
  }
  return { height: bottom - top, left, top, width: right - left };
}

/**
 * At most {@link CONTROL_BOX_LIMIT} boxes. Past it, the last box kept grows to cover every one left over, so main still
 * guards each control rather than refusing the whole report and guarding none. The cost is the small one
 * `reportControls` already names: a click between two merged controls meets the window.
 *
 * @param boxes every box measured, in page order
 * @returns the boxes to send, no more than main takes
 */
function capControlBoxes({ boxes }: { boxes: readonly ControlBox[] }): ControlBox[] {
  if (boxes.length <= CONTROL_BOX_LIMIT) {
    return [...boxes];
  }
  const kept = boxes.slice(0, CONTROL_BOX_LIMIT - 1);
  const rest = boxes.slice(CONTROL_BOX_LIMIT - 1);
  const first = rest[0]!;
  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;
  for (const box of rest) {
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  }
  return [...kept, { height: bottom - top, left, top, width: right - left }];
}

/**
 * In the overlay, tell main where each of the voice's own controls is — its box in CSS pixels and the viewport it was
 * measured in — so main can take the pointer the moment the cursor is over one without waiting on this page
 * (`overlayPointerShell.ts`). Measured on the next frame after anything that could move one: a change to the page, a
 * resize, the window shown again, a transition or animation starting or ending; then every frame for
 * {@link CONTROLS_SETTLE_FRAMES} more, so a box mid-slide is followed rather than left where it started. Only a
 * changed report is sent. A box of no area is left out.
 *
 * Whatever a control draws OUTSIDE its own box is reported too — the orb's hide X sits over its corner — as is every
 * child of a marker that draws no box itself (the stage's `contents` wrapper). Main drops this page's "over" when the
 * cursor leaves every box, so a box missing here would pass a press on that part of a control to the wallpaper. The
 * cost is the other way and small: a few pixels off a control, a click can meet a window with nothing under it.
 * Every box is reported as CLIPPED by the ancestors that clip it (`shownBox`): what a scroller or an
 * `overflow: hidden` card cuts off draws nothing, and reported where it sits in layout it took clicks far from any
 * control.
 */
function reportControls(): void {
  let last = "";
  let framesLeft = 0;
  let scheduled = false;
  /** Measure every marked control and send the report if it changed. */
  function measure(): void {
    const boxes: ControlBox[] = [];
    const styles = new Map<Element, ClipStyle>();
    for (const element of document.querySelectorAll("[data-overlay-interactive]")) {
      // A marker with no box of its own on screen — the stage's `contents` wrapper — leaves every child outside it.
      const own = shownBox({ element, styles });
      if (own !== undefined) {
        boxes.push(own);
      }
      for (const inner of element.querySelectorAll("*")) {
        // Clipping only shrinks a box, so one already inside the control's needs no walk up its ancestors.
        const raw = inner.getBoundingClientRect();
        const rawInside =
          own !== undefined &&
          raw.left >= own.left &&
          raw.top >= own.top &&
          raw.right <= own.left + own.width &&
          raw.bottom <= own.top + own.height;
        if (rawInside) {
          continue;
        }
        const box = shownBox({ element: inner, styles });
        const outside =
          box !== undefined &&
          (own === undefined ||
            box.left < own.left ||
            box.top < own.top ||
            box.left + box.width > own.left + own.width ||
            box.top + box.height > own.top + own.height);
        if (box !== undefined && outside) {
          boxes.push(box);
        }
      }
    }
    const report = {
      boxes: capControlBoxes({ boxes }),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
    const wire = JSON.stringify(report);
    if (wire !== last) {
      last = wire;
      ipcRenderer.send("slopweaver:overlay-controls", report);
    }
  }
  /** One measurement per frame while the settle window runs. */
  function frame(): void {
    measure();
    framesLeft -= 1;
    if (framesLeft > 0) {
      requestAnimationFrame(frame);
    } else {
      scheduled = false;
    }
  }
  /** Something may have moved a control: measure from the next frame, for the whole settle window again. */
  function changed(): void {
    framesLeft = CONTROLS_SETTLE_FRAMES;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(frame);
    }
  }
  sendControls = () => {
    last = "";
    measure();
  };
  changed();
  window.addEventListener("resize", changed);
  ipcRenderer.on("slopweaver:overlay-revealed", changed);
  new MutationObserver(changed).observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  for (const kind of ["transitionstart", "transitionend", "animationstart", "animationend"]) {
    document.addEventListener(kind, changed);
  }
}

if (role === "overlay") {
  whenParsed({ run: reportPointer });
  whenParsed({ run: reportControls });
}
