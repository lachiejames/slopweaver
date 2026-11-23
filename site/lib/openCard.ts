/**
 * The Queue card a key names, for `read_card` and `open_card` alike: the card, every address it links, and what
 * `open_card` puts in front of the owner — its first published page and its Slack thread — resolved here, before anything
 * on their screen moves.
 *
 * A card in front of the owner is what they want without asking, for every card the call turns to, not only the next
 * one. So the voice calls `open_card` before it says a word about a card the owner does not already have open, and
 * `read_card`, which opens nothing, for the one they have open, one read ahead and one they said not to open.
 *
 * Once it is called, the runner (`../components/voice/talkToolRun.ts`), never the model, does the opening: a rule the model
 * had to remember would be one it forgets. This module is the pure half — which row a key names, the console address
 * that opens its panel, and which of its links are opened rather than only read. ONE page and ONE thread: a card naming
 * ten addresses does not spray ten tabs; every address still comes back for the model to read through its own door.
 *
 * The card tools resolve a key here first, then on the Alignment page (`./cardToolPlan.ts`), whose address
 * {@link cardPagePath} builds on that page's own path.
 */
import { type BriefingAddress, briefingAddressesOf, briefingCandidatesOf } from "./briefingAddresses";
import { cardAddresses, foldedTexts } from "./cardAddresses";
import { cardCarriedTexts, cardDraftLinkUrls, cardDraftTexts } from "./cardDraftBriefings";
import { cardFilesNamed } from "./cardFiles";
import { drawnTexts } from "./inlineCitations";
import { briefingSlugOf } from "./localPageHref";
import { OPENED_BY_PARAM, type openByOf } from "./pageVoice";
import type { CardPage } from "./queueCard";
import { rowForOpen } from "./queueOpen";
import type { QueueRow } from "./queueRows";
import { VIEW_PARAM } from "./queueViews";
import type { CardRemoval, RecentlyLeftCard } from "./recentQueueDepartures";
import { panelHref } from "./workContext";

/** The Queue page's own path, which every card's panel opens on. */
export const QUEUE_PAGE_PATH = "/queue";

/** A local page a card links, with the file `file_read` reads it at. */
export interface OpenCardPage extends CardPage {
  /** The page's absolute path on this machine, off its `file://` address — what `file_read` takes. */
  readonly file: string | undefined;
}

/** Every link a card carries, split into what is opened and what is only read. */
export interface CardLinks {
  /** Every local page the card names, in the card's order. */
  readonly pages: readonly OpenCardPage[];
  /** The Slack thread the row names — its published anchor, else the first permalink in its own prose. */
  readonly threadUrl: string | undefined;
  /** Every address the card carries, local pages first, deduplicated, first seen first. */
  readonly addresses: readonly string[];
  /**
   * Every local file the card's words name, never opened: what `file_read` takes (`./cardFiles.ts`). A deliverable a
   * seat wrote down as a plan file beside its folder is here, where no page or address carries it.
   */
  readonly files: readonly string[];
  /**
   * The slug of every published briefing the card links, in either spelling (`./briefingAddresses.ts` `briefingSlugsOf`):
   * what `read_card` and `open_card` read for the voice before it says a word on the card.
   */
  readonly briefings: readonly string[];
  /**
   * The absolute file each of those briefings is read at, by slug, off the first `file://` address of any the
   * briefings were found by — a held draft's link run included — so a briefing the Queue tool ran out of time on is
   * handed to the voice to read through `file_read` rather than said unread (`./cardBriefings.ts` `cardBriefingOf`).
   * A briefing named only by its console route has none.
   */
  readonly briefingFiles: ReadonlyMap<string, string>;
}

/** One card resolved for opening: the row, where its panel is, and what of it is opened. */
export interface OpenCardPlan {
  readonly row: QueueRow;
  /**
   * When and why the card left the owner's Queue, on a card resolved among those that recently left it
   * (`./recentQueueDepartures.ts`); `undefined` on a card still on it. A removed card is read, never opened: no panel
   * on the Queue draws it.
   */
  readonly removed: CardRemoval | undefined;
  /** The console address that opens the row's panel, keeping the view choices the current address made. */
  readonly path: string;
  readonly links: CardLinks;
  /** The one page opened beside the card, or `undefined` when it links none. */
  readonly firstPage: OpenCardPage | undefined;
}

