/**
 * The console window's tabs, applied to Electron: the strip across the top and one `WebContentsView` per tab under it,
 * each its own page with its own history, only the showing one visible. The decisions — order, what a key or a click
 * does, where back goes, what is saved — are `tabStrip.ts`; `main.ts` keeps every page on the console and decides
 * which tab a path opens in.
 *
 * A tab restored on relaunch has no page until the owner first shows it, so lining up a strip costs nothing at launch. A tab
 * that is open has a live page even while hidden, throttled in the background the way a browser's is.
 */
import { join } from "node:path";

import { type BaseWindow, ipcMain, type WebContents, WebContentsView } from "electron";

import type { DesktopPageIdentity } from "./desktopBridge";
import { findShortcut } from "./findBar";
import {
  applyFindShortcut,
  findOpen,
  findTabShown,
  focusFind,
  layoutFind,
  mountFind,
  raiseFind,
  unmountFind,
} from "./findShell";
import { popNewTabMenu } from "./newTabShell";
import { listenForStripPalette, stripPaletteNow } from "./stripPaletteShell";
import {
  activateTab,
  activeTab,
  backTarget,
  closeTab,
  holdingEntries,
  moveTab,
  openTab,
  parseTabCommand,
  pinnedTab,
  restoredStrip,
  type SavedTab,
  savedTabs,
  stripMarkup,
  type TabCommand,
  type TabStrip,
  tabOf,
  tabTitle,
  updateTab,
} from "./tabStrip";
import { shortcutTarget, type TabShortcut, tabShortcut } from "./tabStripKeys";
import { STRIP_HEIGHT, stripDocument } from "./tabStripLook";
import { windowControlsState } from "./windowChrome";

/** What the tabs reach in `main.ts`. */
export interface TabsHost {
  /** The web preferences of a console page in a tab. */
  readonly tabPreferences: () => Electron.WebPreferences;
  /** Keep a new tab's page on the console: its navigation guards, its window-open handler, its commits. */
  readonly prepareTab: (options: { readonly tabId: string; readonly contents: WebContents }) => void;
  /** Load a tab's page whole, onto the path it is waiting for. */
  readonly loadTab: (options: { readonly tabId: string }) => void;
  /** A tab's page is gone: end its captures. */
  readonly retireContents: (options: { readonly contentsId: number }) => void;
  /** Another tab is showing: its page is the one the voice and the menu bar speak of now. */
  readonly activated: () => void;
  /** The strip changed in a way worth saving. */
  readonly changed: () => void;
  /** ⌘W on the pinned tab, which never closes: hide the window, as its red button does. */
  readonly closeWindow: () => void;
  /** A window title naming Slopweaver and the page. */
  readonly titleFor: (options: { readonly page: string }) => string;
}

/** A tab that has a page. */
interface LiveTab {
  readonly view: WebContentsView;
  /** The console page it has committed to, or `undefined` while it shows none (`main.ts` `committedPath`). */
  readonly committed: string | undefined;
  /** The page's own title, before the strip shortens it. */
  readonly documentTitle: string;
  /** What the page last said it is, for the voice. */
  readonly identity: DesktopPageIdentity | undefined;
}

/** Main to strip: what to draw. Strip to main: one command. Spelled again in `stripPreload.ts`. */
const STATE_CHANNEL = "slopweaver:tab-strip";
const COMMAND_CHANNEL = "slopweaver:tab-command";
let host: TabsHost | undefined;
let strip: TabStrip | undefined;
let window: BaseWindow | undefined;
let stripView: WebContentsView | undefined;
let stripReady = false;
let fullscreen = false;
let minted = 0;
const live = new Map<string, LiveTab>();

/**
 * The host, once `startTabs` has run.
 *
 * @returns the host
 */
function hostOf(): TabsHost {
  if (host === undefined) {
    throw new Error("the tabs were used before startTabs");
  }
  return host;
}

/**
 * The strip, once `startTabs` has run.
 *
 * @returns the strip
 */
function stripOf(): TabStrip {
  if (strip === undefined) {
    throw new Error("the tabs were used before startTabs");
  }
  return strip;
}

