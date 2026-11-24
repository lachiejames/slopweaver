/**
 * WHAT A NOTE'S ADDRESS OPENS — a published page, a Datadog view, a CI run, a pull request, or one of the console's
 * own lists — read off the address alone, for the rules in `./proofLink.ts` and `./decision.ts`'s
 * `misplacedDecision`.
 *
 * Its own module so `./decision.ts` can read an incident's proof without importing the rules that import it. Pure: a
 * string in, a boolean out.
 */
import { isValidPageSlug, PAGE_FILENAME } from "../pages/url.js";

import { consoleQueueTarget, isLoopbackHost } from "./queueLink.js";
import type { HandStep } from "./step.js";

/** The board-row prefix an incident's dispatch row carries (`../incident/row.ts`, and `skills/incident`). */
const INCIDENT_ROW_PREFIX = "incident-";

/** The board-row prefix a postmortem opportunity's row carries (`../incident/postmortemRow.ts`). */
const POSTMORTEM_ROW_PREFIX = "postmortem-";

/** The console's page route, restated from `../pages/url.ts`'s `consolePageUrl`, which keeps its own private. */
const PAGE_ROUTE = "/api/page/";

/** The console's in-app viewer, restated from `../pages/url.ts`'s `consoleViewerUrl`. */
const VIEW_ROUTE = "/view";

/**
 * The console's own list pages — every top-level page under `site/app/(console)` but `view`, the viewer a published
 * page opens in. A loopback address that is none of these (a page a local server publishes, a nested detail page) is
 * not a console list. `proofLink.test.ts` reads that directory, so a new console route reddens it until it is named
 * here.
 */
const CONSOLE_LIST_ROUTES: ReadonlySet<string> = new Set([
  "alignment",
  "automations",
  "board",
  "fleet",
  "machine",
  "pull-requests",
  "queue",
  "setup",
  "store",
  "workstreams",
]);

/**
 * The fragment that opens the Settings modal, restated from `site/lib/settingsModal.ts`: `#settings`, a section
 * after a slash, or the page under it after an `&` (`#settings/theme&page=candidates`).
 */
const SETTINGS_FRAGMENT = /^#settings(?:[/&]|$)/u;

/** A Datadog host, as `../incident/form.ts` reads a cite's. */
const DATADOG_HOST = /(?:^|\.)datadoghq\.(?:com|eu)$/u;

/** A GitHub Actions run or job page: `/<owner>/<repo>/actions/runs/<id>[/job/<id>]`, or a check run. */
const CI_RUN_PATH = /^\/[^/]+\/[^/]+\/(?:actions\/runs|runs)\/\d+(?:\/|$)/u;

/** A GitHub pull request page, any tab of it. */
const PULL_REQUEST_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/u;

/**
 * The parsed address when it is http(s).
 *
 * @returns the parsed URL, or `undefined` when it is not a web address
 */
function webUrl({ url }: { url: string }): URL | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return parsed;
}

/**
 * Whether a path is one published page's: `…/api/page/<slug>/index.html`, its slug decoded once and in the alphabet
 * `../pages/url.ts` publishes under.
 *
 * @returns true when the path ends in the page route over a valid slug
 */
function isPagePath({ path }: { path: string }): boolean {
  const at = path.lastIndexOf(PAGE_ROUTE);
  if (at === -1) {
    return false;
  }
  const rest = path.slice(at + PAGE_ROUTE.length).split("/");
  if (rest.length !== 2 || rest[1] !== PAGE_FILENAME) {
    return false;
  }
  let slug: string;
  try {
    slug = decodeURIComponent(rest[0]!);
  } catch {
    return false;
  }
  return isValidPageSlug({ slug });
}

/**
 * Whether `url` is a published page on any console origin — its viewer address or the page route itself.
 *
 * Any origin, the way `./queueLink.ts`'s `opensOwnHandStep` reads one: `SLOPWEAVER_CONSOLE_URL` may name any, and
 * a base with a path of its own (`https://host/console`) mints `/console/view`, so both are matched by their end.
 * The residue, stated: a page-shaped path on a host that is no console passes. The rule
 * catches the Queue, CI-run and PR mistake by shape; it is not an authentication of the poster's host.
 *
 * @param url the step's address
 * @returns true for `<base>/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html…` and `<base>/api/page/<slug>/index.html`
 */
export function isPublishedPageUrl({ url }: { url: string }): boolean {
  const parsed = webUrl({ url });
  if (parsed === undefined) {
    return false;
  }
  if (isPagePath({ path: parsed.pathname })) {
    return true;
  }
  const sources = parsed.searchParams.getAll("src");
  const viewer = parsed.pathname === VIEW_ROUTE || parsed.pathname.endsWith(VIEW_ROUTE);
  return viewer && sources.length === 1 && sources[0]!.startsWith(PAGE_ROUTE) && isPagePath({ path: sources[0]! });
}

/**
 * Whether `url` is a GitHub Actions run or job — a CI log, which reads as an unrelated test failure rather than the proof.
 *
 * @param url the step's address
 * @returns true for `https://github.com/<owner>/<repo>/actions/runs/<id>…`
 */
export function isCiRunUrl({ url }: { url: string }): boolean {
  const parsed = webUrl({ url });
  return parsed?.hostname === "github.com" && CI_RUN_PATH.test(parsed.pathname);
}

/**
 * Whether `url` is a GitHub pull request.
 *
 * @param url the step's address
 * @returns true for `https://github.com/<owner>/<repo>/pull/<n>…`
 */
export function isPullRequestUrl({ url }: { url: string }): boolean {
  const parsed = webUrl({ url });
  return parsed?.hostname === "github.com" && PULL_REQUEST_PATH.test(parsed.pathname);
}

