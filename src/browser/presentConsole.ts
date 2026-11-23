/**
 * `browser present --url` on the console's OWN address: which console pages the voice may take the owner to, as a new tab in
 * the desktop app (`./presentDesktop.ts`), and which it may not. Pure.
 *
 * MEASURED: the owner asked the voice to show them the Settings modal on their console, it
 * called `browser_open` with `http://localhost:3000/queue#settings/…`, and `present` refused it — "localhost is not a
 * platform the browser register names" — so it told the owner it had no tool that opens the desktop app's deep link.
 * The owner's standing ruling is that a console page opens as a desktop-app tab
 * (`../desktop/deepLink.ts`), so a console address resolves to that deep link instead of being refused.
 *
 * ## The bound: the console's pages, never its API
 *
 * The caller is a model that has just read third-party text, so what an address can make the owner's desktop app LOAD is
 * bounded. A console page only starts the reads it was built to start. The `/api/` surface is not uniformly inert —
 * `api/live/[verb]` runs a verb (`claude gauge` among them, which spends a token), and several GET routes spawn
 * provider reads — so every `/api/` path is refused bar one published page's own document, which `--page` already
 * opens. The in-app viewer frames its `src`, so `/view?src=/api/live/…` would issue the same request one hop removed:
 * a viewer's `src` is held to the same rule. The published page's document is admitted BARE,
 * with no query or hash, the one shape `--page` opens. Every `/_` path is the framework's, never a page, and is refused
 * the same way: `/_next/image` fetches the `url` it is handed. And the console is only ever a LOOPBACK base: a
 * `SLOPWEAVER_CONSOLE_URL` naming another host leaves its addresses to the register. A refusal over an allowlist of "harmless" API
 * routes is deliberate: an allowlist drifts the day a route changes.
 *
 * The pathname is judged DECODED, the one the server routes on, so `/api%2Flive/gauge` is the API path it is; a path
 * that does not decode is refused rather than guessed.
 */
import { desktopDeepLink } from "../desktop/deepLink.js";
import { consolePathForUrl } from "../hand/note/desktopLink.js";
import { err, ok, type Result } from "../lib/result.js";
import { consolePagePath, isValidPageSlug } from "../pages/url.js";

/** Why a console address will not be opened. */
export type ConsolePathCause =
  | "API_PATH"
  | "DESKTOP_PATH"
  | "INTERNAL_PATH"
  | "MALFORMED_PATH"
  | "PAGE_NOT_PUBLISHED"
  | "RETIRED_PAGE"
  | "VIEW_API_PATH";

/** A console address `present` refuses to open. */
export interface ConsolePathRefusedError {
  readonly code: "CONSOLE_PATH_REFUSED";
  readonly message: string;
  readonly cause: ConsolePathCause;
  readonly path: string;
}

/** The {@link ConsolePathRefusedError} factory, one message per cause. */
export const ConsolePathErrors = {
  refused: ({ cause, path }: { cause: ConsolePathCause; path: string }): ConsolePathRefusedError => {
    const why: Record<ConsolePathCause, string> = {
      API_PATH:
        "is the console's API, not a page — present opens console pages; a published page opens with --page <slug>",
      DESKTOP_PATH: "is a path the desktop app does not open in a tab (the voice overlay, or one naming another host)",
      INTERNAL_PATH: "is the console framework's own machinery (a path under /_), not a page",
      MALFORMED_PATH: "does not decode, so where it routes cannot be judged",
      PAGE_NOT_PUBLISHED: "names a page this home has not published — `slopweaver page publish` writes one",
      RETIRED_PAGE:
        "is a page the console no longer has: Board and Machine were removed, and Fleet carries the machine's charts",
      VIEW_API_PATH: "is the in-app viewer framing the console's API, which present will not open",
    };
    return { cause, code: "CONSOLE_PATH_REFUSED", message: `${path} ${why[cause]}`, path };
  },
} as const;

/** A console page `present` will open as a desktop-app tab. */
export interface ConsoleTarget {
  /** The console path with its query and hash. */
  readonly path: string;
  /** `slopweaver://open?path=<path>`. */
  readonly deepLink: string;
}

