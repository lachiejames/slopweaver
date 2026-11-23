/**
 * IS THERE ALREADY A CARD FOR THIS — the pure half of `slopweaver talk find-card`: rank every board row against the
 * owner's words by what the row is ABOUT, and say where each one stands in words the owner can hear.
 *
 * At the computer the owner would look at the Queue and see that the thing they were asking about is right there, but
 * on a call finding out whether a card like that already exists is a mystery. The owner can ask whether a card for
 * giving the voice more capability exists, and one may, with a run open on it, while the voice can only say it could
 * not find that card in the Queue names or the recently removed ones it can see: `action_items` draws only the rows
 * waiting on the owner's word, and the whole board (`handover list`) is not on the voice's read list.
 *
 * ## Matched on topic, never on the slug
 *
 * A row is scored on what it says it is about — its summary, its problem, the owner's words on it (the ruling, the
 * quote stored under its anchor and every further steer's) and the question its open ask puts to the owner — and
 * never on its slug. A slug is a summary cut to a filename, so matching it adds nothing the summary does not carry except the
 * near-miss: two rows whose slugs share a prefix are not two rows about the same thing.
 *
 * The words are `page find`'s (`../pages/findWords.ts`): any word of the owner's scores, a word matches only at the
 * start of a row's word, and filler never scores. The weighting is not, and that is MEASURED: `page find` sums each matched
 * word's rarity, which on a title is fine and on a board row is not. Run over the 7,066-row board with
 * `voice capability tools access agents verbs browser`, it put every multi-kilobyte supervisor handoff and ask first
 * — each carries every one of those words somewhere — 64 rows tied at the top, and the voice-capability row, a
 * one-sentence summary matching four of the seven, was not in the first forty. So a row scores by BM25 instead: each
 * word's rarity, damped by how often it occurs and by how long the row is against the average, so a short row that
 * IS about the words outranks a long one that merely mentions them all.
 *
 * The owner's words rarely repeat a row's own ("give the voice more tools" against "the console voice can do what
 * other agents can"), so the voice is told to pass the owner's topic AND a few other ways of saying it; the ranking is a shortlist
 * the thinking model reads and judges, never a verdict on its own. What the voice is told about each row is
 * `./cardFindLines.ts`.
 */
import { searchWords, wordMatches } from "../pages/findWords.js";

/** One board row as the topic search reads it. */
export interface CardText {
  readonly slug: string;
  /** The doc's file, which names the row: two docs may carry one slug, and the board places each. */
  readonly path: string;
  /** When the row was asked, so of two equally good matches the newer one comes first; absent on an older row. */
  readonly askedIso: string | undefined;
  /** Everything the row says it is about, never its slug. */
  readonly texts: readonly string[];
}

/** One row the search found. */
export interface FoundCard {
  readonly slug: string;
  readonly path: string;
  /** Which of the owner's words it matched, in the order they said them. */
  readonly matched: readonly string[];
  readonly score: number;
}

/**
 * Words the owner says ABOUT a card rather than words naming what it is about: "is there already a card for that", "did I
 * already ask for this". The grammar words are `page find`'s; "browser", "screen", "link" and "doc" are NOT here,
 * because on a board row they name the topic ("open the owner's browser on a page they name") where on a page they only said
 * where it is shown.
 */
