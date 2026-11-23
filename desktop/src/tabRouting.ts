/**
 * Which tab a console page opens in, and what keeps every tab on the console. `tabsShell.ts` owns the tabs' views and
 * `tabStrip.ts` their rules; this decides where a path goes — the pinned Queue tab, the tab showing, a tab by id, or a
 * new tab after its opener — loads a tab whole when it must, and guards each tab's page so a link off the console opens
 * in the owner's browser and a bare document opens inside the viewer. `main.ts` owns the window and the console's state, and
 * lends them through `RoutingHost`.
 */
import { shell, type WebContents } from "electron";

import { dropNavigationAsk, moveConsoleWindow, watchPageCommits } from "./navigationShell";
import { consolePath, consolePathOf } from "./persistedState";
import {
  consoleUrl,
  frameNavigationDecision,
  holdingPage,
  inAppViewPath,
  isBareDocument,
  isVoicePath,
  loadsAfterRecovery,
  navigatedFrom,
  withoutSurfaceFlag,
} from "./surface";
import {
  activeTabId,
  committedOf,
  everyTabContents,
  openNewTab,
  pinnedTabId,
  setCommitted,
  setTabPath,
  showTab,
  tabContents,
  tabIdOf,
  tabPath,
} from "./tabsShell";

/** What the routing reaches in `main.ts`. */
export interface RoutingHost {
  /** The console's origin, once it is serving. */
  readonly consoleOrigin: () => string | undefined;
  /** Why the console is not serving, while it needs the owner's attention; `undefined` while it serves or comes up. */
  readonly downProblem: () => string | undefined;
  /** The console is down inside a normal update's restart window (`consoleRestartHold.ts`), so the page stays quiet. */
  readonly restarting: () => boolean;
  /** The console window is open. */
  readonly windowOpen: () => boolean;
  /** Bring the console window forward, creating it when it was closed. */
  readonly bringWindowForward: () => void;
  /** The tab showing landed on a console page: the menu bar and the saved state follow it. */
  readonly pageVisited: (options: { readonly path: string }) => void;
  /** A page navigated or died: end its captures. */
  readonly retireContents: (options: { readonly contentsId: number }) => void;
  /** A page failed to load in a way that may mean the console is down. */
  readonly recover: () => void;
}

/** Which tab a path is shown in: the pinned Queue tab, a tab by id, or a new tab after the one that opened it. */
export type ShowTarget =
  | { readonly kind: "pinned" }
  | { readonly kind: "tab"; readonly id: string }
  | { readonly kind: "new"; readonly opener: string | undefined; readonly foreground: boolean };

/** The pinned tab: the menu bar's Open Queue, a second launch and the app's first page. */
export const PINNED: ShowTarget = { kind: "pinned" };

let host: RoutingHost | undefined;

/**
 * The host, once `startRouting` has run.
 *
 * @returns the host
 */
function hostOf(): RoutingHost {
  if (host === undefined) {
    throw new Error("the tab routing was used before startRouting");
  }
  return host;
}

/**
 * Lend the routing what it reaches in `main.ts`, before any tab opens.
 *
 * @param routingHost the window and console state it reads and the effects it asks for
 */
export function startRouting({ routingHost }: { routingHost: RoutingHost }): void {
  host = routingHost;
}

/** What the in-place navigation half reaches here (`navigationShell.ts`): always the tab showing. */
export const navigationHost = {
  activeContents: (): WebContents | undefined => tabContents({ id: activeTabId() }),
  loadWhole: ({ path }: { readonly path?: string }): void => {
    loadTab({ id: activeTabId(), path });
  },
};

/**
 * Load what a tab should show now: the page it is waiting for (`path`, given), or a holding page.
 *
 * @param id the tab
 * @param path the page to wait for from now on; omitted, the one it already waits for
 */