/** The origin a viewer's `src` path is parsed against, so a `src` naming another origin is told apart. */
const LOCAL = "http://localhost:1";

/** One published page's own document, the one `/api/` path admitted: `/api/page/<slug>/index.html`. */
const PAGE_DOCUMENT = /^\/api\/page\/([^/]+)\/index\.html$/u;

/** The hostnames a console base is trusted on: this machine's own loopback, never a name `SLOPWEAVER_CONSOLE_URL` points elsewhere. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The retired console pages: their routes are gone, so present opens neither. */
const RETIRED_PAGES: ReadonlySet<string> = new Set(["board", "machine"]);

/** Whether a pathname's first non-empty segment, split on either separator and lowercased, is a retired page. */
function retiredPageOf({ pathname }: { pathname: string }): boolean {
  const page = pathname
    .toLowerCase()
    .split(/[/\\]/u)
    .find((segment) => segment !== "");
  if (page === undefined) return false;
  return RETIRED_PAGES.has(page);
}

/** A pathname percent-decoded once, or as written when it does not decode. */
function decodedOnce({ pathname }: { pathname: string }): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** How many decode-and-resolve rounds a pathname gets to settle in; one that has not settled by then is refused. */
const CANONICAL_ROUNDS = 8;

/**
 * A pathname at its fixed point under everything a hop between here and the route may do to it: decode, resolve dot
 * segments (a backslash read as a slash, as a browser reads one), collapse each run of slashes — repeated until nothing
 * changes. `undefined` when a round does not decode or it never settles. One decode was not enough: Next.js redirects
 * `/view//` to `/view/` keeping the query, and `/x%2F..%2Fapi/…` decodes to a dot
 * segment that resolves into `/api/` only after the first decode. A `?` or `#` a
 * decode produces is a character IN the path, so it is re-escaped before the reparse: left bare, the reparse read it as
 * a query or a hash and cut the path there, judging `/queue%3F/..%2Fapi/…` as `/queue` (fallback review
 * r3-console-bound-6). Judging the fixed point refuses more than the router would ever reach — a literal `%` that
 * decodes twice — never less.
 */
function decoded({ pathname }: { pathname: string }): string | undefined {
  let current = pathname;
  for (let round = 0; round < CANONICAL_ROUNDS; round += 1) {
    let next: string;
    try {
      const collapsed = decodeURIComponent(current)
        .replaceAll(/[/\\]+/gu, "/")
        .replaceAll("?", "%3F")
        .replaceAll("#", "%23");
      next = new URL(collapsed, LOCAL).pathname.replaceAll(/\/{2,}/gu, "/");
    } catch {
      return undefined;
    }
    if (next === current) {
      return decodeURIComponent(next);
    }
    current = next;
  }
  return undefined;
}

/**
 * The verdict on one decoded pathname against the API rule: admitted, or why not.
 *
 * @returns `undefined` when it is not the API or is a published page's own document, else the cause
 */
function apiVerdict({
  pathname,
  rawPathname,
  bare,
  pagePublished,
}: {
  pathname: string;
  rawPathname: string;
  /** Whether the address carries no query and no hash: the document `--page` opens takes neither. */
  bare: boolean;
  pagePublished: (slug: string) => boolean;
}): ConsolePathCause | undefined {
  // A leading underscore is the framework's, never a page — Next routes no `_folder` — and `/_next/image` fetches the
  // `url` it is handed, the API included, as the dev `/__nextjs_*` endpoints read files.
  if (pathname.startsWith("/_")) {
    return "INTERNAL_PATH";
  }
  const lowered = pathname.toLowerCase();
  if (lowered !== "/api" && !lowered.startsWith("/api/")) {
    return undefined;
  }
  const slug = PAGE_DOCUMENT.exec(pathname)?.[1];
  // Exact spelling only: an encoded separator or a slug outside the alphabet is another route, not this page. And
  // bare only: a query or hash is input `--page` never hands the page's own script.
  if (slug === undefined || !isValidPageSlug({ slug }) || rawPathname !== consolePagePath({ slug }) || !bare) {
    return "API_PATH";
  }
  if (!pagePublished(slug)) {
    return "PAGE_NOT_PUBLISHED";
  }
  return undefined;
}

