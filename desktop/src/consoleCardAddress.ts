/**
 * The console address a card request from the voice's window may load: one Queue card's panel or one Alignment card,
 * rebuilt parameter by parameter, never the renderer's raw value.
 *
 * The voice is tested against every Queue AND Alignment card, so the shell loads both kinds of address; loading only
 * `/queue?` addresses would leave `open_card` unable to put an Alignment card in front of the owner.
 */
import type { DesktopRole } from "./desktopBridge";

/**
 * The longest card address the voice's window may send. Every tag the owner has picked rides in it, as in the Queue's own
 * click link, so 512 would refuse a link the Queue itself builds; this only stops a runaway message,
 * since main rebuilds the address it loads parameter by parameter.
 */
export const MAX_CONSOLE_CARD_PATH = 8192;

/** The console pages whose cards the voice may put in front of the owner; each opens a card by `?open=`. */
const CARD_PAGES: readonly string[] = ["/queue", "/alignment"];

/**
 * The query parameters a card's address may carry: the card, the view choices opening one keeps, and `by`, which says
 * the voice opened it.
 */
const CARD_PARAMS: ReadonlySet<string> = new Set(["open", "context", "rail", "tag", "by"]);

/**
 * The one value `by` takes. Every card this shell loads from the voice's window carries it, so the owner's words over a card
 * the voice put in front of them are not landed on it (`site/lib/pageVoice.ts` `openByOf`).
 */
const OPENED_BY_VOICE = "voice";

/**
 * The card page an address opens on, and its query, or `undefined` when it is not exactly one of {@link CARD_PAGES}
 * followed by a query.
 *
 * @param value the address the voice's window sent
 * @returns the page's path and the query after its `?`
 */
function cardPageOf({ value }: { value: string }): { pathname: string; query: string } | undefined {
  const pathname = CARD_PAGES.find((page) => value.startsWith(`${page}?`));
  if (pathname === undefined) {
    return undefined;
  }
  return { pathname, query: value.slice(pathname.length + 1) };
}

/**
 * The console address a card request may load, when the voice's window sent it: exactly `/queue` or `/alignment` with
 * one non-empty `open`, at most one `by=voice`, and nothing but the view choices beside them (`site/lib/openCard.ts`
 * `cardPagePath`, which never sends a `view`). The voice asks the shell to put a card on the owner's screen — the one it is
 * about to talk about, or one they ask for; what the shell loads is
 * this rebuilt address, never the renderer's raw value, and never one from the console window itself. It always
 * carries `by=voice`, so a renderer built before the marker still marks the card it asks for.
 *
 * @param role which window sent it, or `undefined` when the sender is neither
 * @param value what was sent
 * @returns the path and query to load, or `undefined` when it is not exactly a card's address from the voice
 */
export function consoleCardPathFromMessage({
  role,
  value,
}: {
  role: DesktopRole | undefined;
  value: unknown;
}): string | undefined {
  if (role !== "overlay" || typeof value !== "string" || value.length > MAX_CONSOLE_CARD_PATH) {
    return undefined;
  }
  const page = cardPageOf({ value });
  if (page === undefined || /[\s#\\]/u.test(value)) {
    return undefined;
  }
  const params = new URLSearchParams(page.query);
  const keys = [...params.keys()];
  const open = params.getAll("open");
  if (keys.some((key) => !CARD_PARAMS.has(key)) || open.length !== 1 || open[0]?.trim() === "") {
    return undefined;
  }
  if (params.getAll("context").length > 1 || params.getAll("rail").length > 1) {
    return undefined;
  }
  const by = params.getAll("by");
  if (by.length > 1 || (by.length === 1 && by[0] !== OPENED_BY_VOICE)) {
    return undefined;
  }
  params.set("by", OPENED_BY_VOICE);
  // Bounded again once marked, so the page this loads can always be carried back as the overlay's.
  const marked = `${page.pathname}?${params.toString()}`;
  if (marked.length > MAX_CONSOLE_CARD_PATH) {
    return undefined;
  }
  return marked;
}

/** The view choices a card's address keeps from the page the owner is on, one value each; `tag` repeats. */
const SINGLE_VIEW_PARAMS: readonly string[] = ["context", "rail"];

/**
 * The card's address with the view choices the console window holds AT THIS MOMENT, on the page the card asked for.
 * The voice's window builds its address from the last page the console published, which a sidebar collapsed or a tag
 * picked a moment ago may not have reached yet; main can read the console window's live address, so
 * the card it opens keeps exactly the context, sidebar and tags the owner is looking at — even while the service reads
 * as not ready, since the window still shows what it showed. Only those three parameters are copied,
 * re-encoded into a fresh path on the card's own page beside the card and its `by=voice`, so the live address cannot
 * widen what is loaded. On the Alignment page the voice's context is kept, since it is the one that draws the card.
 * A window closed, or on a holding page (a `data:` address), has no view choices to give, and the
 * voice's own are kept — as they are when the live ones would take the address past {@link MAX_CONSOLE_CARD_PATH}.
 *
 * @param path the card's address, already accepted by {@link consoleCardPathFromMessage}
 * @param liveUrl the console window's current address, or `undefined` when it is closed
 * @returns the path and query to load
 */
export function consoleCardPathOnConsole({ path, liveUrl }: { path: string; liveUrl: string | undefined }): string {
  const page = cardPageOf({ value: path });
  if (page === undefined || liveUrl === undefined || !URL.canParse(liveUrl)) {
    return path;
  }
  const live = new URL(liveUrl);
  if (live.protocol !== "http:" && live.protocol !== "https:") {
    return path;
  }
  const params = new URLSearchParams(page.query);
  const kept = new URLSearchParams();
  kept.set("open", params.get("open")!);
  // As the Queue's own click builds it (`site/lib/workContext.ts` `panelHref`): the first context and sidebar, every tag.
  for (const name of SINGLE_VIEW_PARAMS) {
    const value = live.searchParams.get(name);
    if (value !== null) {
      kept.set(name, value);
    }
  }
  // The Alignment page draws an act only in a context that shows it, and nothing in its place, so the context the
  // voice chose for the act is kept over the live one (`site/lib/cardToolPlan.ts` `actFromPath`).
  const chosen = params.get("context");
  if (page.pathname === "/alignment" && chosen !== null) {
    kept.set("context", chosen);
  }
  for (const value of live.searchParams.getAll("tag")) {
    kept.append("tag", value);
  }
  // Never taken off the live address: the card is the voice's to mark, whatever the owner opened last.
  kept.set("by", OPENED_BY_VOICE);
  const onConsole = `${page.pathname}?${kept.toString()}`;
  // Past the bound the page could not be carried back as the overlay's, so the voice's own choices are kept.
  if (onConsole.length > MAX_CONSOLE_CARD_PATH) {
    return path;
  }
  return onConsole;
}