/**
 * Whether a loopback path is the console's root or one of {@link CONSOLE_LIST_ROUTES}, read as the server routes it:
 * percent-decoded, so `/%62oard` is `/board`, the way `./queueLink.ts` reads `/%71ueue`. A path that
 * will not decode is no page. Only the route itself is a list: every console page nested under one opens a single
 * thing (`/pull-requests/<owner>/<repo>/<n>`, `/fleet/session/<id>`).
 *
 * @returns true for `/`, `/queue`, `/board/` and the like; false for a nested page or any other local page
 */
function isConsoleListPath({ path }: { path: string }): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  const segments = decoded.split("/").filter((segment) => segment !== "");
  return segments.length === 0 || (segments.length === 1 && CONSOLE_LIST_ROUTES.has(segments[0]!));
}

/**
 * Whether `url` is one of the console's own lists — a loopback console route that is neither a published page nor
 * one Queue item: the Queue itself, the board, the pull-requests page, the root. Another page on a loopback port (a
 * locally served review page) is a page, not a list. Plain `http:` only, the one scheme the console
 * serves and the one `./queueLink.ts`'s `isConsoleQueuePage` reads an item off, so the two agree.
 *
 * @param url the step's address
 * @returns true when opening it lands the owner on a list to hunt through
 */
export function isConsoleListUrl({ url }: { url: string }): boolean {
  const parsed = webUrl({ url });
  if (parsed?.protocol !== "http:" || !isLoopbackHost({ hostname: parsed.hostname }) || isPublishedPageUrl({ url })) {
    return false;
  }
  const routed = consoleRedirected({ parsed });
  return isConsoleListPath({ path: routed.pathname }) && !opensOneItem({ routed });
}

/**
 * Whether a console list address carries one thing to open — a Queue item, `?open=<kind>%3A<id>` read the way
 * `./queueLink.ts`'s `consoleQueueTarget` reads it on `/queue`, or a board row, `?row=<slug>`, the board's citation
 * chip. On EVERY list route, not only the page that reads each: the Alignment page opens a row off `open=` too
 and naming each page that does was a list a review kept
 * extending. The residue, stated: a route that ignores the parameter (`/machine?open=ask%3Ax`) passes.
 *
 * @returns true when the address names one item by a key the Queue can open, or one board row
 */
function opensOneItem({ routed }: { routed: URL }): boolean {
  // `#settings` or `#settings/<section>` opens the Settings modal over any console page (`site/lib/settingsModal.ts`).
  if (SETTINGS_FRAGMENT.test(routed.hash)) {
    return true;
  }
  const row = routed.searchParams.get("row");
  if (row !== null && row.trim() !== "") {
    return true;
  }
  const asQueue = new URL(routed.href);
  asQueue.pathname = "/queue";
  return consoleQueueTarget({ url: asQueue.href }) !== undefined;
}

/**
 * The console's path redirects and where `site/next.config.mjs` sends each, its query riding along — restated, as
 * `src/` may not import `site/`. The root is the one: `/?open=<kind>%3A<id>` opens that Queue item. A
 * destination's own fragment replaces the address's, as a browser following the redirect does. The config's
 * query-conditional act redirect (`/queue` with `open=act:…` to `/alignment`) is not restated: both ends
 * are list routes carrying the same `open=`, so {@link opensOneItem} answers the same either side of it.
 */
const CONSOLE_REDIRECTS: ReadonlyMap<string, string> = new Map([["/", "/queue"]]);

/**
 * The address the console actually serves for `parsed`, past one of {@link CONSOLE_REDIRECTS}.
 *
 * Read as {@link isConsoleListPath} reads a path — percent-decoded, a trailing slash ignored.
 *
 * @returns a copy with the redirected path, or an unchanged copy when no redirect names it
 */
function consoleRedirected({ parsed }: { parsed: URL }): URL {
  const routed = new URL(parsed.href);
  let decoded: string;
  try {
    decoded = decodeURIComponent(routed.pathname);
  } catch {
    return routed;
  }
  const destination = CONSOLE_REDIRECTS.get(decoded.length > 1 ? decoded.replace(/\/+$/u, "") : decoded);
  if (destination === undefined) {
    return routed;
  }
  const target = new URL(destination, routed.origin);
  routed.pathname = target.pathname;
  if (target.hash !== "") {
    routed.hash = target.hash;
  }
  return routed;
}

/**
 * Whether `url` opens anything on the console's Queue — the list, or one item on it.
 *
 * @param url the step's address
 * @returns true when it is a Queue address on this machine
 */
export function isConsoleQueueAddress({ url }: { url: string }): boolean {
  return consoleQueueTarget({ url }) !== undefined || isConsoleListUrl({ url });
}

/**
 * Whether `url` is an incident's proof — a published page, or a Datadog view over https.
 *
 * @param url the step's address
 * @returns true when opening it shows the owner the evidence
 */
export function isIncidentProofUrl({ url }: { url: string }): boolean {
  if (isPublishedPageUrl({ url })) {
    return true;
  }
  const parsed = webUrl({ url });
  return parsed?.protocol === "https:" && DATADOG_HOST.test(parsed.hostname);
}

/**
 * Whether the step names an incident's board row.
 *
 * @returns true when `row` starts `incident-`
 */
export function onIncidentRow({ step }: { step: HandStep }): boolean {
  return step.row?.startsWith(INCIDENT_ROW_PREFIX) === true;
}

/**
 * Whether the step names a postmortem opportunity's board row.
 *
 * @returns true when `row` starts `postmortem-`
 */
export function onPostmortemRow({ step }: { step: HandStep }): boolean {
  return step.row?.startsWith(POSTMORTEM_ROW_PREFIX) === true;
}
