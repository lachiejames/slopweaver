/**
 * What the console voice knows about the page the owner is on: the page's own reading, handed over only when the
 * model asks.
 *
 * The voice works on all pages and has knowledge of all pages, and stays token efficient. Nothing is pushed into the
 * call as the owner moves around the console; the model reads the page when "this" needs it, and pays for that read
 * only then.
 *
 * ## The page's words arrive only as a tool result
 *
 * {@link pageRead} is what `read_page` returns: which page, which path, which item is open — a key shape-checked
 * against {@link OPEN_KEY} — and whatever the page registered through `usePageVoice`, bounded at
 * {@link PAGE_READ_MAX_BYTES}. A tool result is data the backend prompt already tells the model never to obey, and
 * reading one also closes the relay gate until the owner speaks again (`relayGate.ts`), so a page's words can inform an
 * answer without ever becoming a steer.
 *
 * ## Who put the open card in front of the owner
 *
 * The voice's `open_card` can move the console onto an ask while the owner is away from the computer, and their next
 * aside would land on it as a ruling, removing the ask from the queue. So the address the voice opens a card on
 * carries {@link OPENED_BY_PARAM}`=voice` ({@link openByOf}), the transcript stamps it beside the card, and `talk
 * transcript` lands nothing said over a card the voice opened. The owner's own click rebuilds the address without it.
 */

import { CARD_KEY } from "./cardKey";
import { byteLength, readingCutsOf, windowRead, withinBound } from "./pageReadFit";
import { type PageReadWindow, pageReadOnRefusal } from "./pageReadWindow";
import { prCardKeyParts } from "./prCardKey";

/** An open card's key: a Queue kind or an Automations `recipe:`, then an id — the one `./cardKey.ts` pattern. */
export const OPEN_KEY = CARD_KEY;

/** The query parameter naming who opened the card `?open=` names; absent when the owner opened it themselves. */
export const OPENED_BY_PARAM = "by";

/** The Queue's own path — the one page `open_card` opens a panel on. */
const QUEUE_PATH = "/queue";
/** Where a Queue address naming an act lands (`site/next.config.mjs`), its query kept. */
const ALIGNMENT_PATH = "/alignment";

/** The one opener the parameter names: the console voice's `open_card`. */
export type CardOpenBy = "voice";

/** The card open as a stretch of speech begins, and whether the voice put it there. */
export interface OpenCardContext {
  readonly open: string | undefined;
  readonly openBy: CardOpenBy | undefined;
}

/** The most `read_page` hands back, in UTF-8 bytes — inside the 24 KiB every tool output is capped at. */
export const PAGE_READ_MAX_BYTES = 16 * 1024;

/** The page as the voice sees it. `title` is the page's own `PageHead` title, a literal in this repo. */
export interface PageView {
  readonly path: string;
  readonly title: string;
  /** The `?open=` key of the item the owner has open, or `undefined` for none. Unchecked until {@link openKeyOf}. */
  readonly open: string | undefined;
  /** `voice` when the voice's `open_card` put that item there ({@link openByOf}), `undefined` when the owner did. */
  readonly openBy: CardOpenBy | undefined;
  /** That item's title as the page draws it, for the messenger band only: {@link pageRead} does not hand it back. */
  readonly openTitle?: string | undefined;
  /** What the page registered for `read_page`: JSON-serialisable. */
  readonly shows: unknown;
  /**
   * The shell's voice window only: the reading the console window fitted for its page and carried across, in place
   * of `shows` (`./desktopPageReading.ts` `carriedPageView`). Absent where the page is drawn in this window.
   */
  readonly carried?: CarriedReadingState;
}

/**
 * What crossed from the console window of its page's reading: the reading itself, the page's word that it registers
 * none, or nothing at all — an app or console built before the reading crossed, which is not the page having none.
 */
export type CarriedReadingState =
  | { readonly kind: "carried"; readonly shows: unknown; readonly truncated: string | undefined }
  | { readonly kind: "none" }
  | { readonly kind: "unreached" };

/** What `read_page` returns. */
export interface PageRead {
  readonly page: string;
  readonly path: string;
  readonly open: string | undefined;
  /** The page's own reading, or the statement that it registered none. */
  readonly shows: unknown;
  /** Present when `shows` was cut to fit {@link PAGE_READ_MAX_BYTES}. */
  readonly truncated: string | undefined;
}

