/**
 * Find in page, applied to Electron: the find bar as its own `WebContentsView` floating over the tab showing, and
 * `findInPage` run on that tab's page. The decisions — which keys, what the bar may send, what the count reads, where
 * it sits — are `findBar.ts`; `tabsShell.ts` mounts it with the tabs and hands it every key press it takes.
 *
 * The bar is a view of its own rather than a field inside the page so a search never matches the bar's own text, and
 * so it works on every page a tab can show — a console page, the viewer, a holding page — with nothing in the console
 * itself. One bar per window, as in a browser; switching tabs while it is open searches the new tab for the same text.
 */
import { join } from "node:path";

import { type BaseWindow, ipcMain, type WebContents, WebContentsView } from "electron";

import {
  type FindAnswer,
  type FindCommand,
  type FindFocus,
  type FindShortcut,
  findBarBounds,
  findDocument,
  findStatus,
  foundAnswer,
  parseFindCommand,
} from "./findBar";

/** Main to bar: what the count reads. Bar to main: one command. Spelled again in `findPreload.ts`. */
const STATE_CHANNEL = "slopweaver:find-bar";
const COMMAND_CHANNEL = "slopweaver:find-command";

/** What the bar reaches in `tabsShell.ts`. */
export interface FindHost {
  /** The page of the tab showing, while it has one. */
  readonly activeContents: () => WebContents | undefined;
  /** A key pressed in the bar: the tab and find keys work from it as from the page. */
  readonly takeKey: (options: { readonly event: Electron.Event; readonly input: Electron.Input }) => void;
}

let host: FindHost | undefined;
let window: BaseWindow | undefined;
let barView: WebContentsView | undefined;
let barReady = false;
let listening = false;
/** Whether the bar is showing. */
let open = false;
/** The text in the bar; kept across a close, as a browser keeps it. */
let query = "";
/** Which of the bar's sent texts `query` is, echoed on every state so the bar drops a count for older text. */
let querySeq = 0;
/** The page the current search ran on. */
let searched: WebContents | undefined;
/** The id of the last `findInPage` call: only its answer is drawn, so a slow answer to older text never lands. */
let latestRequest: number | undefined;
/** The page's last answer: how many matches, and which one is lit. */
let answer: FindAnswer | undefined;
/** Pages already reporting their matches here. */
const watched = new WeakSet<WebContents>();

/**
 * Put the find bar in a newly made window, hidden until ⌘F.
 *
 * @param target the console window
 * @param findHost what the bar reaches in the tabs
 */
export function mountFind({ target, findHost }: { target: BaseWindow; findHost: FindHost }): void {
  host = findHost;
  window = target;
  barReady = false;
  // A new bar page counts its texts from one again.
  querySeq = 0;
  open = false;
  answer = undefined;
  searched = undefined;
  latestRequest = undefined;
  if (!listening) {
    listening = true;
    ipcMain.on(COMMAND_CHANNEL, (event, value: unknown) => {
      const command = parseFindCommand({ value });
      if (command !== undefined && barView !== undefined && event.sender === barView.webContents) {
        applyCommand({ command });
      }
    });
  }
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "findPreload.js"),
      sandbox: true,
      spellcheck: false,
    },
  });
  barView = view;
  view.setBackgroundColor("#00000000");
  view.setVisible(false);
  target.contentView.addChildView(view);
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.on("before-input-event", (event, input) => {
    findHost.takeKey({ event, input });
  });
  contents.once("did-finish-load", () => {
    barReady = true;
    // A ⌘F pressed before the bar's page loaded is kept, not dropped.
    if (open) {
      drawBar({ focus: "select-all" });
    }
  });
  void contents.loadURL(findDocument());
  layoutFind();
}

/** The window is closing: the search ends and the bar goes with it, and a reopened window starts with an empty one. */
export function unmountFind(): void {
  stopSearch();
  if (barView !== undefined && !barView.webContents.isDestroyed()) {
    barView.webContents.close();
  }
  barView = undefined;
  barReady = false;
  window = undefined;
  open = false;
  query = "";
}

/** Place the bar at the window's size now. */
export function layoutFind(): void {
  if (window === undefined || barView === undefined) {
    return;
  }
  const [width] = window.getContentSize();
  barView.setBounds(findBarBounds({ width: width! }));
}

/** Keep the bar above every tab's page — a tab's view added after it would otherwise cover it. */
export function raiseFind(): void {
  if (window !== undefined && barView !== undefined) {
    window.contentView.addChildView(barView);
  }
}

/**
 * Whether the bar is showing, so the window's focus can go back to it rather than the page.
 *
 * @returns `true` while the bar is open
 */
export function findOpen(): boolean {
  return open;
}

/** Give the bar the keyboard, its text selected, as ⌘F does. */
export function focusFind(): void {
  takeFocus({ focus: "select-all" });
}

/**
 * Put the keyboard in the bar's field, when the bar is open.
 *
 * @param focus `select-all` selects the field's text, as ⌘F does; `preserve` keeps the caret where it was
 */
function takeFocus({ focus }: { focus: Exclude<FindFocus, "none"> }): void {
  if (open && barView !== undefined && !barView.webContents.isDestroyed()) {
    barView.webContents.focus();
    drawBar({ focus });
  }
}

/**
 * Apply one find key, from the page, the strip or the bar.
 *
 * @param shortcut the key's meaning
 */
