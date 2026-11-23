/**
 * Minting the console link a floating note opens — the queue row it names, in the context that row lives in.
 *
 * A note's Open lands directly on the particular queue item, a deep link. A link `/queue?open=ask%3A<slug>` for a
 * Slopweaver row, with the console on Acme, says the context hides it. The console switches on its own
 * (`site/lib/workspacePlacementContext.ts` `contextToOpen`); a link that also CARRIES the context opens there on the
 * first paint instead of a frame later, and survives the panel closing. That is this module's half.
 *
 * The names it shares with the site live in `./consoleLinkNames.ts`, which the site's mirror test reads.
 * Pure: no environment read, no I/O.
 */
import { err, ok, type Result } from "#lib/result.js";

import { prCardKeyParts } from "../talk/prCardKey.js";

import { CONTEXT_PARAM, type LinkContext, OPEN_PARAM, QUEUE_KINDS } from "./consoleLinkNames.js";

/** The queue page's path on the console. */
const QUEUE_PATH = "/queue";

/**
 * The Alignment page's path: an `act:` row — the fleet asking whether something it already did was the right call —
 * opens there, never on the Queue, which holds only what needs the owner's hands. Mirrors
 * `site/lib/alignment.ts`'s `consoleCardPath`.
 */
const ALIGNMENT_PATH = "/alignment";

/**
 * The page a row key opens on.
 *
 * @param key a key {@link isQueueKey} already accepted
 * @returns `/alignment` for an act, `/queue` for every other kind
 */
function pathFor({ key }: { key: string }): string {
  if (key.startsWith("act:")) {
    return ALIGNMENT_PATH;
  }
  return QUEUE_PATH;
}

/**
 * The console origin a link names when `SLOPWEAVER_CONSOLE_URL` says nothing. The server listens on 127.0.0.1
 * (`console_host` in `scripts/docs-site.sh`); the link stays `localhost`, the origin the owner's browser state is kept under.
 */
const DEFAULT_CONSOLE_BASE = "http://localhost:3000";

/**
 * The variable naming another console origin. The console genuinely runs on another port when a second
 * checkout has one up — `localhost:3000` is served out of the main checkout
 * while the work happens in a worktree (`site/lib/slopweaverBin.ts`). `slack draft` reads it too.
 */
export const CONSOLE_URL_ENV = "SLOPWEAVER_CONSOLE_URL";

/**
 * The console origin, from the environment's override or the port `yarn console` binds.
 *
 * @param configured the `SLOPWEAVER_CONSOLE_URL` value, or `undefined` when unset
 * @returns the origin with no trailing slash
 */
export function consoleBaseFrom({ configured }: { configured: string | undefined }): string {
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_CONSOLE_BASE;
  }
  return configured.trim().replace(/\/$/, "");
}

/**
 * Whether a string is a queue row key the console can open: `<kind>:<id>` with a kind the queue draws.
 *
 * @returns true for a key like `ask:a-round-two-row`
 */
function isQueueKey({ key }: { key: string }): boolean {
  const colon = key.indexOf(":");
  if (colon <= 0 || colon === key.length - 1) {
    return false;
  }
  const kind = key.slice(0, colon);
  // A pull request's row is keyed by repository AND number: a bare `pr:<n>` names no card the Queue draws.
  if (kind === "pr") {
    return prCardKeyParts({ key }) !== undefined;
  }
  return QUEUE_KINDS.some((known) => known === kind);
}

/**
 * The address of one row's panel — on the Queue, or the Alignment page for an act — carrying the context it lives
 * in when that is known.
 *
 * @param base the console origin
 * @param key the row's `<kind>:<id>` key, as `?open=` names it
 * @param context the row's work context, when the caller knows it; without one the console switches itself
 * @returns the link, or a refusal naming the key it could not open
 */
export function consoleQueueLink({
  base,
  key,
  context,
}: {
  base: string;
  key: string;
  context: LinkContext | undefined;
}): Result<string> {
  const trimmed = key.trim();
  if (!isQueueKey({ key: trimmed })) {
    return err([
      `--open wants a queue row key, <kind>:<id> with kind one of ${QUEUE_KINDS.join("|")} (a pull request's is pr:<owner>.<repo>.<n>) — got "${key}"`,
    ]);
  }
  const params = new URLSearchParams();
  params.set(OPEN_PARAM, trimmed);
  if (context !== undefined) {
    params.set(CONTEXT_PARAM, context);
  }
  return ok(`${base}${pathFor({ key: trimmed })}?${params.toString()}`);
}

/**
 * The queue link to ANOTHER hand card, minted off a card's own queue link — the same console origin and path, so
 * the fleet-health note's per-row control opens a card on the console its own Open button opens, a button in front of
 * the owner. The context is dropped rather than carried: the other card
 * may live in the other context, and the console switches to the one a row lives in by itself.
 *
 * A sign-in ORIGIN is never what this mints: a page opened any way but the Chrome pin may land in the owner's personal
 * profile (`../browser/profilePin.ts`), and the card on the queue is the step meant to be one click away.
 *
 * @param url the card's own link — a `/queue` page that opens one row
 * @param id the other card's step id
 * @returns the link opening `hand:<id>`, or `undefined` when `url` is not a queue link this can follow
 */
export function siblingQueueLink({ url, id }: { url: string; id: string }): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  const web = parsed.protocol === "http:" || parsed.protocol === "https:";
  const queue = parsed.pathname.endsWith(QUEUE_PATH) || parsed.pathname.endsWith(`${QUEUE_PATH}/`);
  if (!web || !queue || !parsed.searchParams.has(OPEN_PARAM) || url.includes("#")) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set(OPEN_PARAM, `hand:${id}`);
  return `${parsed.origin}${parsed.pathname}?${params.toString()}`;
}

/**
 * A `--url` that already deep-links a queue row on this console, given the context the step states.
 *
 * A session that built the link by hand gets the same link `--open` would have minted: the context rides
 * along when the step states one and the link does not. Any other address — another page, another origin,
 * a link that already names a context — is returned exactly as it came.
 *
 * @param url the address the caller supplied
 * @param base the console origin a queue link must share
 * @param context the step's stated context, or `undefined`
 * @returns the address to record
 */
export function withQueueContext({
  url,
  base,
  context,
}: {
  url: string;
  base: string;
  context: LinkContext | undefined;
}): string {
  if (context === undefined || !URL.canParse(url) || !URL.canParse(base)) {
    return url;
  }
  const parsed = new URL(url);
  const consoleOrigin = new URL(base).origin;
  const isQueueLink =
    parsed.origin === consoleOrigin && parsed.pathname === QUEUE_PATH && parsed.searchParams.has(OPEN_PARAM);
  if (!isQueueLink || parsed.searchParams.has(CONTEXT_PARAM)) {
    return url;
  }
  parsed.searchParams.set(CONTEXT_PARAM, context);
  return parsed.toString();
}
