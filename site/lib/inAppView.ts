/**
 * The in-app viewer's address — `/view?src=<document>&back=<page>` — read back into the document it frames and the
 * page its first control returns to.
 *
 * A Queue card's local page, such as the Vanta evidence before-and-after, opened in the desktop app's window on its
 * own, leaves the owner with no way back to the Queue. A bare document — a file the
 * console serves under `/api/…`, a local page at `/api/page/<slug>/index.html`, or a docs page under `/docs`, which
 * has a root layout of its own — carries no sidebar and no back. So the desktop shell sends one here instead
 * (`desktop/src/surface.ts`'s `inAppViewPath`), and this page draws it inside the console's shell under a bar whose
 * first control is the way back to the card the owner came from.
 *
 * Both halves are read as untrusted, because the address is a link anyone can write: the document must be a
 * same-origin bare document (so the frame never shows another site, nor the console inside itself), and the way back
 * must be a console page (so the back control is never an open redirect, nor a loop into another viewer).
 *
 * Pure: strings in, strings out.
 */
import { isPageSlug, LOCAL_PAGE_ROUTE } from "./localPageHref";

/** The viewer's own path, restated in `desktop/src/surface.ts` as `VIEW_PATH`. */
export const VIEW_PATH = "/view";

/**
 * The console's own pages, one route per `page.tsx` under `app/(console)/` bar the viewer itself, a `[segment]`
 * standing for any one segment. A way back is only ever one of these, so it is always drawn inside the console's
 * shell. Any other path — one that does not exist, which the console's two root layouts leave to Next's bare 404,
 * or the voice overlay's `/voice` — has no sidebar and no way back of its own.
 * `inAppView.test.ts` walks the directory, so a page that is missing here fails.
 */
export const CONSOLE_PAGES: readonly string[] = [
  "/alignment",
  "/automations",
  "/fleet",
  "/fleet/session/[id]",
  "/pull-requests",
  "/pull-requests/[owner]/[repo]/[number]",
  "/queue",
  "/queue/mail/[slug]/[digest]",
  "/store",
  "/workstreams",
];

/**
 * Whether a decoded pathname is one of {@link CONSOLE_PAGES}: segment for segment, a `[segment]` matching any
 * non-empty one.
 *
 * @returns true for a page drawn inside the console's shell
 */
function isConsolePage({ pathname }: { pathname: string }): boolean {
  const segments = pathname.split("/").slice(1);
  return CONSOLE_PAGES.some((page) => {
    const pattern = page.split("/").slice(1);
    return (
      pattern.length === segments.length &&
      pattern.every((part, index) => {
        const segment = segments[index];
        return part.startsWith("[") ? segment !== "" : part === segment;
      })
    );
  });
}

/** Where the back control goes when the address names no page to return to. */
const QUEUE_PATH = "/queue";

/** The origin a path is parsed against, so a path that names another origin is told apart from one that does not. */
const LOCAL = "http://localhost:1";

/**
 * A path on this console, normalised, or `undefined` when the string names anywhere else.
 *
 * One leading `/`, never `//` (protocol-relative) and never a backslash, which a browser reads as `/`.
 *
 * The pathname handed back to judge is DECODED, the one the server routes on, so `/icon%2Esvg` is judged as the file
 * it is; one that does not decode names nowhere.
 *
 * @param path the candidate
 * @returns the pathname, query and hash, plus the decoded pathname for the caller to judge
 */
function onConsole({ path }: { path: string }): { path: string; pathname: string } | undefined {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return undefined;
  }
  if (!URL.canParse(path, LOCAL)) {
    return undefined;
  }
  const parsed = new URL(path, LOCAL);
  if (parsed.origin !== LOCAL) {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  return { path: `${parsed.pathname}${parsed.search}${parsed.hash}`, pathname };
}

/**
 * A file's own name: a last segment with a dot in it, what the console serves at its root (`/icon.svg`) rather than a
 * page, whose last segment never has one. Any extension, so no file type is missed. Restated in
 * `desktop/src/surface.ts`.
 */
const STATIC_FILE = /\/[^/]*\.[^/]*$/u;