/** A new tab id. */
function mintTabId(): string {
  minted += 1;
  return `tab-${String(minted)}`;
}

/**
 * Start the tabs from what was saved: every saved tab back in its place, the pinned one showing.
 *
 * @param saved the saved tabs, or `undefined` from a state written before tabs
 * @param home the pinned tab's page when nothing was saved
 */
export function startTabs({
  tabsHost,
  saved,
  home,
}: {
  tabsHost: TabsHost;
  saved: readonly SavedTab[] | undefined;
  home: string;
}): void {
  host = tabsHost;
  strip = restoredStrip({ home, mint: mintTabId, saved });
  ipcMain.on(COMMAND_CHANNEL, (event, value: unknown) => {
    const command = parseTabCommand({ value });
    if (command !== undefined && stripView !== undefined && event.sender === stripView.webContents) {
      applyCommand({ command });
    }
  });
  listenForStripPalette({ isTabPage: ({ contents }) => tabIdOf({ contents }) !== undefined, redraw: drawStrip });
}

/**
 * The tabs as they stand, for saving.
 *
 * @returns every tab's page and title, the pinned one first
 */
export function tabsToSave(): readonly SavedTab[] {
  return savedTabs({ strip: stripOf() });
}

/**
 * The id of the tab showing.
 *
 * @returns the id
 */
export function activeTabId(): string {
  return stripOf().active;
}

/**
 * The id of the pinned tab, the Queue's.
 *
 * @returns the id
 */
export function pinnedTabId(): string {
  return pinnedTab({ strip: stripOf() }).id;
}

/**
 * A tab's page, while it has one.
 *
 * @returns the page, or `undefined` for a tab not loaded yet, closed, or with the window closed
 */
export function tabContents({ id }: { id: string }): WebContents | undefined {
  const contents = live.get(id)?.view.webContents;
  if (contents === undefined || contents.isDestroyed()) {
    return undefined;
  }
  return contents;
}

/**
 * Which tab a page is.
 *
 * @returns the tab's id, or `undefined` when the page is not a tab's
 */
export function tabIdOf({ contents }: { contents: WebContents }): string | undefined {
  for (const [id, tab] of live) {
    if (tab.view.webContents === contents) {
      return id;
    }
  }
  return undefined;
}

/**
 * Every tab's live page.
 *
 * @returns the pages, in no particular order
 */
export function everyTabContents(): readonly WebContents[] {
  return [...live.values()].map((tab) => tab.view.webContents).filter((contents) => !contents.isDestroyed());
}

/**
 * The page a tab is on, or will load when it is first shown.
 *
 * @returns the path
 */
export function tabPath({ id }: { id: string }): string {
  return tabOf({ id, strip: stripOf() })!.path;
}

/**
 * Point a tab at a page — the page it is waiting for, or the one it just committed to.
 *
 * @param path the console path
 */
export function setTabPath({ id, path }: { id: string; path: string }): void {
  const tab = tabOf({ id, strip: stripOf() });
  if (tab === undefined || tab.path === path) {
    return;
  }
  strip = updateTab({ change: { path }, id, strip: stripOf() });
  retitle({ id });
  hostOf().changed();
}

/**
 * The console page a tab has committed to.
 *
 * @returns the path, or `undefined` while it shows none
 */
export function committedOf({ id }: { id: string }): string | undefined {
  return live.get(id)?.committed;
}

/**
 * Record what a tab's page has committed to — set by a navigation that landed, cleared by every load, failure and
 * renderer death.
 *
 * @param path the console page, or `undefined` when none is proven on screen
 */
export function setCommitted({ id, path }: { id: string; path: string | undefined }): void {
  const tab = live.get(id);
  if (tab !== undefined) {
    live.set(id, { ...tab, committed: path });
  }
  if (id === activeTabId()) {
    drawStrip();
  }
}

/**
 * Record what a tab's page says it is.
 *
 * @param identity its path and title
 */
export function setIdentity({ id, identity }: { id: string; identity: DesktopPageIdentity }): void {
  const tab = live.get(id);
  if (tab !== undefined) {
    live.set(id, { ...tab, identity });
  }
}