export function loadTab({ id, path }: { id: string; path?: string | undefined }): void {
  if (path !== undefined) {
    setTabPath({ id, path });
  }
  const contents = tabContents({ id });
  if (contents === undefined) {
    return;
  }
  if (id === activeTabId()) {
    dropNavigationAsk();
  }
  setCommitted({ id, path: undefined });
  // Every load goes through here, the remembered page included: a bare document recorded some other way — a page's
  // own history entry, or a last page saved by a build before the viewer — still opens in the viewer.
  const waiting = inAppViewPath({ from: undefined, path: tabPath({ id }) });
  setTabPath({ id, path: waiting });
  const origin = hostOf().consoleOrigin();
  if (origin !== undefined) {
    void contents.loadURL(consoleUrl({ origin, path: waiting }));
    return;
  }
  const problem = hostOf().downProblem();
  if (problem !== undefined) {
    void contents.loadURL(
      holdingPage({ detail: `${problem}. Retry Console is in the menu bar.`, title: "The console is not serving" }),
    );
    return;
  }
  if (hostOf().restarting()) {
    void contents.loadURL(
      holdingPage({
        detail: "The console is restarting onto a new build. This page comes back by itself.",
        title: "Slopweaver is updating",
      }),
    );
    return;
  }
  void contents.loadURL(
    holdingPage({
      detail: "Bringing the console up. This can take a minute after a pull.",
      title: "Starting Slopweaver",
    }),
  );
}

/**
 * After the console was recovered or adopted, load each open tab only when it is not already showing a page on that
 * console (`loadsAfterRecovery`) — a check that failed must never cost the owner a page they have open.
 */
export function loadTabsAfterRecovery(): void {
  for (const contents of everyTabContents()) {
    const id = tabIdOf({ contents });
    const url = contents.getURL();
    if (
      id !== undefined &&
      loadsAfterRecovery({ current: committedOf({ id }), origin: hostOf().consoleOrigin(), url })
    ) {
      loadTab({ id });
    }
  }
}

/**
 * Show the console window on a page, creating it when it was closed. A tab already on that page is only brought
 * forward, and a tab on another console page is asked to go there in place — never reloaded (`moveOnShow`), so a move
 * the voice or the menu bar starts keeps the page's sidebar and state as a click would. A bare document — a local
 * page, a docs page — opens inside the viewer, whose first control goes back to the page it was opened from
 * (`inAppViewPath`); every caller comes through here, so none can put one in a tab on its own.
 *
 * A briefing, a card's pull request and a card's board link never replace the page the owner is reading. So a link a
 * page opens in a new window — every card citation — opens in a NEW tab, and what the menu bar opens goes to the
 * pinned Queue tab, never over the tab the owner is reading. The card the voice
 * opens goes to the pinned tab too, and never comes through here, because it never raises the window:
 * {@link showInPinnedTab}. A Queue address a deep link asks for lands in the pinned tab as well (`deepLinkTarget`).
 *
 * @param path the console page to open; omitted, the window shows wherever the owner left it
 * @param target the tab to show it in; omitted, the tab showing
 * @param navigated the tab's own page navigated to the path, which opens it from no page when that page is the viewer
 *   (`navigatedFrom`)
 */
export function showWindow({
  path,
  target,
  navigated = false,
}: {
  path?: string;
  target?: ShowTarget;
  navigated?: boolean;
}): void {
  if (path === undefined) {
    if (hostOf().windowOpen()) {
      moveConsoleWindow({ asked: undefined, current: committedOf({ id: activeTabId() }), host: navigationHost });
    }
    hostOf().bringWindowForward();
    return;
  }
  if (target?.kind === "new") {
    let from: string | undefined;
    if (target.opener !== undefined) {
      from = committedOf({ id: target.opener });
    }
    openNewTab({ foreground: target.foreground, opener: target.opener, path: inAppViewPath({ from, path }) });
    hostOf().bringWindowForward();
    return;
  }
  let id = activeTabId();
  if (target?.kind === "pinned") {
    id = pinnedTabId();
  } else if (target?.kind === "tab") {
    id = target.id;
  }
  placeInTab({ id, navigated, path });
  hostOf().bringWindowForward();
}

