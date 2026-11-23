/**
 * THE WORDS `page find` SEARCHES ON — which of the owner's spoken words name a page, how each is normalised (a dotted acronym
 * joined, an ordinal read as its number, a month to its abbreviation, one plural `s` dropped), and when one of them
 * matches a word of a page's. The ranking over those words, and why each rule exists, is `find.ts`.
 */

/** A two-letter word ("CI", "PR") matches a page's word only whole; a single letter never counts. */
const WHOLE_WORD_BELOW = 3;

/**
 * Words the owner says ABOUT a page rather than words naming one — "pull up the page showing the icons", "the one you made
 * me last week". Checked before and after the plural is dropped, so "this" and "pages" are both caught. Never scored:
 * a rare one outranks the word that does name the page, MEASURED by review when "the ISO page you made me
 * yesterday" put a page matching only "made" above all fifteen ISO pages. "today" is not filler: it names pages
 * (`slopweaver-today-27-sep`).
 */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "bring",
  "by",
  "can",
  "do",
  "earlier",
  "find",
  "for",
  "from",
  "go",
  "had",
  "has",
  "have",
  "her",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "of",
  "on",
  "one",
  "open",
  "or",
  "our",
  "page",
  "pull",
  "show",
  "showing",
  "so",
  "that",
  "the",
  "there",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "where",
  "which",
  "with",
  "you",
  "your",
  // When and how the page came to be, which a slug or title rarely carries.
  "again",
  "ago",
  "any",
  "back",
  "been",
  "before",
  "built",
  "could",
  "did",
  "does",
  "done",
  "get",
  "give",
  "got",
  "just",
  "last",
  "latest",
  "let",
  "like",
  "made",
  "make",
  "need",
  "new",
  "now",
  "please",
  "put",
  "recent",
  "saw",
  "see",
  "send",
  "sent",
  "she",
  "showed",
  "shown",
  "some",
  "them",
  "these",
  "they",
  "thing",
  "think",
  "those",
  "want",
  "wanted",
  "week",
  "will",
  "would",
  "wrote",
  // What the owner calls a page, and where it is wanted shown, rather than what it is about.
  "browser",
  "chrome",
  "doc",
  "document",
  "link",
  "screen",
  "tab",
  "window",
  "yesterday",
]);

/** Each month as a title or slug abbreviates it, "Oct" in "Weekly sync, Tue <day> Oct". */
const MONTHS: ReadonlySet<string> = new Set([
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]);

/**
 * A month however the owner or a title spells it, to its abbreviation: "October", "Oct" and "Sept" match each other and
 * nothing else, so "mar" never matches "marketing".
 */
const MONTH_OF: ReadonlyMap<string, string> = new Map([
  ...[...MONTHS].map((month): [string, string] => [month, month]),
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["sept", "sep"],
  ["september", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
]);

/** "One on one" or "1 on 1": the one place "one" names a page (`tobias-one-on-one-2-oct`) rather than refers to it. */
const ONE_ON_ONE = /\b(?:one|1)[\s-]+on[\s-]+(?:one|1)\b/i;

/**
 * The masculine pronouns, never scored under any filler list, because a speaker refers to a person with them as often as
 * with "her" or "she". Kept as a pattern rather than in a list: the owner-pronoun gate (`../devLint/ownerPronouns.ts`)
 * reads a regular-expression literal as a recogniser of speech, never as prose about the owner.
 */
const PERSON_FILLER = /^(?:he|him|his)$/;

/** A spoken ordinal, "3rd" or "21st", read as the number a title carries. */
const ORDINAL = /^(\d+)(?:st|nd|rd|th)$/;

/** An acronym speech-to-text writes with dots, "C.I." or "P.R.", read as the one word it is. */
const DOTTED_ACRONYM = /\b(?:[a-z]\.){2,}/gi;

/**
 * The word one spoken word is scored as, or undefined when it names nothing.
 *
 * @param spokenWord one lowercase word the owner said
 * @param oneOnOne whether the owner said "one on one", the one place "one" names a page
 * @param filler the words never scored
 * @returns a number or month as a title carries it, else the word with one plural `s` dropped; undefined for a
 *   single letter or filler
 */
function searchWordOf({
  spokenWord,
  oneOnOne,
  filler,
}: {
  spokenWord: string;
  oneOnOne: boolean;
  filler: ReadonlySet<string>;
}): string | undefined {
  if (spokenWord === "one" && oneOnOne) {
    return "one";
  }
  const raw = spokenWord.replace(ORDINAL, "$1");
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  if (raw.length < 2) {
    return undefined;
  }
  const month = MONTH_OF.get(raw);
  if (month !== undefined) {
    return month;
  }
  let word = raw;
  if (word.length > WHOLE_WORD_BELOW && word.endsWith("s")) {
    word = word.slice(0, -1);
  }
  if (filler.has(raw) || filler.has(word) || PERSON_FILLER.test(raw) || PERSON_FILLER.test(word)) {
    return undefined;
  }
  return word;
}

/**
 * Turn what the owner said into the distinct words a page is scored on.
 *
 * @param words the words as the caller passed them, one or many per element
 * @param filler the words never scored — a page's by default; a board row's topic search passes its own, since
 *   "browser" and "screen" name what a row is about where they only say where a page is shown
 * @returns each counted word once, lowercased, a dotted acronym joined, a trailing plural `s` dropped, single letters
 *   and filler gone, in the order they were said
 */
export function searchWords({
  words,
  filler = FILLER_WORDS,
}: {
  words: readonly string[];
  filler?: ReadonlySet<string>;
}): readonly string[] {
  const named = new Set<string>();
  const said = words.join(" ");
  const oneOnOne = ONE_ON_ONE.test(said);
  const spoken = said
    .replace(DOTTED_ACRONYM, (acronym) => acronym.replaceAll(".", ""))
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const spokenWord of spoken) {
    const word = searchWordOf({ filler, oneOnOne, spokenWord });
    if (word !== undefined) {
      named.add(word);
    }
  }
  return [...named];
}

/**
 * Whether one spoken word matches one word of a page's: a number, a month or a short word whole, a longer word at
 * the start of the page's word.
 *
 * @param word the spoken word, as `searchWords` left it
 * @param pageWord one word of the page's slug or title
 * @returns whether the page's word carries the spoken one
 */
export function wordMatches({ word, pageWord }: { word: string; pageWord: string }): boolean {
  if (MONTHS.has(word)) {
    return MONTH_OF.get(pageWord) === word;
  }
  if (word.length < WHOLE_WORD_BELOW || /^\d+$/.test(word)) {
    return pageWord === word;
  }
  return pageWord.startsWith(word);
}
