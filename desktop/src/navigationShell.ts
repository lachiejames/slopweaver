/**
 * The console window moved to another page IN PLACE, never by a whole-document load (`surface.ts` `moveOnShow`).
 *
 * A whole-document load while the owner reads a briefing reloads the whole app, goes back out of the
 * briefing, back to the queue page and opens an unrelated queue card — which is what `main.ts`'s `loadURL` of a card
 * the voice opened does. Here main asks the page to go there itself: the preload hands the
 * path to the page's own navigator and answers, for the document that received it, whether it was taken. The request
 * stays open until the page's commits settle it (`askedMoveOnCommit`). A page that says no, a request lost with its
 * document, or a new document committing anywhere else loads the window whole onto the ASKED page — never onto
 * whatever page loaded meanwhile.
 */
import { ipcMain, type WebContents } from "electron";

import { parseNavigationAck } from "./desktopBridge";
import { askedMoveOnCommit, moveOnShow, samePage } from "./surface";

/**
 * How long the page has to answer before the window is loaded whole instead. A heuristic, never a witness: a live
 * page's preload answers within one IPC round trip, so only a request lost with its document ever waits this long.
 * Once the page has answered, the move itself has no limit, since a router fetching a server page may take longer.
 */
const NAVIGATION_ACK_MS = 2_000;

/** The one move the page has not finished yet, which a newer request or any load replaces. */
let outstanding:
  | {
      readonly id: string;
      readonly path: string;
      readonly timer: NodeJS.Timeout | undefined;
      /** The tab's page the move was asked of: a commit or an answer from any other tab is not about it. */
      readonly contentsId: number;
      readonly taken: boolean;
      readonly leaving: boolean;
    }
  | undefined;
let nextId = 0;

/** What the navigation half reaches in `main.ts`. */
export interface NavigationHost {
  /** The page of the tab showing in the console window, while the window is open and the tab is loaded. */
  readonly activeContents: () => WebContents | undefined;
  /** Load the showing tab whole: onto `path` when given, else onto the page it is waiting for. */
  readonly loadWhole: (target: { readonly path?: string }) => void;
}

/**
 * Move the console window as showing it needs (`moveOnShow`): only brought forward, asked to move in place, or loaded
 * whole when no console page is committed in it.
 *
 * @param host what this reaches in `main.ts`
 * @param asked the page to show, or `undefined` for "wherever the owner left it"
 * @param current the page the window is on now, flag removed, or `undefined` when no console page is committed there
 */
export function moveConsoleWindow({
  host,
  asked,
  current,
}: {
  host: NavigationHost;
  asked: string | undefined;
  current: string | undefined;
}): void {
  const move = moveOnShow({ asked, current });
  if (move === "load") {
    host.loadWhole({});
  } else if (move === "navigate" && asked !== undefined) {
    askPageToNavigate({ host, path: asked });
  }
}

/** Forget the move the page has not finished, so nothing about it loads a page loaded since. */
export function dropNavigationAsk(): void {
  if (outstanding !== undefined) {
    clearTimeout(outstanding.timer);
    outstanding = undefined;
  }
}

/**
 * Load the asked page whole in place of a move that will not land.
 *
 * @param host what this reaches in `main.ts`
 * @param path the page the move was for
 */
function loadAskedWhole({ host, path }: { host: NavigationHost; path: string }): void {
  dropNavigationAsk();
  host.loadWhole({ path });
}

/**
 * Ask the showing tab's page to go to a console page itself, replacing any move still open.
 *
 * @param host what this reaches in `main.ts`
 * @param path the console path to go to
 */
function askPageToNavigate({ host, path }: { host: NavigationHost; path: string }): void {
  const target = host.activeContents();
  if (target === undefined) {
    return;
  }
  dropNavigationAsk();
  nextId += 1;
  const id = String(nextId);
  const timer = setTimeout(() => {
    if (outstanding?.id === id) {
      loadAskedWhole({ host, path });
    }
  }, NAVIGATION_ACK_MS);
  outstanding = { contentsId: target.id, id, leaving: false, path, taken: false, timer };
  target.send("slopweaver:navigate", { id, path });
}

/**
 * Tell the move in flight that the console window committed a page (`askedMoveOnCommit`): settled, it is done; lost,
 * the asked page is loaded whole.
 *
 * @param host what this reaches in `main.ts`
 * @param committed the page that committed, flag removed, or `undefined` when it is not on the console
 * @param inPage the commit was a same-document navigation rather than a new document
 */
function notePageCommit({
  host,
  committed,
  inPage,
}: {
  host: NavigationHost;
  committed: string | undefined;
  inPage: boolean;
}): void {
  if (outstanding === undefined) {
    return;
  }
  const { path, taken, leaving } = outstanding;
  const next = askedMoveOnCommit({ asked: path, committed, inPage, leaving, taken });
  if (next === "settled") {
    dropNavigationAsk();
  } else if (next === "load") {
    loadAskedWhole({ host, path });
  }
}

/**
 * Watch the console window's own navigations for the move in flight. A whole-document load starting toward the asked
 * page is that move, an older build's page handing its push to a load, and redirects included, its commit settles it.
 * Registered after `main.ts` remembers each commit, so a load this starts is the last word on the window's page.
 *
 * @param host what this reaches in `main.ts`
 * @param contents the console window's page
 * @param pathOf the console path of an address, flag removed, or `undefined` off the console
 */
export function watchPageCommits({
  host,
  contents,
  pathOf,
}: {
  host: NavigationHost;
  contents: WebContents;
  pathOf: (address: { readonly url: string }) => string | undefined;
}): void {
  const asked = (): boolean => outstanding?.contentsId === contents.id;
  contents.on("did-start-navigation", (details) => {
    const started = pathOf({ url: details.url });
    if (outstanding === undefined || !asked() || !details.isMainFrame || details.isSameDocument) {
      return;
    }
    if (started === undefined) {
      return;
    }
    // Once taken, a new document starting anywhere is the owner's own navigation or the push handed to a load: either way
    // it is where the owner goes, and loading the asked page over it would take them back.
    if (outstanding.taken || samePage({ left: outstanding.path, right: started })) {
      outstanding = { ...outstanding, leaving: true };
    }
  });
  contents.on("did-navigate", (_event, url) => {
    if (asked()) {
      notePageCommit({ committed: pathOf({ url }), host, inPage: false });
    }
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && asked()) {
      notePageCommit({ committed: pathOf({ url }), host, inPage: true });
    }
  });
}

/**
 * Take the page's answers: taken, its router has started the move and the request waits for the commit that settles
 * it; not taken, the asked page is loaded whole. Only the answer of the tab the request was sent to counts.
 *
 * @param host what this reaches in `main.ts`
 */
export function installNavigationAnswers({ host }: { host: NavigationHost }): void {
  ipcMain.on("slopweaver:navigate-ack", (event, value: unknown) => {
    const ack = parseNavigationAck({ value });
    if (ack === undefined || outstanding?.contentsId !== event.sender.id) {
      return;
    }
    if (outstanding.id !== ack.id) {
      return;
    }
    if (!ack.taken) {
      loadAskedWhole({ host, path: outstanding.path });
      return;
    }
    clearTimeout(outstanding.timer);
    outstanding = { ...outstanding, taken: true, timer: undefined };
  });
}