const CARD_FILLER: ReadonlySet<string> = new Set([
  "about",
  "already",
  "an",
  "and",
  "any",
  "anything",
  "are",
  "as",
  "ask",
  "asked",
  "asking",
  "at",
  "be",
  "been",
  "board",
  "but",
  "by",
  "can",
  "card",
  "could",
  "did",
  "do",
  "does",
  "earlier",
  "exist",
  "existing",
  "exists",
  "for",
  "from",
  "get",
  "give",
  "giving",
  "go",
  "had",
  "has",
  "have",
  "her",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "like",
  "me",
  "more",
  "my",
  "no",
  "of",
  "on",
  "one",
  "or",
  "our",
  "queue",
  "row",
  "said",
  "so",
  "some",
  "something",
  "that",
  "the",
  "there",
  "thing",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "whether",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

/** Room for floating-point sums of the same weights in a different order to compare equal. */
const SCORE_EPSILON = 1e-9;

/** BM25's term-frequency saturation: past a few occurrences, one more says little more. */
const BM25_K1 = 1.2;

/** BM25's length damping: 0 ignores a row's length, 1 divides by it outright. */
const BM25_B = 0.75;

/**
 * The words one row is matched against — every word of every text it carries, lowercased, with how often each
 * occurs — and how many words that is.
 *
 * @param texts the row's summary, problem, the owner's words and open question
 * @param counted the search's memo, when its caller ranks the same rows more than once
 * @returns each distinct word's count, and the row's length in words
 */
function rowWordsOf({ counted, texts }: { counted: RowWordMemo | undefined; texts: readonly string[] }): RowWords {
  const joined = texts.join(" ");
  if (counted === undefined) {
    return countRowWords({ joined });
  }
  const held = counted.get(joined);
  if (held !== undefined) {
    return held;
  }
  const fresh = countRowWords({ joined });
  counted.set(joined, fresh);
  return fresh;
}

/**
 * One row's distinct words with their counts, and its length in words — named only by `RowWordMemo`'s values.
 *
 * @internal
 */
export interface RowWords {
  readonly counts: ReadonlyMap<string, number>;
  readonly length: number;
}

/**
 * Rows' counted words, keyed by the very text counted, for ONE search that ranks the same rows more than once.
 * `talk find-card` ranks ten thousand rows alone, then again beside the held drafts (`./queueDraftFind.ts`), and the
 * second count was a second of its sixteen. Keyed by content, never by the array, so a
 * row whose texts changed is a different key; held by the caller, so it lives no longer than that one search.
 */
export type RowWordMemo = Map<string, RowWords>;

/**
 * A fresh memo for one search's rankings.
 *
 * @returns an empty memo
 */
export function rowWordMemo(): RowWordMemo {
  return new Map();
}

/** Count the words of one row's joined text. */
function countRowWords({ joined }: { joined: string }): RowWords {
  const counts = new Map<string, number>();
  let length = 0;
  for (const word of joined.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length === 0) {
      continue;
    }
    length += 1;
    const before = counts.get(word);
    counts.set(word, before === undefined ? 1 : before + 1);
  }
  return { counts, length };
}

/** How often a row carries one of the owner's words: the occurrences of every row word that word begins. */
function occurrences({ counts, word }: { counts: ReadonlyMap<string, number>; word: string }): number {
  let total = 0;
  for (const [pageWord, count] of counts) {
    if (wordMatches({ pageWord, word })) {
      total += count;
    }
  }
  return total;
}

/**
 * The words the owner's topic is scored on: `page find`'s normalisation over a card's own filler.
 *
 * @param words what the owner said, and any other ways of saying it the thinking model added
 * @returns each counted word once, in the order given
 */
export function cardSearchWords({ words }: { words: readonly string[] }): readonly string[] {
  return searchWords({ filler: CARD_FILLER, words });
}

/**
 * Rank every board row against the owner's words by topic. Words that leave nothing to search on find NO row and are named,
 * never read as "every row": a newest-first list there would hand the voice a card nobody described.
 *
 * @param rows every board row, as the topic search reads it
 * @param words what the owner said, and any other ways of saying it
 * @param counted a memo shared with the search's other ranking of the same rows, so each row is counted once
 * @returns every row that matched at least one word, best first; how many score near enough the best that the owner's
 *   words did not choose between them; the words scored; and the owner's words when none could be searched on
 */
export function findCards({
  counted,
  rows,
  words,
}: {
  counted?: RowWordMemo | undefined;
  rows: readonly CardText[];
  words: readonly string[];
}): {
  readonly found: readonly FoundCard[];
  readonly searched: readonly string[];
  readonly closeAtTop: number;
  readonly unsearchable: readonly string[];
} {
  const searched = cardSearchWords({ words });
  if (searched.length === 0) {
    const given = words.map((word) => word.trim()).filter((word) => word.length > 0);
    return { closeAtTop: 0, found: [], searched, unsearchable: given };
  }
  const scored = scoredRows({ counted, rows, searched });
  let closeAtTop = 0;
  const top = scored[0];
  if (top !== undefined) {
    // Within the top row's least telling word of it: a row that close is one the owner's words did not choose between.
    const margin = Math.min(...top.parts);
    closeAtTop = scored.filter((one) => one.score >= top.score - margin - SCORE_EPSILON).length;
  }
  return {
    closeAtTop,
    found: scored.map(({ matched, path, score, slug }) => ({ matched, path, score, slug })),
    searched,
    unsearchable: [],
  };
}

/** Every row that matched at least one searched word, BM25-scored, best first and newest first on a tie. */
function scoredRows({
  counted,
  rows,
  searched,
}: {
  counted: RowWordMemo | undefined;
  rows: readonly CardText[];
  searched: readonly string[];
}): readonly {
  readonly askedIso: string | undefined;
  readonly matched: readonly string[];
  readonly parts: readonly number[];
  readonly path: string;
  readonly score: number;
  readonly slug: string;
}[] {
  const measured = rows.map((row) => {
    const { counts, length } = rowWordsOf({ counted, texts: row.texts });
    const frequencies = searched.map((word) => occurrences({ counts, word }));
    return { frequencies, length, row };
  });
  const carriers = searched.map((_, index) => measured.filter((one) => one.frequencies[index]! > 0).length);
  // BM25's rarity: always positive, so a word nearly every row carries still adds a sliver rather than a penalty.
  const rarity = carriers.map((count) => Math.log(1 + (rows.length - count + 0.5) / (count + 0.5)));
  const averageLength = Math.max(1, measured.reduce((total, one) => total + one.length, 0) / Math.max(1, rows.length));
  return measured
    .map(({ frequencies, length, row }) => {
      const damping = BM25_K1 * (1 - BM25_B + (BM25_B * length) / averageLength);
      const parts = frequencies.map((frequency, index) => {
        if (frequency === 0) {
          return 0;
        }
        return (rarity[index]! * frequency * (BM25_K1 + 1)) / (frequency + damping);
      });
      return {
        askedIso: row.askedIso,
        matched: searched.filter((_, index) => frequencies[index]! > 0),
        parts: parts.filter((part) => part > 0),
        path: row.path,
        score: parts.reduce((total, part) => total + part, 0),
        slug: row.slug,
      };
    })
    .filter((one) => one.matched.length > 0)
    .toSorted((a, b) => b.score - a.score || newerFirst({ a: a.askedIso, b: b.askedIso }));
}

/** A board row's place in the dependency graph, as the composition roots are chosen from it. */
export interface CardDependency {
  readonly slug: string;
  readonly blockedBy: readonly string[];
}

/**
 * The rows to compose so each found row's section is the one the whole board gives it: the found rows, then every row
 * their `blockedBy` reaches, transitively, once each. The board composer trusts a row it only RESOLVES against for
 * its authored `done` alone, so a blocker whose journal or probes made it done would leave its dependant "not yet"
 * here while the full board called it runnable. A slug no row on the board carries is left
 * to the caller's archived lookup. Two docs can carry one slug, and the board counts a blocker done when ANY of them
 * is, so a slug's blockers are every such doc's and the caller composes every doc carrying a returned slug.
 *
 * @param found the slugs the search chose, best first
 * @param board every row on the board, slug and blockers
 * @returns the slugs to compose, the found rows first, each once
 */
export function compositionRoots({
  found,
  board,
}: {
  found: readonly string[];
  board: readonly CardDependency[];
}): readonly string[] {
  const blockersOf = new Map<string, string[]>();
  for (const row of board) {
    const before = blockersOf.get(row.slug);
    if (before === undefined) {
      blockersOf.set(row.slug, [...row.blockedBy]);
    } else {
      before.push(...row.blockedBy);
    }
  }
  const roots = [...new Set(found)].filter((slug) => blockersOf.has(slug));
  const seen = new Set(roots);
  // Breadth first, appending as it reads, so every found row comes before any blocker it reaches.
  for (let index = 0; index < roots.length; index += 1) {
    for (const blocker of blockersOf.get(roots[index]!)!) {
      if (!seen.has(blocker) && blockersOf.has(blocker)) {
        seen.add(blocker);
        roots.push(blocker);
      }
    }
  }
  return roots;
}

/** Of two instants, the later first; a row with none sorts after one with one. */
function newerFirst({ a, b }: { a: string | undefined; b: string | undefined }): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  return b.localeCompare(a);
}
