/**
 * FIND A PUBLISHED PAGE FROM WHAT THE OWNER SAID — the pure half of `slopweaver page find`: read a page's title out of its
 * head, and rank every page against the owner's words, newest first. Which words count, and how one matches, is
 * `findWords.ts`.
 *
 * Measured: on a call the owner asked the voice for "the page showing twenty potential
 * Slopweaver icons". It had been published half an hour earlier as `slopweaver-icon-directions`, titled "Slopweaver,
 * now — twenty icon and tagline directions", and `browser present --page` would have opened it. The voice had no way
 * from the owner's words to that slug: a listing of `$SLOPWEAVER_HOME/pages` is 429 directories, alphabetical, untitled and
 * capped, so it asked the owner for the link.
 *
 * ## Any word scores, every word is not required, and a rare word scores most
 *
 * The owner describes a page, not quoting its title: "twenty potential icons" against "twenty icon and tagline
 * directions" shares two of three words, so an every-word match finds nothing. So any spoken word found in a page's
 * slug or title scores, and the page ranks by its total, then by recency, because the page meant is usually one
 * seen today.
 *
 * Counting matched words alone was MEASURED wrong on the first cut, against the 429 real pages: "the icons page" put
 * the icons page SEVENTH, behind six titles carrying both "the" and "page", and "the" also matched "other" inside a
 * word. So three rules hold now: a FILLER word ("the", "page", "showing") is never scored; a word matches only at the
 * START of a word of the page's, so "the" never hits "other" while "icon" still hits "icons"; and each word is worth
 * more the fewer pages carry it — inverse document frequency — so "icon" on four pages outweighs "slopweaver" on
 * forty. One trailing plural `s` is dropped.
 *
 * The second review MEASURED the opposite failure: "the CI page" dropped every word ("CI" as too short, the rest as
 * filler), and a search with nothing left listed all 417 pages newest first, so the voice would open the newest page,
 * not one of the three CI pages. So a two-letter word counts, matched whole, and "C.I." is read as "ci"; and words
 * that leave nothing to search on find NO page, never every page. Scoring the filler instead was tried and the third
 * review measured it opening a page nobody described, so a ranked list is only ever for words that name something.
 */

import { searchWords, wordMatches } from "./findWords.js";

/** One published page as the store lists it. */
export interface PublishedPageForFind {
  /** The page's key, which is the slug `browser present --page` opens. */
  readonly slug: string;
  /** The `<title>` its head carries, absent when it has none. */
  readonly title: string | undefined;
  /** When its current document was published, as epoch milliseconds. */
  readonly publishedMs: number;
}

/** One page `page find` reports. */
export interface FoundPage {
  readonly slug: string;
  readonly title: string | undefined;
  /** When it was published. Named `modifiedIso` on the wire since the folder read, so a reader of `--json` is unchanged. */
  readonly modifiedIso: string;
  /** Which of the owner's words it matched, in the order they were said; empty when no words were given. */
  readonly matched: readonly string[];
}

/** The named entities a page title is seen to carry, decoded in one pass so `&amp;lt;` stays `&lt;`. */
const TITLE_ENTITIES: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};

/** The first `<title>` element, case-insensitively. */
const TITLE_ELEMENT = /<title[^>]*>([\s\S]*?)<\/title>/i;

/**
 * Read the title a page's head carries.
 *
 * @param html the start of the page's `index.html` — the head is enough
 * @returns the title with its entities decoded and whitespace collapsed, or undefined when there is none or it is empty
 */
export function pageTitleOf({ html }: { html: string }): string | undefined {
  const inner = TITLE_ELEMENT.exec(html)?.[1];
  if (inner === undefined) {
    return undefined;
  }
  const decoded = inner.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => TITLE_ENTITIES[entity]!);
  const title = decoded.replace(/\s+/g, " ").trim();
  if (title.length === 0) {
    return undefined;
  }
  return title;
}