/**
 * Whether a pathname is a bare document: served under `/api/` or `/_next/`, a static file such as `/icon.svg`, or a
 * docs page under `/docs`. A static file is never a way back.
 *
 * @returns true for a path the viewer frames
 */
function isBareDocument({ pathname }: { pathname: string }): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || STATIC_FILE.test(pathname)) {
    return true;
  }
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

/**
 * The document the viewer frames, or `undefined` when `src` is not a bare document on this console.
 *
 * @param src the address's `src`, as received
 * @returns the normalised same-origin path to frame, or `undefined`
 */
export function viewedDocument({ src }: { src: string | undefined }): string | undefined {
  if (src === undefined) {
    return undefined;
  }
  const read = onConsole({ path: src });
  if (read === undefined || !isBareDocument({ pathname: read.pathname })) {
    return undefined;
  }
  return read.path;
}

/**
 * The local page the viewer is showing, by slug, when what it frames is exactly one page's own file:
 * `/api/page/<slug>/index.html`, decoded once, with no query or hash. The viewer's "Reveal in Finder" selects that
 * file (so a briefing the owner has open can be dragged into Slack), so an image or appendix beside a page,
 * a docs page or any other served file gets no button: Finder would select a file other than the one the owner is
 * reading.
 *
 * @param shown the document the viewer frames, as {@link viewedDocument} accepted it
 * @returns the page's slug, or `undefined`
 */
export function viewedPageSlug({ shown }: { shown: string | undefined }): string | undefined {
  if (shown === undefined) {
    return undefined;
  }
  const read = onConsole({ path: shown });
  if (read === undefined) {
    return undefined;
  }
  const { search, hash } = new URL(read.path, LOCAL);
  if (search !== "" || hash !== "") {
    return undefined;
  }
  const segments = read.pathname.split("/");
  const slug = segments.at(3);
  const route = segments.slice(0, 3).join("/");
  if (segments.length !== 5 || route !== LOCAL_PAGE_ROUTE || segments.at(4) !== "index.html" || slug === undefined) {
    return undefined;
  }
  return isPageSlug({ slug }) ? slug : undefined;
}

/**
 * What a framed document may do: what `./localPageServe.ts`'s `PAGE_CSP` already lets a served page do, and never
 * navigate the viewer away from under its own back control (no `allow-top-navigation`). A docs page is the console's
 * own Nextra page, which reads its theme from storage, so it keeps its origin; a served file never does.
 */
const SERVED_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
const DOCS_SANDBOX = `${SERVED_SANDBOX} allow-same-origin`;

/**
 * The `sandbox` the viewer's frame carries for a document {@link viewedDocument} accepted.
 *
 * @param shown the document's path
 * @returns the sandbox tokens
 */
export function frameSandbox({ shown }: { shown: string }): string {
  const { pathname } = new URL(shown, LOCAL);
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return DOCS_SANDBOX;
  }
  return SERVED_SANDBOX;
}

/** Where the back control goes, and the words it reads as. */
export interface ViewBack {
  readonly href: string;
  readonly words: string;
}

/**
 * The page the back control returns to, and its words: the card when the page holds one open, the Queue for the
 * Queue, and "Back" for any other console page. An address naming no console page — absent, another origin, a bare
 * document, another viewer, the voice overlay's own page, or any path that is not one of {@link CONSOLE_PAGES} — goes
 * back to the Queue.
 *
 * @param back the address's `back`, as received
 * @returns where the control goes and what it says
 */
export function viewBack({ back }: { back: string | undefined }): ViewBack {
  const toQueue: ViewBack = { href: QUEUE_PATH, words: "Back to the Queue" };
  if (back === undefined) {
    return toQueue;
  }
  const read = onConsole({ path: back });
  if (read === undefined || isBareDocument({ pathname: read.pathname })) {
    return toQueue;
  }
  if (!isConsolePage({ pathname: read.pathname })) {
    return toQueue;
  }
  const opens = new URL(read.path, LOCAL).searchParams.get("open");
  if (opens !== null && opens.trim() !== "") {
    return { href: read.path, words: "Back to the card" };
  }
  if (read.pathname === QUEUE_PATH) {
    return { href: read.path, words: "Back to the Queue" };
  }
  return { href: read.path, words: "Back" };
}
