/**
 * What `hand post` makes of the page its `--url` opens, looked at in the owner's own Chrome before the note goes up:
 * whether it shows anything at all.
 *
 * ## Why the post looks first
 *
 * A check-in whose Open button is `http://localhost:3000/api/page/talk-stage-looks/index.html` opens a thing that is
 * not there yet while the pull request that makes that page is unmerged. A note is the owner's attention spent, and
 * the post is the last point at which anything can still notice the page is not the thing.
 * So `hand post` opens the address itself, through the browser route, and refuses one that answers an error, that
 * Chrome could not load at all, or that draws nothing. The unmerged half of that incident is
 * `./rowPullRequest.ts`'s: the old page there DID load, which no look can tell apart from the new one.
 *
 * ## What is read, and why from inside the page
 *
 * The browser client's `goto` captures no HTTP status, so one `eval` of {@link PAGE_LOOK_PROBE} reads it from the
 * page's own navigation timing, beside where the tab landed and how much the body draws. The console answers a page it
 * does not hold with a 404 whose body is one line, `no local page file …` (`site/lib/localPageServe.ts`) — NOT empty,
 * so the status is the only signal for the console's own missing page. A missing status (an older Chrome, a page
 * served from cache) is not a refusal on its own: the content checks still run.
 *
 * Pure: the effectful look is `../cli/commands/hand/pageLookRun.ts`.
 */
import { isRecord } from "#lib/parsers.js";

/**
 * The function the look evaluates in the page: where it landed, the status its document answered with, how many
 * characters the body draws and how many pictures, frames or canvases it holds. `0` stands for a status the page
 * does not expose.
 */
export const PAGE_LOOK_PROBE =
  "() => { const nav = performance.getEntriesByType('navigation')[0]; " +
  "const status = nav === undefined || typeof nav.responseStatus !== 'number' ? 0 : nav.responseStatus; " +
  "const body = document.body === null ? '' : document.body.innerText; " +
  "const media = document.querySelectorAll('img,svg,canvas,video,iframe,picture,object,embed').length; " +
  "return { href: location.href, status, textChars: body.trim().length, media }; }";

/** What {@link PAGE_LOOK_PROBE} answered. */
export interface PageLookReading {
  /** Where the tab landed, after any redirect — `chrome-error://chromewebdata/` when the page did not load. */
  readonly href: string;
  /** The document's HTTP status, or `0` when the page does not expose one. */
  readonly status: number;
  /** How many characters of visible text the body draws, trimmed. */
  readonly textChars: number;
  /** How many pictures, frames, canvases and videos the page holds. */
  readonly media: number;
}

/** The console's in-app viewer, restated from `site/lib/inAppView.ts`'s `VIEW_PATH`, which `src/` cannot import. */
const VIEW_PATH = "/view";

/**
 * The address the look opens for a step's `--url`: the document a console viewer address frames, else the address
 * itself. The viewer draws its own bar whatever its `src` holds, so a look at `…/view?src=%2Fapi%2Fpage%2F<slug>…`
 * would read a page that shows something even when `<slug>` is not there — and the viewer address is exactly the one
 * `./localFileUrl.ts` sends a page to. A `src` that is not a same-origin path is left to the viewer's own refusal and
 * the address looked at as given.
 *
 * @param url the step's web address
 * @returns the address whose page decides whether the note shows the thing
 */
export function lookAddress({ url }: { url: string }): string {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.pathname !== VIEW_PATH) {
    return url;
  }
  const src = parsed.searchParams.get("src");
  if (src === null || !src.startsWith("/") || src.startsWith("//") || src.includes("\\")) {
    return url;
  }
  return new URL(src, parsed.origin).href;
}

/** The first status that is an error, by HTTP's own classes. */
const FIRST_ERROR_STATUS = 400;

/** A web page's own schemes — anything else is where Chrome put a page that did not load. */
const WEB_SCHEME = /^https?:\/\//iu;

/**
 * Read the probe's answer, or `undefined` when it is not the shape the probe returns.
 *
 * @param value the `eval` reply's JSON value
 * @returns the reading, or `undefined`
 */
export function readPageLook({ value }: { value: unknown }): PageLookReading | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { href, status, textChars, media } = value;
  if (typeof href !== "string" || !isCount(status) || !isCount(textChars) || !isCount(media)) {
    return undefined;
  }
  return { href, media, status, textChars };
}

/** Whether a value is a whole, non-negative number. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Why the page a step's `--url` opened does not show anything, or `undefined` when it does.
 *
 * @param reading what the look read off the page
 * @returns the clause naming what was wrong, written to follow "the page", or `undefined`
 */
export function pageLookProblem({ reading }: { reading: PageLookReading }): string | undefined {
  if (!WEB_SCHEME.test(reading.href)) {
    return `did not load — the browser landed on ${reading.href}`;
  }
  if (reading.status >= FIRST_ERROR_STATUS) {
    return `answered HTTP ${String(reading.status)} at ${reading.href}`;
  }
  if (reading.textChars === 0 && reading.media === 0) {
    return `is empty at ${reading.href} — no text and no picture`;
  }
  return undefined;
}
