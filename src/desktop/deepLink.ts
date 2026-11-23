/*
 * THE DESKTOP APP'S DEEP LINK, minted on this side — `slopweaver://open?path=<console path>`, which the installed app
 * opens in front: a Queue address in the owner's one pinned Queue tab, any other page as a new tab (`desktop/src/deepLink.ts`
 * parses it and picks the tab, `desktop/src/launch.ts` opens it).
 *
 * The requirement: asked to be taken to the Queue, the voice's deep link never opens a second Queue tab — the pinned
 * Queue tab is the one static tab that never closes, and the voice controls only that one.
 *
 * A briefing, or a floating note linking to one, opens in a new tab of the desktop app, and a Queue card or briefing is
 * never opened in the browser: they are deep links that open inside the desktop app, in new tabs. The floating
 * note (`../hand/note/desktopLink.ts`), `browser present --page` (`../browser/presentDesktop.ts`) and the page verbs'
 * printed address all mint through here, so the scheme is spelt once on this side; the app restates it because
 * neither tree can import the other.
 *
 * Pure.
 */
import { consolePagePath } from "../pages/url.js";

/** The desktop app's scheme and its one action, as `desktop/src/deepLink.ts` declares them. */
const DEEP_LINK_BASE = "slopweaver://open";

/**
 * A launcher's address that opens the app and starts the voice, as `desktop/src/deepLink.ts`'s `deepLinkAction` takes
 * it (`desktop/docs/launcher-commands.md`); `desktop e2e --call`'s `launcher-voice` starts its call with it.
 */
export const DESKTOP_VOICE_LINK = "slopweaver://voice";

/** The query parameter naming the console page, as `desktop/src/deepLink.ts` reads it. */
const PATH_PARAM = "path";

/** The voice overlay's page, which the app never opens in a tab (`desktop/src/surface.ts`'s `VOICE_PATH`). */
const VOICE_PATH = "/voice";

/** The Queue page, which has exactly one tab in the app, the pinned one (`desktop/src/shellState.ts`'s `QUEUE_PATH`). */
const QUEUE_PATH = "/queue";

/**
 * Which tab the desktop app opens a deep-linked console path in, as `desktop/src/deepLink.ts`'s `deepLinkTarget`
 * decides it — restated so the answer the voice is handed says where the page really is.
 *
 * @param path a path on the console, its query and hash included
 * @returns `pinned` for the Queue page with any query or hash, `new` for every other page
 */
export function desktopDeepLinkTab({ path }: { path: string }): "pinned" | "new" {
  if (path.split(/[?#]/u)[0] === QUEUE_PATH) {
    return "pinned";
  }
  return "new";
}

/**
 * The deep link that opens one console path in the desktop app ({@link desktopDeepLinkTab}), or `undefined` for a path the app
 * would drop — so no caller hands it a link that opens nothing. The app's `consolePath`
 * (`desktop/src/persistedState.ts`) refuses a path not starting with one `/`, and any backslash; `deepLinkPath`
 * refuses the overlay's `/voice`.
 *
 * @param path a path on the console, its query and hash included
 * @returns `slopweaver://open?path=<path, percent-encoded>`, or `undefined`
 */
export function desktopDeepLink({ path }: { path: string }): string | undefined {
  const pathname = path.split(/[?#]/u)[0]!;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || pathname === VOICE_PATH) {
    return undefined;
  }
  const link = new URL(DEEP_LINK_BASE);
  link.searchParams.set(PATH_PARAM, path);
  return link.toString();
}

/**
 * The deep link that opens one published local page as a new tab in the desktop app, inside its viewer.
 *
 * @param slug the page's slug, already checked by `isValidPageSlug`
 * @returns `slopweaver://open?path=%2Fapi%2Fpage%2F<slug>%2Findex.html`
 */
export function pageDesktopLink({ slug }: { slug: string }): string {
  // A page path is `/api/page/<percent-encoded slug>/index.html`: one leading slash, no backslash, never `/voice`.
  return desktopDeepLink({ path: consolePagePath({ slug }) })!;
}