/**
 * The absolute file path a `file://` page address names, or `undefined` when it is not one this can read.
 *
 * @param url the page's `file://` address
 * @returns the path, query and fragment dropped
 */
function fileOf({ url }: { url: string }): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "file:") {
    return undefined;
  }
  // A stray `%` in a card's prose is not an escape, and must never throw out of `open_card`:
  // the page still opens by slug, only its file path is unknown.
  try {
    return decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
}

/**
 * Every link one card carries: its local pages, its Slack thread, and every address, local pages first.
 *
 * @param row the queue row
 * @returns the links
 */
export function cardLinksOf({ row }: { row: QueueRow }): CardLinks {
  const pages = row.card.pages.map((page): OpenCardPage => ({ ...page, file: fileOf({ url: page.url }) }));
  const { addresses, texts } = cardWords({ row });
  const files = cardFilesNamed({ texts });
  const sources = briefingSourcesOf({ row });
  const briefings = briefingAddressesOf(sources).map((briefing) => briefing.slug);
  const briefingFiles = briefingFilesOf(sources);
  return { addresses, briefingFiles, briefings, files, pages, threadUrl: row.threadUrl };
}

/**
 * The file each briefing is read at, by slug, off the first `file://` address of every one the briefings themselves
 * are found by (`./briefingAddresses.ts` `briefingCandidatesOf`), so the two can never disagree about a briefing.
 *
 * @param urls the card's pages' addresses, then every other address it carries
 * @param texts the card's words, whole
 * @returns each briefing's absolute file, by slug, first address first
 */
export function briefingFilesOf({
  urls,
  texts,
}: {
  urls: readonly string[];
  texts: readonly string[];
}): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const url of briefingCandidatesOf({ texts, urls })) {
    const slug = briefingSlugOf({ url });
    const file = fileOf({ url });
    if (slug !== undefined && file !== undefined && !files.has(slug)) {
      files.set(slug, file);
    }
  }
  return files;
}

/**
 * A card's addresses, local pages first and each once, and its own words: drawn sentences, the whole `what`, the
 * subject and what the record folds.
 *
 * @returns the addresses and the texts
 */
function cardWords({ row }: { row: QueueRow }): { addresses: readonly string[]; texts: readonly string[] } {
  const addresses: string[] = [];
  for (const url of [...row.card.pages.map((page) => page.url), ...cardAddresses({ row })]) {
    if (!addresses.includes(url)) {
      addresses.push(url);
    }
  }
  // The whole `what`, not only its drawn sentences: the Tauri card's plan sits below its fold.
  const whole = row.card.what === undefined ? [] : [row.card.what.whole];
  // A detached ask's read reason too: it is folded beneath that `what` (`foldedTexts`).
  const texts = [...drawnTexts({ card: row.card }), ...whole, row.card.subject, ...foldedTexts({ record: row.record })];
  return { addresses, texts };
}

/**
 * Every published briefing one card links, with the address it was first named by — what `read_card` and `open_card`
 * read for the voice AND what the Queue draws as the card's chips (`./cardBriefingPages.ts`), one resolution for both.
 * Every string the row carries is searched, at any depth, and every held draft the card names, its words and its link
 * runs (`./cardDraftBriefings.ts`).
 *
 * @param row the queue row
 * @returns each briefing once, first seen first
 */
export function cardBriefingAddresses({ row }: { row: QueueRow }): readonly BriefingAddress[] {
  return briefingAddressesOf(briefingSourcesOf({ row }));
}

/**
 * Every address and every text a card's briefings are searched for in: its own, what the record carries, and every
 * held draft it names, words and link runs.
 *
 * @returns the URLs and texts
 */
function briefingSourcesOf({ row }: { row: QueueRow }): { urls: readonly string[]; texts: readonly string[] } {
  const { addresses, texts } = cardWords({ row });
  return {
    texts: [...texts, ...cardCarriedTexts({ row }), ...cardDraftTexts({ row })],
    urls: [...addresses, ...cardDraftLinkUrls({ row })],
  };
}