export function applyFindShortcut({ shortcut }: { shortcut: FindShortcut }): void {
  switch (shortcut.kind) {
    case "open":
      openBar();
      return;
    case "next":
      step({ forward: true });
      return;
    case "previous":
      step({ forward: false });
      return;
    default: {
      const unreachable: never = shortcut;
      return unreachable;
    }
  }
}

/**
 * Another tab is showing: with the bar open, the old page's highlights go and the new page is searched for the same
 * text, as a browser does.
 */
export function findTabShown(): void {
  raiseFind();
  if (!open) {
    return;
  }
  const contents = host?.activeContents();
  if (contents === searched) {
    return;
  }
  stopSearch();
  search({ fresh: true });
}

/** Show the bar with the keyboard in it, searching again for the text it kept. */
function openBar(): void {
  if (barView === undefined || barView.webContents.isDestroyed()) {
    return;
  }
  const wasOpen = open;
  open = true;
  barView.setVisible(true);
  raiseFind();
  focusFind();
  if (!wasOpen && query !== "") {
    search({ fresh: true });
  }
}

/** Hide the bar, clear the page's highlights, and give the page back the keyboard. */
function closeBar(): void {
  open = false;
  stopSearch();
  barView?.setVisible(false);
  host?.activeContents()?.focus();
}

/**
 * Apply one command off the bar.
 *
 * @param command what was typed or pressed
 */
function applyCommand({ command }: { command: FindCommand }): void {
  switch (command.kind) {
    case "query":
      query = command.text;
      querySeq = command.seq;
      if (query === "") {
        stopSearch();
        drawBar({ focus: "none" });
      } else {
        search({ fresh: true });
      }
      return;
    case "next":
      step({ forward: true });
      return;
    case "previous":
      step({ forward: false });
      return;
    case "close":
      closeBar();
      return;
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

/**
 * Go to the next or previous match — opening the bar on the text it kept, when ⌘G finds it closed.
 *
 * @param forward towards the end of the page
 */
function step({ forward }: { forward: boolean }): void {
  if (!open) {
    openBar();
  }
  if (query === "") {
    return;
  }
  const contents = host?.activeContents();
  // A console page fills in after it loads, so a search run as it loaded can find nothing that is there now: a step
  // from nothing searches the page afresh.
  const foundNothing = answer?.matches === 0;
  search({ forward, fresh: contents !== searched || foundNothing });
}

/**
 * Search the tab showing for the bar's text.
 *
 * @param fresh a new search (new text, or a page not searched yet) rather than a step through this one's matches
 * @param forward which way a step goes
 */
function search({ fresh, forward = true }: { fresh: boolean; forward?: boolean }): void {
  const contents = host?.activeContents();
  if (contents === undefined || contents.isDestroyed() || query === "") {
    return;
  }
  watch({ contents });
  if (fresh) {
    answer = undefined;
  }
  searched = contents;
  // `findNext: true` STARTS a session (new text, or a page not searched yet); `false` steps through its matches.
  latestRequest = contents.findInPage(query, { findNext: fresh, forward });
  // A search can move the keyboard to the page it ran on, and the next letter would land
  // there: the bar takes it back, the caret where it was. Taking it back also redraws the bar, so a fresh search
  // blanks the old text's count at once rather than leaving it beside the new text until the page answers.
  takeFocus({ focus: "preserve" });
}

/** End the search on the page it ran on, clearing its highlights. */
function stopSearch(): void {
  if (searched !== undefined && !searched.isDestroyed()) {
    searched.stopFindInPage("clearSelection");
  }
  searched = undefined;
  answer = undefined;
  latestRequest = undefined;
}

/**
 * Hear a page's answers to the searches run on it, and search it again when it moves to another page under the open
 * bar, so the count is never the last page's. Once per page.
 *
 * @param contents the page
 */
function watch({ contents }: { contents: WebContents }): void {
  if (watched.has(contents)) {
    return;
  }
  watched.add(contents);
  contents.on("found-in-page", (_event, result) => {
    if (contents !== searched || result.requestId !== latestRequest) {
      return;
    }
    answer = foundAnswer({ answer, result });
    drawBar({ focus: "none" });
  });
  const searchAgain = (): void => {
    if (open && contents === searched && contents === host?.activeContents()) {
      search({ fresh: true });
    }
  };
  // The document searched is gone — replaced by a new one, or its renderer died: its count goes now, not when a new
  // document finishes loading.
  const forgetCount = (): void => {
    if (contents === searched) {
      answer = undefined;
      latestRequest = undefined;
      drawBar({ focus: "none" });
    }
  };
  contents.on("did-navigate", forgetCount);
  contents.on("render-process-gone", forgetCount);
  contents.on("did-finish-load", searchAgain);
  contents.on("did-navigate-in-page", searchAgain);
}

/**
 * Send the bar what to show: the count, whether there is a match to step to, and where the keyboard goes.
 *
 * @param focus `select-all` puts the keyboard in the field with its text selected, `preserve` with the caret where it
 * was, `none` leaves the keyboard alone
 */
function drawBar({ focus }: { focus: FindFocus }): void {
  if (barView === undefined || !barReady || barView.webContents.isDestroyed()) {
    return;
  }
  barView.webContents.send(STATE_CHANNEL, { focus, seq: querySeq, ...findStatus({ answer, query }) });
}
