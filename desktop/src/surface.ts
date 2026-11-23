/**
 * The console's addresses as the shell loads and remembers them. Every load the shell starts carries
 * `?sw-surface=native`: the console's pre-paint script turns it into `<html data-sw-surface="native">`, which paints
 * the palette's flat ground in place of the browser tab's wallpaper — the window is opaque, like every surface in it.
 * The flag is the shell's, not the page's, so it is stripped again before a page is
 * remembered or compared. Pure.
 */
import { consolePathOf } from "./persistedState";

/** The query parameter, and its one value. */
const SURFACE_PARAM = "sw-surface";
const SURFACE_NATIVE = "native";

/** The overlay's one page. */
export const VOICE_PATH = "/voice";

/**
 * The URL to load for a console page, flagged for the native surface.
 *
 * @param origin the console's origin
 * @param path the page's path, query and hash
 * @returns the absolute URL
 */
export function consoleUrl({ origin, path }: { origin: string; path: string }): string {
  const url = new URL(path, origin);
  url.searchParams.set(SURFACE_PARAM, SURFACE_NATIVE);
  return url.toString();
}

/**
 * A page that is not the console: starting, or why it is not serving. Local, inline, no script.
 *
 * It declares no `-webkit-app-region`. A tab's view keeps the last drag region a page reported until another page
 * reports one, and a console page in a tab reports none (the tab strip is the window's drag area), so a holding page
 * whose body was `drag` left the Queue tab's whole view a title bar under every page after it: no click or scroll
 * landed, and a double-click zoomed the window. Every launch shows this page while the console comes up, so a
 * relaunch never clears it. Measured on Electron 44.4.5 with a
 * `BaseWindow`, a strip view and a tab view that loads a `drag` page then a page with a button: native clicks never
 * reached the button and a double-click zoomed the window; with no region on the first page, every click landed.
 *
 * @param title the line at the top
 * @param detail the line under it
 * @returns a `data:` URL
 */