/**
 * The open key when it has the shape a queue key has, else `undefined`. A `pr:` key must name its repository
 * ({@link prCardKeyParts}): a bare `pr:<number>` off an old or hand-written address is two pull requests whenever two
 * repositories share the number, so it is never named as the card the owner has open.
 *
 * @param open the raw `?open=` value the page passed on
 * @returns the key, safe to name in a read
 */
export function openKeyOf({ open }: { open: string | undefined }): string | undefined {
  if (open === undefined || !OPEN_KEY.test(open)) {
    return undefined;
  }
  if (open.startsWith("pr:") && prCardKeyParts({ key: open }) === undefined) {
    return undefined;
  }
  return open;
}

/**
 * Whether the voice put the open card in front of the owner: `voice` only for a Queue address holding exactly one
 * non-empty `?open=` and exactly one `by=voice`, with a card open. Anything else — no marker, a second one, another
 * value, another page — is `undefined`, so a malformed marker never stops the owner's words landing on a card they
 * opened. The address's key is not matched to the open card's: the Queue shows an absorbed ask's address as the hand
 * row that took it, still the card the voice opened, and the owner's own click on any row rebuilds the address without
 * `by` (`panelHref`). An act the voice opens is redirected to Alignment with that query; there the owner's touch on
 * any box is what moves the open card, and it takes the marker off ({@link withoutOpenedBy}), so the key is not
 * matched there either — an act grouped under a newer one is still the card the voice opened.
 *
 * @param open the shaped key of the card open now ({@link openKeyOf})
 * @param path the console's path and query, as the address bar holds them
 * @returns `voice`, or `undefined` for a card the owner opened
 */
export function openByOf({ open, path }: { open: string | undefined; path: string }): CardOpenBy | undefined {
  if (open === undefined) {
    return undefined;
  }
  const cut = path.indexOf("?");
  const pathname = cut === -1 ? path : path.slice(0, cut);
  if ((pathname !== QUEUE_PATH && pathname !== ALIGNMENT_PATH) || cut === -1) {
    return undefined;
  }
  const query = new URLSearchParams(path.slice(cut + 1));
  const opens = query.getAll("open");
  const openers = query.getAll(OPENED_BY_PARAM);
  if (opens.length !== 1 || opens[0]?.trim() === "" || openers.length !== 1 || openers[0] !== "voice") {
    return undefined;
  }
  return "voice";
}

/**
 * The address with the voice's marker taken off, for a page whose own touch makes the open card the owner's without
 * rebuilding the address (Alignment's answer box) — the way `panelHref` drops it on the owner's Queue click.
 *
 * @param pathname the address bar's path
 * @param search the address bar's query, `?` included or empty
 * @returns the path and query without `by`, or `undefined` when the address carries none
 */
export function withoutOpenedBy({ pathname, search }: { pathname: string; search: string }): string | undefined {
  const query = new URLSearchParams(search);
  if (!query.has(OPENED_BY_PARAM)) {
    return undefined;
  }
  query.delete(OPENED_BY_PARAM);
  const rest = query.toString();
  return rest === "" ? pathname : `${pathname}?${rest}`;
}

/**
 * Who opened the card on the page the voice believes the owner is on. The marker is in the query, which the router's
 * pathname does not carry, so the browser's own address is read — and only while it is still that page.
 *
 * @param here the pathname the router reports
 * @param at the browser's address now
 * @returns `"voice"` when the voice opened that card, `undefined` otherwise
 */
export function openByHere({
  open,
  here,
  at,
}: {
  open: string | undefined;
  here: string;
  at: { readonly pathname: string; readonly search: string };
}): CardOpenBy | undefined {
  let path = here;
  if (at.pathname === here) {
    path = `${here}${at.search}`;
  }
  return openByOf({ open: openKeyOf({ open }), path });
}

/** A card a page registered, who opened it, and the address's `?open=` as it registered. */
export interface RegisteredCard extends OpenCardContext {
  readonly address: string | undefined;
}

/**
 * Who opened the card a page has just registered, read off the address AS IT REGISTERS rather than as the owner speaks. The
 * address moves synchronously and the page's reading a React effect later, so a read at speech time can pair one
 * card's marker with the other card. A re-registration of the same card takes the address's marker while
 * the address names that card itself — the voice reopening the card the owner had open, the owner's click on an
 * absorbed alias's own row — or still names what it named at registration, the owner's touch taking the marker off
 * ({@link withoutOpenedBy}); while it names another card the page has not registered yet, the held card keeps its
 * opener. The residue: the voice reopening the owner's open card under an alias's address leaves it the owner's.
 *
 * @param previous the card registered before this one on the same page
 * @param open the raw key the page registers now
 * @param here the pathname the router reports
 * @param at the browser's address now
 * @returns the card registering now, who opened it, and the address it registered under
 */