/**
 * The verdict on every `src` a `/view` address carries, read as the viewer reads it: a console path, decoded once.
 * A `src` that is not a console path frames nothing, so only an API one is refused.
 *
 * @returns `undefined` when every `src` is admitted, else the first cause
 */
function viewVerdict({
  sources,
  pagePublished,
}: {
  sources: readonly string[];
  pagePublished: (slug: string) => boolean;
}): ConsolePathCause | undefined {
  for (const src of sources) {
    if (!src.startsWith("/") || src.startsWith("//") || src.includes("\\") || !URL.canParse(src, LOCAL)) {
      continue;
    }
    const parsed = new URL(src, LOCAL);
    const raw = parsed.pathname;
    const pathname = decoded({ pathname: raw });
    if (pathname === undefined) {
      return "MALFORMED_PATH";
    }
    const bare = !src.includes("?") && !src.includes("#");
    const verdict = apiVerdict({ bare, pagePublished, pathname, rawPathname: raw });
    if (verdict === "API_PATH") {
      return "VIEW_API_PATH";
    }
    if (verdict !== undefined) {
      return verdict;
    }
  }
  return undefined;
}

/**
 * Resolve an address already parsed as web, bounded and credential-free (`./inspect.ts`'s `parseWebUrl`) against the
 * console: `undefined` when it is not on the console at all (the caller holds it to the browser register), the page
 * and its deep link when it may open, or why it may not.
 *
 * @param url the normalised address
 * @param consoleBase the console's origin, no trailing slash
 * @param pagePublished whether a page with that slug is published under this home
 * @returns the console target, `undefined` off the console, or the refusal
 */
export function resolveConsoleTarget({
  url,
  consoleBase,
  pagePublished,
}: {
  url: URL;
  consoleBase: string;
  pagePublished: (slug: string) => boolean;
}): Result<ConsoleTarget | undefined, ConsolePathRefusedError> {
  // ONE serialisation, reparsed: the path opened and the path judged are read off the same string, so an object
  // whose `pathname` disagrees with its `href` cannot pass the bound with one and open the other.
  // A console base off loopback is no console here: its addresses fall through to the browser register like any
  // other, so a configured origin cannot lift a remote site past that check.
  if (!URL.canParse(consoleBase) || !LOOPBACK_HOSTS.has(new URL(consoleBase).hostname)) {
    return ok(undefined);
  }
  const href = url.toString();
  const judged = new URL(href);
  const path = consolePathForUrl({ consoleBase, url: href });
  if (path === undefined) {
    return ok(undefined);
  }
  const deepLink = desktopDeepLink({ path });
  if (deepLink === undefined) {
    return err(ConsolePathErrors.refused({ cause: "DESKTOP_PATH", path }));
  }
  const pathname = decoded({ pathname: judged.pathname });
  if (pathname === undefined) {
    return err(ConsolePathErrors.refused({ cause: "MALFORMED_PATH", path }));
  }
  const bare = !href.includes("?") && !href.includes("#");
  const api = apiVerdict({ bare, pagePublished, pathname, rawPathname: judged.pathname });
  if (api !== undefined) {
    return err(ConsolePathErrors.refused({ cause: api, path }));
  }
  // A retired page's route is gone, so the desktop app would open a 404. Judged by the first segment,
  // lowercased, of BOTH readings — the canonical pathname above and the raw one decoded once, as the router reads it
  // before any dot segment resolves (`/board%2F..%2Ffleet`) — so `/Board`, `/%62oard` and `/machine/agents` refuse alike.
  if (retiredPageOf({ pathname }) || retiredPageOf({ pathname: decodedOnce({ pathname: judged.pathname }) })) {
    return err(ConsolePathErrors.refused({ cause: "RETIRED_PAGE", path }));
  }
  const isViewer = pathname === "/view" || pathname === "/view/";
  if (isViewer) {
    const view = viewVerdict({ pagePublished, sources: judged.searchParams.getAll("src") });
    if (view !== undefined) {
      return err(ConsolePathErrors.refused({ cause: view, path }));
    }
  }
  return ok({ deepLink, path });
}