/**
 * The console address that opens one card's panel on the Queue, from wherever the console is now: the Queue's own
 * path, the row's key, and the view choices the current address made — its context, sidebar and tag selectors —
 * exactly as opening a panel by click keeps them, and never a `view` (below). A row the context hides is the Queue's own deep-link case: its
 * panel switches to the row's context (`../components/console/OpenFallbackPanels.tsx` `SwitchingPanel`).
 *
 * The address carries exactly one `by=voice` ({@link openByOf}): the voice put this card in front of the owner, so their
 * words over it are not a steer on it until they relay one or open it themselves.
 * `panelHref` drops it, which is how the owner's own click on any row — this one included — takes the marker away.
 *
 * @param fromPath the console's current path and query, as the address bar holds them
 * @param key the row key to open
 * @returns the path and query to navigate to
 */
export function queueCardPath({ fromPath, key }: { fromPath: string; key: string }): string {
  return cardPagePath({ fromPath, key, pathname: QUEUE_PAGE_PATH });
}

/**
 * The console address that opens one card on the page that draws it — the Queue, or the Alignment page for an act
 * (`./cardToolPlan.ts`) — keeping the view choices the current address made, never a `view`, and
 * carrying exactly one `by=voice` ({@link queueCardPath} says why).
 *
 * @param fromPath the console's current path and query, as the address bar holds them
 * @param key the card's key
 * @param pathname the page that draws the card
 * @returns the path and query to navigate to
 */
export function cardPagePath({ fromPath, key, pathname }: { fromPath: string; key: string; pathname: string }): string {
  const cut = fromPath.indexOf("?");
  const params = new URLSearchParams(cut === -1 ? "" : fromPath.slice(cut));
  // Never a view: the Queue's own, the Pull requests page's or the Fleet page's `view` would ride onto the Queue, and
  // the desktop shell refuses a card address carrying one — every open from a page with a view chosen was refused.
  params.delete(VIEW_PARAM);
  const href = panelHref({ open: key, pathname, search: `?${params.toString()}` });
  return `${href}${href.includes("?") ? "&" : "?"}${OPENED_BY_PARAM}=voice`;
}

/**
 * Resolve the card one key names among the rows, exact key first and then an alias, as `?open=` does — before
 * anything is opened, so an unknown key moves nothing on the owner's screen. A key no row on the Queue answers to is
 * then looked for among the cards that recently left it, and comes back marked removed, so a removed card can still be
 * seen. Live first, so a card back on the Queue is never read as gone.
 *
 * @param fromPath the console's current path and query
 * @param key the key the model named
 * @param rows every row every register holds, in both work contexts
 * @param recentlyLeft the cards that recently left the Queue, never merged into `rows`
 * @returns the plan, or `undefined` when no row on the Queue or recently off it answers to the key
 */
export function openCardPlan({
  fromPath,
  key,
  rows,
  recentlyLeft,
}: {
  fromPath: string;
  key: string;
  rows: readonly QueueRow[];
  recentlyLeft: readonly RecentlyLeftCard[];
}): OpenCardPlan | undefined {
  // The key exactly as given, never trimmed: a padded key no row answers to moves nothing, as on the Queue,
  // and the model is told so and can call again with the key `action_items` gave it.
  const live = rowForOpen({ open: key, rows });
  if (live !== undefined) {
    return cardPlanOf({ fromPath, removed: undefined, row: live });
  }
  const gone = rowForOpen({ open: key, rows: recentlyLeft.map((left) => left.row) });
  const left = recentlyLeft.find((one) => one.row === gone);
  if (left === undefined) {
    return undefined;
  }
  return cardPlanOf({ fromPath, removed: left.removed, row: left.row });
}

/**
 * One resolved row as the plan `read_card` and `open_card` act on.
 *
 * @param fromPath the console's current path and query
 * @param row the resolved row
 * @param removed when and why it left the Queue, or `undefined` while it is on it
 * @returns the plan
 */
export function cardPlanOf({
  fromPath,
  row,
  removed,
}: {
  fromPath: string;
  row: QueueRow;
  removed: CardRemoval | undefined;
}): OpenCardPlan {
  const links = cardLinksOf({ row });
  // A published page only, in either spelling: a row's artifact may be a pull request or a web address
  // (`./cardPages.ts`), which the card cites but the page verb, opening by slug, cannot.
  const firstPage = links.pages.find((page) => briefingSlugOf({ url: page.url }) === page.slug);
  return { firstPage, links, path: queueCardPath({ fromPath, key: row.key }), removed, row };
}