/**
 * What the showing tab's page last said it is.
 *
 * @returns the identity, or `undefined` before it has said
 */
export function activeIdentity(): DesktopPageIdentity | undefined {
  return live.get(activeTabId())?.identity;
}

/**
 * Put the strip and the showing tab in a newly made window. The window is shown by the caller once the strip has
 * drawn (`ready`), so it never opens as an empty pane of glass.
 *
 * @param target the console window
 * @param windowFullscreen whether it opens full-screen
 * @param ready called once, when the strip has loaded
 */
export function mountTabs({
  target,
  windowFullscreen,
  ready,
}: {
  target: BaseWindow;
  windowFullscreen: boolean;
  ready: () => void;
}): void {
  window = target;
  fullscreen = windowFullscreen;
  stripReady = false;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "stripPreload.js"),
      sandbox: true,
      spellcheck: false,
    },
  });
  stripView = view;
  view.setBackgroundColor("#00000000");
  target.contentView.addChildView(view);
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.on("before-input-event", (event, input) => {
    takeShortcut({ event, input });
  });
  contents.once("did-finish-load", () => {
    stripReady = true;
    drawStrip();
    ready();
  });
  target.on("resize", layout);
  target.on("focus", () => {
    if (findOpen()) {
      focusFind();
      return;
    }
    tabContents({ id: activeTabId() })?.focus();
  });
  void contents.loadURL(stripDocument());
  mountFind({
    findHost: { activeContents: () => tabContents({ id: activeTabId() }), takeKey: takeShortcut },
    target,
  });
  layout();
  showActive();
}

/** The window closed: every tab's page goes, and the tabs stay in the strip to load again when it reopens. */
export function unmountTabs(): void {
  unmountFind();
  for (const [id, tab] of live) {
    const contents = tab.view.webContents;
    hostOf().retireContents({ contentsId: contents.id });
    if (!contents.isDestroyed()) {
      contents.close();
    }
    live.delete(id);
  }
  if (stripView !== undefined && !stripView.webContents.isDestroyed()) {
    stripView.webContents.close();
  }
  stripView = undefined;
  stripReady = false;
  window = undefined;
}

/**
 * The window entered or left full-screen, where macOS hides its buttons and the strip closes their gap.
 *
 * @param windowFullscreen whether it is full-screen now
 */
export function setFullscreen({ windowFullscreen }: { windowFullscreen: boolean }): void {
  fullscreen = windowFullscreen;
  drawStrip();
}

/**
 * Open a tab on a page after the tab that opened it.
 *
 * @param path the console path, already the viewer's for a bare document
 * @param opener the tab it was opened from, which its back returns to
 * @param foreground whether it shows at once — a ⌘-click opens it behind
 * @returns the new tab's id
 */
export function openNewTab({
  path,
  opener,
  foreground,
}: {
  path: string;
  opener: string | undefined;
  foreground: boolean;
}): string {
  const id = mintTabId();
  strip = openTab({ foreground, strip: stripOf(), tab: { id, opener, path, title: tabTitle({ path, title: "" }) } });
  if (window !== undefined) {
    ensureView({ id });
    if (foreground) {
      showActive();
    } else {
      drawStrip();
    }
  }
  hostOf().changed();
  return id;
}

/**
 * Show a tab. A tab already showing, or one closed since the caller read its id — a click on a strip drawn before the
 * close — changes nothing, so it cannot drop the move in flight in the tab the owner is on.
 *
 * @param id the tab
 */
export function showTab({ id }: { id: string }): void {
  if (id === activeTabId() || tabOf({ id, strip: stripOf() }) === undefined) {
    return;
  }
  strip = activateTab({ id, strip: stripOf() });
  if (window !== undefined) {
    showActive();
  } else {
    hostOf().activated();
  }
}

/**
 * Close a tab; the pinned one hides the window instead.
 *
 * @param id the tab
 */