export function holdingPage({ title, detail }: { title: string; detail: string }): string {
  const escape = ({ text }: { text: string }): string =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const html = `<!doctype html><meta charset="utf-8"><title>Slopweaver</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f1115;color:#e7e9ee;font:15px/1.5 -apple-system,system-ui,sans-serif"><div style="text-align:center;max-width:36em;padding:2em"><div style="font-size:20px;font-weight:600;margin-bottom:.5em">${escape({ text: title })}</div><div style="opacity:.75">${escape({ text: detail })}</div></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * A page's path with the shell's own flag taken back out.
 *
 * @param path a path, query and hash as the window reports it
 * @returns the same page without `sw-surface`
 */
export function withoutSurfaceFlag({ path }: { path: string }): string {
  const url = new URL(path, "http://localhost:1");
  url.searchParams.delete(SURFACE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Whether showing the console window has to load a page into it, or only bring it forward.
 *
 * Bringing the window into focus never reloads it: a `loadURL` on a window already showing the console is a whole
 * document load that drops every live reading the page held, so the cards would vanish and be slowly re-added. A
 * window already on the asked page is only shown. A bare page (`/queue`) is the page the owner is on whatever its
 * query, since the query is their context and filter; a page asked WITH a query or hash is that exact address.
 *
 * @param current the page the window is on now, flag removed, or `undefined` when it is not on the console (a
 *   holding page while the console was starting, or nothing loaded yet)
 * @param asked the page to show, or `undefined` for "wherever the owner left it", which an app activation means
 * @returns true when the window must load `asked` (or, with none asked, the page it is waiting for)
 */
export function loadsOnShow({ current, asked }: { current: string | undefined; asked: string | undefined }): boolean {
  if (current === undefined) {
    return true;
  }
  if (asked === undefined) {
    return false;
  }
  const want = new URL(asked, "http://localhost:1");
  const have = new URL(current, "http://localhost:1");
  if (want.pathname !== have.pathname) {
    return true;
  }
  if (want.search === "" && want.hash === "") {
    return false;
  }
  return want.search !== have.search || want.hash !== have.hash;
}

/**
 * How showing the console window moves it: only brought forward, moved by the page it is on, or loaded whole.
 *
 * A move to another page is never a `loadURL` — a whole-document load throws away the page, its sidebar and everything
 * it held, so a briefing being read would be left for the queue. A window on a console page asks that page to go there
 * itself, an in-page navigation like any click on a link; only a window with no console page committed is loaded whole.
 *
 * @param current the page the window is on now, flag removed, or `undefined` when no console page is committed there
 * @param asked the page to show, or `undefined` for "wherever the owner left it"
 * @returns `show` to only bring it forward, `navigate` to ask the page to go to `asked`, `load` to load the window
 */
export function moveOnShow({
  current,
  asked,
}: {
  current: string | undefined;
  asked: string | undefined;
}): "show" | "navigate" | "load" {
  if (!loadsOnShow({ asked, current })) {
    return "show";
  }
  if (current === undefined || asked === undefined) {
    return "load";
  }
  return "navigate";
}

/**
 * What a page committed in the console window means for a move the page was asked to make (`moveOnShow`).
 *
 * The page's "taken" says only that its router STARTED the move, so the request stays open past it. Once taken, the
 * next in-page commit settles it wherever it landed: the asked page, a redirect's target, or a click of the owner's that Next
 * lets supersede the push. Loading the asked page after that would take the owner somewhere they already left. A page from an
 * older build hands a push to a whole load of its own, and one asked again before that load commits is destroyed by it,
 * so a whole-document commit settles the move only when a load that is the move or the owner's own started since the ask;
 * otherwise it was lost and the asked page is loaded whole. Before the answer, an in-page commit elsewhere is not the move, so it waits.
 *
 * @param asked the console page the window was asked to move to
 * @param committed the page that committed, flag removed, or `undefined` when it is not on the console
 * @param inPage the commit was a same-document navigation rather than a new document
 * @param taken the page answered that its router took the move
 * @param leaving a whole-document load started since the ask that is the move or the owner's own: toward the asked page, or
 *   anywhere once taken
 * @returns `settled` when the move is over, `load` to load the asked page whole, `wait` to keep waiting
 */
export function askedMoveOnCommit({
  asked,
  committed,
  inPage,
  taken,
  leaving,
}: {
  asked: string;
  committed: string | undefined;
  inPage: boolean;
  taken: boolean;
  leaving: boolean;
}): "settled" | "load" | "wait" {
  if (committed !== undefined && samePage({ left: asked, right: committed })) {
    return "settled";
  }
  if (inPage) {
    return taken ? "settled" : "wait";
  }
  return leaving ? "settled" : "load";
}

/**
 * Whether two console addresses name the same page, whatever escaping the router gave the query (`:` and `%3A`).
 *
 * @param left one path, query and hash
 * @param right the other
 * @returns true when the pathname, the query parameters and the hash agree
 */
export function samePage({ left, right }: { left: string; right: string }): boolean {
  const one = new URL(left, "http://localhost:1");
  const two = new URL(right, "http://localhost:1");
  return (
    one.pathname === two.pathname &&
    one.searchParams.toString() === two.searchParams.toString() &&
    one.hash === two.hash
  );
}

/**
 * Whether a recovery of the console has to load a page into the window, or leave the one it shows alone.
 *
 * Switching back to Slopweaver never reloads the whole UI. The shell checks the console every fifteen seconds, and a
 * check that fails — a probe slower than its timeout while the machine is loaded, or the console swapped to a new build
 * on a landing — starts a recovery, and a whole-document load of the window even when it found the same console the
 * window was already showing would take the page the owner had open, its scroll, its open card and its viewer with it,
 * visibly, the moment the window was in front again. The page's own reads retry until the console answers
 * (`site/lib/liveRetry.ts`), and a page whose build was replaced is reloaded by Next on the owner's next navigation, so a
 * window already on the console is left as it is.
 *
 * @param current the page the window is on now, flag removed, or `undefined` when no console page is committed there
 *   (a holding page, a load that failed or was aborted, nothing loaded yet)
 * @param origin the console's origin after the recovery, or `undefined` when it failed and the holding page saying
 *   so is what the window should show
 * @param url the address the window is on now, as Electron reports it
 * @returns true when the window must load the page it is waiting for (or the holding page)
 */
export function loadsAfterRecovery({
  current,
  origin,
  url,
}: {
  current: string | undefined;
  origin: string | undefined;
  url: string;
}): boolean {
  if (current === undefined || origin === undefined) {
    return true;
  }
  return consolePathOf({ origin, url }) === undefined;
}

/**
 * The console page that shows a document inside the console's own frame, under a bar whose first control goes back,
 * restated from `site/lib/inAppView.ts` because neither tree can import the other.
 */
export const VIEW_PATH = "/view";

/** The page {@link inAppViewPath} goes back to when the window was on no console page. */
const QUEUE_PATH = "/queue";

/**
 * A file's own name: a last segment with a dot in it, what the console serves at its root (`/icon.svg`) rather than a
 * page, whose last segment never has one. Any extension, so no file type is missed. Restated from
 * `site/lib/inAppView.ts`.
 */
const STATIC_FILE = /\/[^/]*\.[^/]*$/u;

/**
 * A console path's pathname with its percent escapes decoded, or `undefined` when they do not decode.
 *
 * @param path a path, query and hash on the console
 * @returns the decoded pathname
 */
function decodedPathname({ path }: { path: string }): string | undefined {
  const { pathname } = new URL(path, "http://localhost:1");
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

/**
 * Whether a console path is a bare document rather than a console page: a file the console SERVES (`/api/…`, where a
 * local page lives at `/api/page/<slug>/index.html`, a build asset under `/_next/`, or a static file such as
 * `/icon.svg`) or a docs page (`/docs…`, Nextra's own root layout). None is drawn inside the console's shell, so loaded
 * into the window on its own it has no sidebar and no way back (`/icon.svg` is one).
 *
 * Judged on the DECODED pathname, the one the server routes on, so `/icon%2Esvg` is the file it serves.
 * A pathname that does not decode is treated as a bare document: the viewer refuses it under its own Back.
 *
 * @param path a path, query and hash on the console
 * @returns true for a path that has to be shown inside the viewer
 */
export function isBareDocument({ path }: { path: string }): boolean {
  const pathname = decodedPathname({ path });
  if (pathname === undefined) {
    return true;
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || STATIC_FILE.test(pathname)) {
    return true;
  }
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

/**
 * Where the console window goes for a path a link asked it to show — the path itself, or for a bare document the
 * viewer framing it, with the page the owner was on as the way back.
 *
 * A Queue card's local page opened in the window on its own would have no way back to the Queue. A card's page link
 * opens a new window, which this shell turns into a load of the one console window, so the page would REPLACE the Queue.
 *
 * The way back is the page the owner was on, card and all (`/queue?open=…`). When the owner is already in the viewer, its own way
 * back is kept, so a page linked from a page still returns to the card rather than to the page before it. With no
 * console page under the owner — a holding page, a closed window — it is the Queue.
 *
 * @param path the console path a link asked for
 * @param from the console path the window is on now, flag removed, or `undefined` when it is on none
 * @returns the path to load
 */
export function inAppViewPath({ path, from }: { path: string; from: string | undefined }): string {
  if (!isBareDocument({ path })) {
    return path;
  }
  const view = new URLSearchParams({ back: wayBack({ from }), src: path });
  return `${VIEW_PATH}?${view.toString()}`;
}

/**
 * The page a bare document the window itself navigated to is opened from: the page the owner is on, unless that is the
 * viewer.
 *
 * The viewer's own page navigating away was started by its Back or its sidebar, never by the framed document (whose
 * links open new windows, or go where {@link frameNavigationDecision} sends them). A Back that lands on a bare document — a way back such as `/model`,
 * which the server sends on under `/docs` (`site/next.config.mjs`) — would otherwise inherit that same way back, and
 * every Back after it would go round the same redirect. So such a navigation opens from no page, and its
 * way back is the Queue.
 *
 * @param from the console path the window is on now, or `undefined`
 * @returns the page to treat the document as opened from
 */
export function navigatedFrom({ from }: { from: string | undefined }): string | undefined {
  if (from === undefined || new URL(from, "http://localhost:1").pathname === VIEW_PATH) {
    return undefined;
  }
  return from;
}

/**
 * The page a viewer opened from `from` goes back to: `from` itself, the viewer's own way back when `from` is the
 * viewer, and the Queue when there is no console page to return to.
 *
 * @param from the console path the window is on now, or `undefined`
 * @returns a console path
 */
function wayBack({ from }: { from: string | undefined }): string {
  if (from === undefined || isBareDocument({ path: from })) {
    return QUEUE_PATH;
  }
  const current = new URL(from, "http://localhost:1");
  if (current.pathname !== VIEW_PATH) {
    return from;
  }
  const kept = current.searchParams.get("back");
  if (kept === null) {
    return QUEUE_PATH;
  }
  return kept;
}

/** What the shell does with a frame navigating: let it go, refuse it, or refuse it and open the link elsewhere. */
export type FrameNavigationDecision = "allow" | "block" | "open-console-tab" | "open-outside";

/** The schemes the owner's browser opens, restated from `tabRouting.ts`'s `openOutside`. */
const BROWSER_SCHEME = /^(https?|mailto):/u;

/**
 * What a frame inside a console page does when it navigates.
 *
 * A briefing a Queue card opens carries links with no `target`, so a plain click navigates the frame the briefing is
 * shown in — the preview modal's or the viewer's — and a site that refuses to be framed (Vanta) would stay blank. A
 * ⌘-click is a new window, which the shell sends to the owner's browser. So a framed document navigating ITSELF goes
 * where that ⌘-click would: off the console to the owner's browser, to a console page as a new tab after their own; another bare document — a briefing a
 * briefing links, a docs page — stays in the frame, under the modal's close or the viewer's Back.
 *
 * Only a navigation the frame started itself. One its page started — an iframe's own `src`, loading — or whose
 * identity Electron no longer has is let go, so a frame is never refused its first page. The main frame is
 * `will-navigate`'s. There is no user gesture to read, so a framed page's own script or meta refresh off the console
 * opens the owner's browser too.
 *
 * @param isMainFrame the window's own page is navigating, not a frame inside it
 * @param selfInitiated the frame started the navigation itself — a link in it, its own script
 * @param path where it goes on the console, flag removed, or `undefined` when it leaves the console
 * @param url where it goes
 * @returns what the shell does with it
 */
export function frameNavigationDecision({
  isMainFrame,
  selfInitiated,
  path,
  url,
}: {
  isMainFrame: boolean;
  selfInitiated: boolean;
  path: string | undefined;
  url: string;
}): FrameNavigationDecision {
  if (isMainFrame || !selfInitiated) {
    return "allow";
  }
  if (path === undefined) {
    return BROWSER_SCHEME.test(url) ? "open-outside" : "block";
  }
  if (isBareDocument({ path })) {
    return "allow";
  }
  if (isVoicePath({ path })) {
    return "block";
  }
  return "open-console-tab";
}

/**
 * Whether a page is the overlay's: `/voice`, whatever its query.
 *
 * @param path a path, query and hash
 * @returns true for the voice page
 */
export function isVoicePath({ path }: { path: string }): boolean {
  return new URL(path, "http://localhost:1").pathname === VOICE_PATH;
}