export function registeredCard({
  previous,
  open,
  here,
  at,
}: {
  previous: RegisteredCard | undefined;
  open: string | undefined;
  here: string;
  at: { readonly pathname: string; readonly search: string };
}): RegisteredCard {
  const key = openKeyOf({ open });
  let address: string | undefined;
  const named = new URLSearchParams(at.search).get("open");
  if (at.pathname === here && named !== null) {
    address = named;
  }
  // The address has moved on to a card the page has not registered yet.
  if (previous !== undefined && previous.open === key && address !== previous.address && address !== key) {
    return previous;
  }
  return { address, open: key, openBy: openByHere({ at, here, open }) };
}

/** What the page body last registered for the voice: its path, its card and who opened it, and its reading. */
export interface HeldReading {
  readonly path: string;
  readonly card: RegisteredCard;
  /** The open card's title as the body drew it, for the messenger band. */
  readonly openTitle?: string | undefined;
  readonly shows: unknown;
  /**
   * The address query as the body registered, in the commit that drew it: the scope the page shows, which the live
   * address runs ahead of between a `replaceState` and the render it causes.
   */
  readonly search: string;
}

/**
 * The reading a page body registers now, its card judged against the one it held before on the same path
 * ({@link registeredCard}).
 *
 * @param held what the body registered before, on any path
 * @param path the pathname the router reports
 * @param part the open key and reading the body registers now
 * @param at the browser's address now
 * @returns the reading to hold
 */
export function heldReading({
  held,
  path,
  part,
  at,
}: {
  held: HeldReading | undefined;
  path: string;
  part: { readonly open: string | undefined; readonly openTitle?: string | undefined; readonly shows: unknown };
  at: { readonly pathname: string; readonly search: string };
}): HeldReading {
  let previous: RegisteredCard | undefined;
  if (held?.path === path) {
    previous = held.card;
  }
  const card = registeredCard({ at, here: path, open: part.open, previous });
  return { card, openTitle: part.openTitle, path, search: at.search, shows: part.shows };
}

/**
 * The page as the voice sees it, out of what this window's head and body registered: the head's title and the body's
 * card and reading, each only when it registered for THIS path. Who opened the card was judged as the body registered
 * it, not now (`heldReading`).
 *
 * @param here the pathname the router reports
 * @param head what the page head registered, on any path
 * @param reading what the page body registered, on any path
 * @returns the page view
 */
export function heldPageView({
  here,
  head,
  reading,
}: {
  here: string;
  head: { readonly path: string; readonly title: string } | undefined;
  reading: HeldReading | undefined;
}): PageView {
  let title = here;
  if (head?.path === here) {
    title = head.title;
  }
  const read = reading?.path === here ? reading : undefined;
  const card = { open: read?.card.open, openBy: read?.card.openBy, openTitle: read?.openTitle };
  return { ...card, path: here, shows: read?.shows, title };
}

/**
 * The path and query the desktop shell carries to the voice's window, which re-reads who opened the card from it
 * (`desktopPageReading.ts` `carriedPageView`). The query is the address's, with `by` and `open` set to the card the page
 * holds rather than whatever the address has moved on to, so the opener judged at registration crosses intact.
 *
 * @param held what the page body registered, on any path
 * @param here the pathname the router reports
 * @param at the browser's address now
 * @returns the path, with the address's query when it is still this page
 */
export function publishedPath({
  held,
  here,
  at,
}: {
  held: HeldReading | undefined;
  here: string;
  at: { readonly pathname: string; readonly search: string };
}): string {
  const query = new URLSearchParams(at.pathname === here ? at.search : "");
  query.delete(OPENED_BY_PARAM);
  const card = held?.path === here ? held.card : undefined;
  if (card?.openBy === "voice" && card.address !== undefined) {
    query.set("open", card.address);
    query.set(OPENED_BY_PARAM, card.openBy);
  }
  const rest = query.toString();
  return rest === "" ? here : `${here}?${rest}`;
}