function closeTabNow({ id }: { id: string }): void {
  if (id === pinnedTabId()) {
    hostOf().closeWindow();
    return;
  }
  const wasActive = id === activeTabId();
  strip = closeTab({ id, strip: stripOf() });
  const tab = live.get(id);
  if (tab !== undefined) {
    live.delete(id);
    window?.contentView.removeChildView(tab.view);
    const contents = tab.view.webContents;
    hostOf().retireContents({ contentsId: contents.id });
    if (!contents.isDestroyed()) {
      contents.close();
    }
  }
  if (wasActive && window !== undefined) {
    showActive();
  } else {
    drawStrip();
  }
  hostOf().changed();
}

/** Back in the showing tab: its own history, else the tab that opened it (`backTarget`). */
function goBack(): void {
  const id = activeTabId();
  const contents = tabContents({ id });
  let canGoBack = false;
  if (contents !== undefined) {
    canGoBack = contents.navigationHistory.canGoBack();
  }
  const target = backTarget({ canGoBack, id, strip: stripOf() });
  if (target === "history") {
    contents?.navigationHistory.goBack();
  } else if (target !== undefined) {
    showTab({ id: target.tab });
  }
}

/** Forward in the showing tab, when it has a page after this one. */
function goForward(): void {
  const contents = tabContents({ id: activeTabId() });
  if (contents?.navigationHistory.canGoForward() === true) {
    contents.navigationHistory.goForward();
  }
}

/**
 * Apply one command off the strip.
 *
 * @param command what the owner clicked or dropped
 */
