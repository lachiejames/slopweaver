/**
 * The app's own address scheme: `slopweaver://open?path=<console path>`, which a floating note or the voice's
 * `browser_open` opens so a console link lands here rather than in the owner's browser — a Queue address in the one pinned
 * Queue tab, any other page in a new tab ({@link deepLinkTarget}).
 *
 * A link clicked in a floating note opens the briefing in the desktop app, in a new tab inside it, never in Chrome:
 * `NSWorkspace.openURL` would give an `http://localhost` address to the default browser, so the app claims this
 * address itself. The note's half,
 * which mints the link and falls back to the browser when no app claims the scheme, is `src/hand/note/desktopLink.ts`;
 * the two agree on the names below, restated there because neither tree can import the other.
 *
 * Two bare addresses ride the same scheme for a launcher or a keyboard shortcut — `slopweaver://open` shows the app,
 * `slopweaver://voice` starts the voice ({@link deepLinkAction}, `desktop/docs/launcher-commands.md`).
 *
 * Pure: a string in, an action or nothing out.
 */
import { consolePath } from "./persistedState";
import { QUEUE_PATH } from "./shellState";
import { isVoicePath } from "./surface";

/** The scheme this app claims, as `package.json`'s `build.protocols` declares it. */
export const DEEP_LINK_SCHEME = "slopweaver";

/** The action that opens a console page, or, bare, the app itself. */
const OPEN_HOST = "open";

/** The query parameter naming the page. */
const PATH_PARAM = "path";

/**
 * The console page a `slopweaver://open?path=…` address asks for, or `undefined` for anything else.
 *
 * Refused: another scheme or action, a user, port, path or fragment on the address itself, any query but one `path`, a path that is not on the console (`//host`, a full
 * URL, a backslash — `consolePath` judges it), and the overlay's own `/voice` page, which a tab never shows.
 *
 * @param url the address macOS handed the app
 * @returns the console path, query and hash to open
 */
export function deepLinkPath({ url }: { url: string }): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  const bare =
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.pathname === "" &&
    parsed.hash === "";
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.hostname !== OPEN_HOST || !bare) {
    return undefined;
  }
  const keys = [...parsed.searchParams.keys()];
  const asked = parsed.searchParams.getAll(PATH_PARAM);
  if (keys.length !== 1 || asked.length !== 1) {
    return undefined;
  }
  const path = consolePath({ path: asked[0]! });
  if (path === undefined || isVoicePath({ path })) {
    return undefined;
  }
  return path;
}

/** The launcher action that starts the voice. */
const VOICE_HOST = "voice";

/**
 * What one `slopweaver:` address asks the app to do:
 *
 * - `page` — open a console page (`slopweaver://open?path=…`, {@link deepLinkPath});
 * - `window` — bring the app forward where the owner left it (bare `slopweaver://open`);
 * - `voice` — start the voice in its own window, as the menu bar's Start voice does (bare `slopweaver://voice`).
 *
 * The two bare addresses are what a launcher or a keyboard shortcut runs (`desktop/docs/launcher-commands.md`): the app was
 * listed in launchers, but nothing started the voice from outside it.
 */
export type DeepLinkAction =
  { readonly kind: "page"; readonly path: string } | { readonly kind: "window" } | { readonly kind: "voice" };

/**
 * The action a `slopweaver:` address asks for, or `undefined` for anything this app does not take.
 *
 * A bare launcher address carries nothing at all — no user, port, path, query or fragment, and no trailing `?` or `#`
 * — so a launcher can only ever ask for one of the two fixed acts.
 *
 * @param url the address macOS handed the app
 * @returns the page to open, the window to show, the voice to start, or `undefined`
 */
export function deepLinkAction({ url }: { url: string }): DeepLinkAction | undefined {
  const path = deepLinkPath({ url });
  if (path !== undefined) {
    return { kind: "page", path };
  }
  if (url === `${DEEP_LINK_SCHEME}://${OPEN_HOST}`) {
    return { kind: "window" };
  }
  if (url === `${DEEP_LINK_SCHEME}://${VOICE_HOST}`) {
    return { kind: "voice" };
  }
  return undefined;
}

/**
 * Which tab a deep-linked page opens in: a Queue address in the one pinned Queue tab, anything else in a new tab.
 *
 * The voice's `browser_open` must not open a duplicate Queue tab in front of the pinned one. So the Queue, a card on it
 * included, has exactly one tab, the pinned one (`tabsShell.ts` `pinnedTabId`); a briefing or a published page still
 * opens beside it.
 *
 * @param path a console path {@link deepLinkPath} accepted
 * @returns `pinned` for the Queue page with any query or hash, `new` for every other page
 */
export function deepLinkTarget({ path }: { path: string }): "pinned" | "new" {
  const pathname = new URL(path, "http://console.invalid").pathname;
  if (pathname === QUEUE_PATH) {
    return "pinned";
  }
  return "new";
}