/**
 * Put a console page in one tab and show that tab in the strip, touching the window itself not at all: what raises it
 * is the caller's, so {@link showWindow} does and {@link showInPinnedTab} never does.
 *
 * @param id the tab
 * @param navigated the tab's own page navigated to the path (`navigatedFrom`)
 * @param path the console page
 */
function placeInTab({ id, navigated, path }: { id: string; navigated: boolean; path: string }): void {
  let from = committedOf({ id });
  if (navigated) {
    from = navigatedFrom({ from });
  }
  const asked = inAppViewPath({ from, path });
  const current = committedOf({ id });
  const hadPage = tabContents({ id }) !== undefined;
  setTabPath({ id, path: asked });
  showTab({ id });
  // A tab with no page yet loads the asked page as it is shown; one with a page is moved as showing it needs.
  if (hostOf().windowOpen() && hadPage) {
    moveConsoleWindow({ asked, current, host: navigationHost });
  }
}

/**
 * Put a console page in the pinned Queue tab and show that tab in the strip, and leave the window exactly where it
 * is: never created, restored, shown or focused for it. The Queue or Alignment card the voice opens comes through here.
 *
 * WHERE: the pinned tab is the one static tab that never closes, and a card the voice opens while walking the owner
 * through the Queue is expected there — so a briefing the owner opened beside it keeps its own tab rather than being
 * replaced by the card, and the walk never lands in a second Queue tab. The WINDOW: the app is never brought forward
 * for the voice's card, and the owner sees the card on switching to it. So a window behind another app, or minimised,
 * moves in place and is on the card when the owner switches to it; a closed one keeps the card as that tab's page, which its next open
 * loads; and under the voice's full-screen stage the card waits behind it for when the owner leaves full screen, never beside
 * the orb. A bare document still opens inside the viewer, as through {@link showWindow}.
 *
 * @param pathFor the console page to put in the pinned tab, built from that tab's own live address
 *   (its context, sidebar and tags are the ones the owner will see, never the tab they happened to be on)
 */
export function showInPinnedTab({
  pathFor,
}: {
  pathFor: (live: { readonly liveUrl: string | undefined }) => string;
}): void {
  const id = pinnedTabId();
  placeInTab({ id, navigated: false, path: pathFor({ liveUrl: tabContents({ id })?.getURL() }) });
}

/**
 * The page path of a URL on the console, with the shell's own flag removed.
 *
 * @param url the URL a window is on
 * @returns the path, or `undefined` when the URL is not on the console
 */
export function pathOnConsole({ url }: { url: string }): string | undefined {
  const origin = hostOf().consoleOrigin();
  const path = origin === undefined ? undefined : consolePathOf({ origin, url });
  return path === undefined ? undefined : withoutSurfaceFlag({ path });
}

/**
 * The console path a frame inside a tab's page navigates to. While the console is being recovered its origin is
 * unknown, yet the tab's page and the briefing framed in it are still on it: a briefing linking another
 * then is judged against the page's own origin, so it stays in the frame rather than going to the owner's browser.
 *
 * @param contents the tab's page
 * @param url where the frame goes
 * @returns the path, flag removed, or `undefined` when it leaves the console
 */
function framePathOnConsole({ contents, url }: { contents: WebContents; url: string }): string | undefined {
  const known = pathOnConsole({ url });
  if (known !== undefined || hostOf().consoleOrigin() !== undefined) {
    return known;
  }
  const page = contents.getURL();
  if (!URL.canParse(page)) {
    return undefined;
  }
  const pageUrl = new URL(page);
  if (pageUrl.protocol !== "http:") {
    return undefined;
  }
  const path = consolePathOf({ origin: pageUrl.origin, url });
  return path === undefined ? undefined : withoutSurfaceFlag({ path });
}

/**
 * Open a link outside the shell in the owner's browser, for the schemes a browser handles.
 *
 * @param url the link
 */
export function openOutside({ url }: { url: string }): void {
  if (/^(https?|mailto):/u.test(url)) {
    void shell.openExternal(url);
  }
}