function applyCommand({ command }: { command: TabCommand }): void {
  switch (command.kind) {
    case "activate":
      showTab({ id: command.id });
      break;
    case "close":
      // The Queue's tab has no close on the strip, so a close for it — a middle click — is not one. Only ⌘W, the
      // window's own key, hides the window from it.
      if (command.id !== pinnedTabId()) {
        closeTabNow({ id: command.id });
      }
      break;
    case "move":
      strip = moveTab({ id: command.id, strip: stripOf(), to: command.to });
      drawStrip();
      hostOf().changed();
      break;
    case "back":
      goBack();
      break;
    case "forward":
      goForward();
      break;
    case "new-tab":
      // A page chosen off the + opens off no page, so its tab goes last, as Chrome's does.
      if (window !== undefined) {
        const open = ({ path }: { readonly path: string }): string =>
          openNewTab({ foreground: true, opener: undefined, path });
        popNewTabMenu({ open, target: window, x: command.x, y: command.y });
      }
      break;
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

/**
 * Apply one tab shortcut.
 *
 * @param shortcut the key's meaning
 */
function applyShortcut({ shortcut }: { shortcut: TabShortcut }): void {
  switch (shortcut.kind) {
    case "close":
      closeTabNow({ id: activeTabId() });
      return;
    case "back":
      goBack();
      return;
    case "forward":
      goForward();
      return;
    case "last":
    case "next":
    case "previous":
    case "select": {
      const target = shortcutTarget({ shortcut, strip: stripOf() });
      if (target !== undefined) {
        showTab({ id: target });
      }
      return;
    }
    default: {
      const unreachable: never = shortcut;
      return unreachable;
    }
  }
}

/**
 * Take a key press that is a tab or find shortcut before the page or the app menu sees it — so ⌘W closes the tab
 * rather than the window, ⌘1 shows the Queue from any page, and ⌘F finds in the page, from the page, the strip or the
 * find bar alike.
 *
 * @param event the input event, prevented when the key is a shortcut
 * @param input the key press
 */
function takeShortcut({ event, input }: { event: Electron.Event; input: Electron.Input }): void {
  const find = findShortcut({ press: input });
  if (find !== undefined) {
    event.preventDefault();
    applyFindShortcut({ shortcut: find });
    return;
  }
  const shortcut = tabShortcut({ press: input });
  if (shortcut === undefined) {
    return;
  }
  event.preventDefault();
  applyShortcut({ shortcut });
}

/**
 * Give a tab its page, when it has none and the window is open — a restored tab the first time it is shown.
 *
 * @param id the tab
 */
function ensureView({ id }: { id: string }): void {
  if (window === undefined || live.has(id)) {
    return;
  }
  const view = new WebContentsView({ webPreferences: hostOf().tabPreferences() });
  view.setBackgroundColor("#00000000");
  view.setVisible(false);
  window.contentView.addChildView(view);
  raiseFind();
  const contents = view.webContents;
  live.set(id, { committed: undefined, documentTitle: "", identity: undefined, view });
  placeTab({ view });
  contents.on("before-input-event", (event, input) => {
    takeShortcut({ event, input });
  });
  contents.on("did-navigate", () => {
    const history = contents.navigationHistory;
    const urls = history.getAllEntries().map((entry) => entry.url);
    for (const index of holdingEntries({ current: history.getActiveIndex(), urls })) {
      history.removeEntryAtIndex(index);
    }
    if (id === stripOf().active) {
      drawStrip();
    }
  });
  contents.on("page-title-updated", (_event, title) => {
    const tab = live.get(id);
    if (tab !== undefined) {
      live.set(id, { ...tab, documentTitle: title });
      retitle({ id });
    }
  });
  hostOf().prepareTab({ contents, tabId: id });
  hostOf().loadTab({ tabId: id });
}

/**
 * Recompute a tab's label from its page and its document's title, and the window's title when it is showing.
 *
 * @param id the tab
 */
function retitle({ id }: { id: string }): void {
  const tab = tabOf({ id, strip: stripOf() });
  if (tab === undefined) {
    return;
  }
  const documentTitle = live.get(id)?.documentTitle;
  if (documentTitle === undefined) {
    return;
  }
  const title = tabTitle({ path: tab.path, title: documentTitle });
  if (title !== tab.title) {
    strip = updateTab({ change: { title }, id, strip: stripOf() });
    hostOf().changed();
  }
  drawStrip();
  if (id === activeTabId()) {
    window?.setTitle(hostOf().titleFor({ page: title }));
  }
}

/** Show the active tab and hide every other, give it the keyboard, and redraw. */
function showActive(): void {
  const id = activeTabId();
  ensureView({ id });
  for (const [tabId, tab] of live) {
    tab.view.setVisible(tabId === id);
  }
  tabContents({ id })?.focus();
  findTabShown();
  window?.setTitle(hostOf().titleFor({ page: activeTab({ strip: stripOf() }).title }));
  drawStrip();
  hostOf().activated();
}

/** Lay the strip across the top and every tab under it, at the window's size now. */
function layout(): void {
  if (window === undefined) {
    return;
  }
  const [width] = window.getContentSize();
  stripView?.setBounds({ height: STRIP_HEIGHT, width: width!, x: 0, y: 0 });
  for (const tab of live.values()) {
    placeTab({ view: tab.view });
  }
  layoutFind();
}

/**
 * Size one tab's view under the strip.
 *
 * @param view the tab's view
 */
function placeTab({ view }: { view: WebContentsView }): void {
  if (window === undefined) {
    return;
  }
  const [width, height] = window.getContentSize();
  view.setBounds({ height: Math.max(0, height! - STRIP_HEIGHT), width: width!, x: 0, y: STRIP_HEIGHT });
}

/**
 * Send the strip what to draw now: the tabs, back and forward for the showing tab, room for the buttons, and the
 * colours of the look the console wears once a page has reported one.
 */
export function drawStrip(): void {
  if (stripView === undefined || !stripReady || stripView.webContents.isDestroyed()) {
    return;
  }
  const current = stripOf();
  const contents = tabContents({ id: current.active });
  let canGoBack = false;
  let canGoForward = false;
  if (contents !== undefined) {
    canGoBack = contents.navigationHistory.canGoBack();
    canGoForward = contents.navigationHistory.canGoForward();
  }
  const back = backTarget({ canGoBack, id: current.active, strip: current });
  stripView.webContents.send(STATE_CHANNEL, {
    inset: windowControlsState({ fullscreen, platform: process.platform, role: "strip" }) === "inset",
    markup: stripMarkup({ canGoBack: back !== undefined, canGoForward, strip: current }),
    palette: stripPaletteNow(),
  });
}
