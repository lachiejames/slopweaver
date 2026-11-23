/**
 * Whether an address is a deep link to one item on the console's queue — the page the owner reacts on.
 *
 * A floating macOS note links the owner directly to the queue item to react to. So a note asking the owner to react carries this link as its `url`, and `./step.ts`'s
 * `reactionWithoutQueueLink` refuses one that does not.
 *
 * This module CHECKS a link and never builds one; whatever mints the link agrees with it on the shape below, which is `site/lib/queueRows.ts`'s `?open=<kind>:<id>` key and `site/lib/workContext.ts`'s
 * `context` param, restated rather than imported because `src/` and `site/` may not import each other.
 *
 * Pure: a string in, a target or a boolean out.
 */

/** The record kinds a queue row can be, as `site/lib/queueRows.ts`'s `QueueRow.record` names them. */
const QUEUE_KINDS: ReadonlySet<string> = new Set(["hand", "ask", "draft", "post", "review", "import", "pr", "act"]);

/** The two work contexts the console switches on, as `site/lib/workContext.ts` names them. */
const CONTEXTS: ReadonlySet<string> = new Set(["slopweaver", "work"]);

/** `<kind>:<id>`, once `URLSearchParams` has decoded a `%3A`. The id is whatever the row carries, never empty. */
const OPEN_KEY = /^([a-z]+):(\S+)$/;

/**
 * Whether `url` is the console's queue page at all — opening an item or not.
 *
 * Any port, because a second checkout serves its console on another one (`src/cli/commands/slack/draftWiring.ts`).
 * Any spelling of this machine — `localhost` with or without DNS's root dot, `[::1]`, any `127.x.x.x` — because each
 * reaches the same console, and the console reads them all as one (`site/lib/workspacePlacementAddress.ts`'s
 * `isLoopbackUrl`, restated here as `src/` may not import `site/`).
 *
 * @param url the step's address
 * @returns true when it is `http://localhost:<port>/queue` (or another loopback spelling, or a trailing slash),
 *   whatever its query
 */
export function isConsoleQueuePage({ url }: { url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (
    parsed.protocol === "http:" &&
    isLoopbackHost({ hostname: parsed.hostname }) &&
    isQueuePath({ pathname: parsed.pathname })
  );
}

/**
 * Whether a URL's host is this machine, by any spelling the console answers on: `localhost` with or without DNS's
 * root dot, `[::1]`, any `127.x.x.x`.
 *
 * @param hostname a parsed URL's `hostname`
 * @returns true when it names this machine
 */
export function isLoopbackHost({ hostname }: { hostname: string }): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Whether a URL's path is the queue page's, read as the server routes it: percent-decoded, so `/%71ueue` is `/queue`.
 * A path that will not decode is no page.
 *
 * @returns true when the decoded path is `/queue`, with or without a trailing slash
 */
function isQueuePath({ pathname }: { pathname: string }): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return decoded === "/queue" || decoded === "/queue/";
}

/** One item a queue link opens: the row kind and its id, exactly as the `open` param names them. */
export interface ConsoleQueueTarget {
  readonly kind: string;
  readonly id: string;
}

/**
 * The item `url` opens on a console served from this machine, or `undefined` when it opens none.
 *
 * The queue page ({@link isConsoleQueuePage}), the params in any order, `:` raw or as `%3A`, an optional
 * `context` that must then be one of the two ids, and no fragment — a raw `#` in an id would cut it short. One
 * `open` and at most one `context`: a link naming two items opens neither, rather than whichever is read first.
 *
 * @param url the step's address
 * @returns the kind and id of `http://localhost:<port>/queue?open=<kind>:<id>[&context=<ctx>]`, or `undefined`
 */
export function consoleQueueTarget({ url }: { url: string }): ConsoleQueueTarget | undefined {
  if (!isConsoleQueuePage({ url })) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.searchParams.getAll("open").length !== 1 || parsed.searchParams.getAll("context").length > 1) {
    return undefined;
  }
  const openParam = parsed.searchParams.get("open");
  // `#` read off the TEXT: an empty fragment parses to the same `hash` as none.
  if (openParam === null || url.includes("#")) {
    return undefined;
  }
  const open = OPEN_KEY.exec(openParam);
  if (open === null || !QUEUE_KINDS.has(open[1]!)) {
    return undefined;
  }
  const context = parsed.searchParams.get("context");
  if (context !== null && !CONTEXTS.has(context)) {
    return undefined;
  }
  return { id: open[2]!, kind: open[1]! };
}

/**
 * Whether `url` opens one queue item on a console served from this machine — {@link consoleQueueTarget} found one.
 *
 * @param url the step's address
 * @returns true when it is `http://localhost:<port>/queue?open=<kind>:<id>[&context=<ctx>]`
 */
export function isConsoleQueueLink({ url }: { url: string }): boolean {
  return consoleQueueTarget({ url }) !== undefined;
}

/**
 * Whether `url` opens the hand step `id` on the queue page of ANY console origin — the step's own card.
 *
 * Not {@link consoleQueueTarget}, whose local-origin test judges a link somebody TYPED: a link the fleet MINTS
 * from `SLOPWEAVER_CONSOLE_URL` carries whatever origin that names (`./consoleLink.ts`'s `consoleBaseFrom` takes any),
 * so a monitor card opening itself on `https://console.example` is still its own card. Only the path's end, the one
 * `open=hand:<id>` target and the fragment are read; the origin is any http(s).
 *
 * @param id the step's own id
 * @param url the step's link
 * @returns true when the link opens `hand:<id>` on a `/queue` page
 */
export function opensOwnHandStep({ id, url }: { id: string; url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  const web = parsed.protocol === "http:" || parsed.protocol === "https:";
  // A base with a path of its own (`https://host/console`) mints `/console/queue`, so the page is matched by its end.
  const queue = parsed.pathname.endsWith("/queue") || parsed.pathname.endsWith("/queue/");
  // `#` read off the TEXT: an empty fragment parses to the same `hash` as none, and still makes another link.
  return web && queue && !url.includes("#") && parsed.searchParams.get("open") === `hand:${id}`;
}
