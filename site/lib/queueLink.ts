/**
 * The queue item a hand step's address opens — what joins a DECISION step to the ask that holds its choice.
 *
 * A step posted as `hand post --open ask:<slug>` carries `http://localhost:3000/queue?open=ask%3A<slug>` as its
 * `url`. `./handStepAsk.ts` reads that back into a kind and an id so the step's card can draw the ask's own
 * problem, options and stakes rather than the note's buttons, which alone do not say what is being asked.
 *
 * The grammar is `src/hand/queueLink.ts`'s `consoleQueueTarget`, RESTATED rather than imported because `src/`
 * and `site/` may not import each other; `site/__tests__/unit/queueLink.test.ts` drives the same cases as its
 * `src/` twin so the two cannot drift apart unnoticed.
 *
 * Pure: a string in, a target out.
 */

import { isLoopbackUrl } from "./workspacePlacementAddress";

/** The record kinds a queue row can be, as `./queueRows.ts`'s `QueueRow.record` names them. */
const QUEUE_KINDS: ReadonlySet<string> = new Set(["hand", "ask", "draft", "post", "review", "import", "pr", "act"]);

/** The two work contexts the console switches on, as `./workContext.ts` names them. */
const CONTEXTS: ReadonlySet<string> = new Set(["slopweaver", "work"]);

/** `<kind>:<id>`, once `URLSearchParams` has decoded a `%3A`. The id is whatever the row carries, never empty. */
const OPEN_KEY = /^([a-z]+):(\S+)$/u;

/** One item a queue link opens: the row kind and its id. */
export interface QueueLinkTarget {
  readonly kind: string;
  readonly id: string;
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

/**
 * The item `url` opens on a console served from this machine, or `undefined` when it opens none.
 *
 * @param url the step's address, when it has one
 * @returns the kind and id of `http://localhost:<port>/queue?open=<kind>:<id>[&context=<ctx>]`, or `undefined`
 */
export function queueLinkTarget({ url }: { url: string | undefined }): QueueLinkTarget | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  // Every spelling of this machine, as a placement reads one: `localhost.` or `[::1]` opens the same ask, so the
  // step joins it and inherits its workspace rather than falling to a finding.
  const local = isLoopbackUrl({ url: parsed });
  const queue = isQueuePath({ pathname: parsed.pathname });
  // `#` read off the TEXT: an empty fragment parses to the same `hash` as none.
  if (parsed.protocol !== "http:" || !local || !queue || url.includes("#")) {
    return undefined;
  }
  // One `open` and at most one `context`: a link naming two items joins neither, never the first read.
  if (parsed.searchParams.getAll("open").length !== 1 || parsed.searchParams.getAll("context").length > 1) {
    return undefined;
  }
  const openParam = parsed.searchParams.get("open");
  if (openParam === null) {
    return undefined;
  }
  // Both groups always take part in a match; read through `?.` so a compiler checking indexed access agrees.
  const open = OPEN_KEY.exec(openParam);
  const kind = open?.[1];
  const id = open?.[2];
  if (kind === undefined || id === undefined || !QUEUE_KINDS.has(kind)) {
    return undefined;
  }
  const context = parsed.searchParams.get("context");
  if (context !== null && !CONTEXTS.has(context)) {
    return undefined;
  }
  return { id, kind };
}

/**
 * Whether `url` opens the hand step `id` on the queue page of ANY console origin — the step's own card.
 *
 * `src/hand/queueLink.ts`'s `opensOwnHandStep`, restated for the same reason {@link queueLinkTarget} is: a monitor
 * mints its self-link from `SLOPWEAVER_CONSOLE_URL`, which may name a remote origin or a base with a path of its own,
 * and the posting gate admits a carried decision beside every such link. Judged by {@link queueLinkTarget}'s local
 * grammar instead, that card lost its decision on the console.
 *
 * @param id the step's own id
 * @param url the step's link
 * @returns true when the link opens `hand:<id>` on a page whose path ends `/queue`
 */
export function opensOwnHandStep({ id, url }: { id: string; url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  const web = parsed.protocol === "http:" || parsed.protocol === "https:";
  const queue = parsed.pathname.endsWith("/queue") || parsed.pathname.endsWith("/queue/");
  // `#` read off the TEXT: an empty fragment parses to the same `hash` as none, and still makes another link.
  return web && queue && !url.includes("#") && parsed.searchParams.get("open") === `hand:${id}`;
}