/**
 * The card a stretch of the owner's speech is over, and whether the voice opened it.
 *
 * @param view the page as it is now
 * @returns the card's queue key, `undefined` for none, beside who opened it
 */
export function openContextOf({ view }: { view: PageView }): OpenCardContext {
  return { open: openKeyOf({ open: view.open }), openBy: view.openBy };
}

/**
 * What `read_page` answers, bounded. In the shell's voice window a reading the console window carried is answered as
 * it was fitted there, so the voice reads exactly what that window's own `read_page` would.
 *
 * @param view the page as it is now
 * @param maxBytes the byte bound on the serialised answer
 * @returns the page's reading, with any cut stated
 */
export function pageRead({ view, maxBytes }: { view: PageView; maxBytes: number }): PageRead | PageReadWindow {
  const open = openKeyOf({ open: view.open });
  if (view.carried?.kind === "carried") {
    const carried = {
      open,
      page: view.title,
      path: view.path,
      shows: view.carried.shows,
      truncated: view.carried.truncated,
    };
    return withinBound({ maxBytes, read: carried });
  }
  // Serialised ONCE, and every answer built from that one text: a reading whose `toJSON` answers differently each time
  // would otherwise be measured as one text and sent as another, past the bound.
  const text = JSON.stringify(pageShowsOf({ view }));
  const snapshot: unknown = JSON.parse(text);
  const whole: PageRead = {
    open,
    page: view.title,
    path: view.path,
    shows: snapshot,
    truncated: undefined,
  };
  const size = byteLength({ text: JSON.stringify(whole) });
  if (size <= maxBytes) {
    return whole;
  }
  // Cut into windows of its serialised text, each naming where the next starts and which reading it was cut from, so
  // `read_page` reads on (`./pageReadWindow.ts`) and never splices two readings into one.
  const readOn = `the page's reading is ${String(byteLength({ text }))} bytes and this read carries one window of it; read_page with this path, reading and nextFrom as from reads on`;
  return windowRead({ cuts: readingCutsOf({ text }), maxBytes, readOn, start: 0, text, whole });
}

/**
 * What a page read carries as the page's reading: its own, or the sentence standing in for one it has not got. One
 * function for `pageRead` and `pageReadOn`, so a read on hashes the very text the cut read windowed.
 *
 * @param view the page on screen, not carried across
 * @returns the reading
 */
function pageShowsOf({ view }: { view: PageView }): unknown {
  if (view.carried?.kind === "unreached") {
    return `the ${view.title} page's reading did not reach the voice's window: the desktop app or console here was built before it crossed, so this says nothing about what the page draws; action_items has what is waiting on the owner`;
  }
  if (view.shows === undefined) {
    return `the ${view.title} page registers no reading of its own; action_items has what is waiting on the owner, and code_find on site/app can show what this page draws`;
  }
  return view.shows;
}

/**
 * Read on through a page's reading from where a cut `read_page` stopped — refused once the page moved since, or
 * where the reading was cut in the console window before it crossed (`./pageReadWindow.ts`).
 *
 * @param view the page on screen now
 * @param maxBytes the most one read carries
 * @param args the read on's `path`, `reading` and `from`, as the cut read gave them
 * @returns the next window, or the refusal
 */
export function pageReadOn({
  view,
  maxBytes,
  args,
}: {
  view: PageView;
  maxBytes: number;
  args: Readonly<Record<string, unknown>>;
}): PageReadWindow | { readonly refused: string } {
  // The same reading `pageRead` windowed, its stand-in sentence included, so an unchanged page reads on.
  const shows = pageShowsOf({ view });
  const text = JSON.stringify(shows);
  // Only a reading the console window cut and carried is refused: an unreached page's stand-in was windowed HERE, by
  // `pageRead`, so its read on goes ahead.
  const now = { carried: view.carried?.kind === "carried", path: view.path, text };
  const refused = pageReadOnRefusal({ from: args["from"], now, path: args["path"], reading: args["reading"] });
  if (refused !== undefined) {
    return { refused };
  }
  const whole: PageRead = {
    open: openKeyOf({ open: view.open }),
    page: view.title,
    path: view.path,
    shows: "",
    truncated: undefined,
  };
  const readOn =
    "this read carries one more window of the page's reading; read_page with this path, reading and nextFrom as from reads on";
  return windowRead({ cuts: readingCutsOf({ text }), maxBytes, readOn, start: Number(args["from"]), text, whole });
}