/**
 * Keep a tab on the console: a link anywhere else opens in the owner's browser, a new window on the console opens as a new
 * tab after this one (behind it for a ⌘-click), a bare document opens inside the viewer rather than in place of the
 * page, a framed document's own plain-clicked link goes where its ⌘-click would, the overlay's page never loads here,
 * and the page the tab lands on is remembered.
 *
 * @param tabId the strip's id for the tab whose page this guards
 * @param contents its page
 */
export function guardConsoleNavigation({ tabId, contents }: { tabId: string; contents: WebContents }): void {
  // A bare document this tab's own page went to opens inside the viewer, in this tab. The tab showing goes there as
  // a click would; a tab behind — a ⌘-clicked `/model` the server redirects into `/docs` — loads it where it is,
  // since showing it would take the owner off their page and drop the move in flight there.
  const openInViewer = ({ path }: { path: string }): void => {
    if (tabId === activeTabId()) {
      showWindow({ navigated: true, path, target: { id: tabId, kind: "tab" } });
      return;
    }
    loadTab({ id: tabId, path: inAppViewPath({ from: navigatedFrom({ from: committedOf({ id: tabId }) }), path }) });
  };
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const path = pathOnConsole({ url });
    if (path !== undefined && !isVoicePath({ path })) {
      showWindow({ path, target: { foreground: disposition !== "background-tab", kind: "new", opener: tabId } });
    } else if (path === undefined) {
      openOutside({ url });
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const path = pathOnConsole({ url });
    if (path !== undefined && !isVoicePath({ path }) && !isBareDocument({ path })) {
      return;
    }
    event.preventDefault();
    if (path === undefined) {
      openOutside({ url });
    } else if (!isVoicePath({ path })) {
      openInViewer({ path });
    }
  });
  // A frame inside the page — a briefing in the preview modal or the viewer — following its own link goes where a
  // ⌘-click on it would (`frameNavigationDecision`): the owner's browser, or a new tab after this one.
  contents.on("will-frame-navigate", (details) => {
    const { frame, initiator } = details;
    const selfInitiated = frame !== null && initiator != null && frame.frameTreeNodeId === initiator.frameTreeNodeId;
    const path = framePathOnConsole({ contents, url: details.url });
    const decision = frameNavigationDecision({
      isMainFrame: details.isMainFrame,
      path,
      selfInitiated,
      url: details.url,
    });
    if (decision === "allow") {
      return;
    }
    details.preventDefault();
    if (decision === "open-outside") {
      openOutside({ url: details.url });
    } else if (decision === "open-console-tab" && path !== undefined) {
      showWindow({ path, target: { foreground: true, kind: "new", opener: tabId } });
    }
  });
  // A console page the server redirects to a bare document — `/model` moved under `/docs` (`site/next.config.mjs`) —
  // is not a `will-navigate`, so it is caught here. The viewer's own frame redirecting is not the window's.
  contents.on("will-redirect", (details) => {
    const path = pathOnConsole({ url: details.url });
    if (!details.isMainFrame || path === undefined || !isBareDocument({ path })) {
      return;
    }
    details.preventDefault();
    openInViewer({ path });
  });
  const remember = ({ url }: { url: string }): void => {
    const path = pathOnConsole({ url });
    if (path === undefined || consolePath({ path }) === undefined) {
      return;
    }
    setTabPath({ id: tabId, path });
    setCommitted({ id: tabId, path });
    if (tabId === activeTabId()) {
      hostOf().pageVisited({ path });
    }
  };
  const contentsId = contents.id;
  contents.on("did-navigate", (_event, url) => {
    hostOf().retireContents({ contentsId });
    remember({ url });
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) {
      remember({ url });
    }
  });
  watchPageCommits({ contents, host: navigationHost, pathOf: pathOnConsole });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    // Any main-frame failure, an aborted one included, leaves nothing proven on screen, so the next show
    // reloads; a replacing navigation that does commit sets the path again. -3 alone is no dead console.
    setCommitted({ id: tabId, path: undefined });
    if (code !== -3) {
      hostOf().recover();
    }
  });
  contents.on("render-process-gone", () => {
    setCommitted({ id: tabId, path: undefined });
    hostOf().retireContents({ contentsId });
  });
}