/** Room for floating-point sums of the same weights in a different order to compare equal. */
const SCORE_EPSILON = 1e-9;

/**
 * The words one page is matched against: its slug's parts, then its title's, lowercased, a day run into its month
 * (`29sep`) split in two.
 *
 * @param page the page as the store lists it
 * @returns every word a search word may begin
 */
function pageWordsOf({ page }: { page: PublishedPageForFind }): readonly string[] {
  let text = page.slug;
  if (page.title !== undefined) {
    text = `${page.slug} ${page.title}`;
  }
  return text
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * How much each matched word says about which page the owner means: the fewer pages carry it, the more it weighs.
 *
 * @param matches each page's matched search words
 * @param pageCount how many pages were searched
 * @returns each matched word's weight
 */
function wordWeights({
  matches,
  pageCount,
}: {
  matches: readonly { readonly matched: readonly string[] }[];
  pageCount: number;
}): ReadonlyMap<string, number> {
  const carriers = new Map<string, number>();
  for (const { matched } of matches) {
    for (const word of matched) {
      const before = carriers.get(word);
      carriers.set(word, before === undefined ? 1 : before + 1);
    }
  }
  return new Map([...carriers].map(([word, count]) => [word, Math.log(1 + pageCount / count)]));
}

/**
 * Rank published pages against the owner's words, or list them newest first when none were given. Words given that leave
 * nothing to search on (filler, single letters, punctuation) find no page and are named, never read as no words: a newest-first list
 * there would hand the voice the wrong page to open.
 *
 * @param pages every published page the store lists
 * @param words what the owner said, as the caller passed it; empty for the newest pages
 * @param limit the most pages to return
 * @returns the pages to offer the owner, best first, how many matched before the limit cut them, how many share the top
 *   score, and the owner's words when none could be searched on
 */
export function findPages({
  pages,
  words,
  limit,
}: {
  pages: readonly PublishedPageForFind[];
  words: readonly string[];
  limit: number;
}): {
  readonly found: readonly FoundPage[];
  readonly matching: number;
  readonly searched: readonly string[];
  readonly closeAtTop: number;
  readonly unsearchable: readonly string[];
} {
  const searched = searchWords({ words });
  const given = words.map((word) => word.trim()).filter((word) => word.length > 0);
  if (given.length > 0 && searched.length === 0) {
    return { found: [], matching: 0, searched, closeAtTop: 0, unsearchable: given };
  }
  const matches = pages.map((page) => {
    const pageWords = pageWordsOf({ page });
    return {
      matched: searched.filter((word) => pageWords.some((pageWord) => wordMatches({ pageWord, word }))),
      page,
    };
  });
  const weights = wordWeights({ matches, pageCount: pages.length });
  const scored = matches
    .filter((one) => searched.length === 0 || one.matched.length > 0)
    .map((one) => ({
      ...one,
      score: one.matched.reduce((total, word) => total + weights.get(word)!, 0),
    }))
    .toSorted((a, b) => b.score - a.score || b.page.publishedMs - a.page.publishedMs);
  const found = scored.slice(0, limit).map(({ matched, page }) => ({
    matched,
    modifiedIso: new Date(page.publishedMs).toISOString(),
    slug: page.slug,
    title: page.title,
  }));
  // A page within the top's least telling word of the top is one the owner's words did not choose between: "yesterday's
  // organisation hunt" ties every day's hunt, and "the one about the alerts channel" put one of three alerts-channel
  // pages first only because "one" sat in its title. An exact tie missed that second shape, MEASURED by
  // review. Zero when no words were given, as nothing was scored.
  let closeAtTop = 0;
  const top = scored[0];
  if (searched.length > 0 && top !== undefined) {
    const margin = Math.min(...top.matched.map((word) => weights.get(word)!));
    closeAtTop = scored.filter((one) => one.score >= top.score - margin - SCORE_EPSILON).length;
  }
  return { found, matching: scored.length, searched, closeAtTop, unsearchable: [] };
}
