/**
 * The token shape, the number words and the word sets the count parser reads a stretch of speech with, and where a
 * sentence ends. Split out of `./talkCountGrounding.ts`.
 */

/** One word, number or stop the parser walks. */
export interface Token {
  readonly text: string;
  readonly lower: string;
  readonly start: number;
  readonly end: number;
  readonly kind: "digits" | "word" | "stop" | "comma";
  /** Whether it ends a sentence, read off the raw text around it ({@link sentenceEndAt}), never off its neighbours. */
  readonly endsSentence: boolean;
  /** Whether only whitespace separates it from the token before it in the raw text. */
  readonly spacedFromPrevious: boolean;
}

/**
 * A word is letters of any script with their combining marks, so no word between two others is skipped: "they сейчас
 * say" is not "they say".
 */
export const TOKEN = /\d{1,3}(?:,\d{3})+(?!\d)|\d+|\p{L}[\p{L}\p{M}]*(?:[-'’]\p{L}[\p{L}\p{M}]*)*|[.!?;:]|[,—–]/gu;

export const UNITS: Readonly<Partial<Record<string, number>>> = {
  eight: 8,
  eighteen: 18,
  eleven: 11,
  fifteen: 15,
  five: 5,
  four: 4,
  fourteen: 14,
  nine: 9,
  nineteen: 19,
  one: 1,
  seven: 7,
  seventeen: 17,
  six: 6,
  sixteen: 16,
  ten: 10,
  thirteen: 13,
  three: 3,
  twelve: 12,
  two: 2,
  zero: 0,
};

export const TENS: Readonly<Partial<Record<string, number>>> = {
  eighty: 80,
  fifty: 50,
  forty: 40,
  ninety: 90,
  seventy: 70,
  sixty: 60,
  thirty: 30,
  twenty: 20,
};

/** A word before the number that makes it a place or a part, never the Queue's total. */
export const NOT_A_TOTAL_BEFORE = new Set([
  "top",
  "first",
  "last",
  "next",
  "another",
  "those",
  "these",
  "other",
  "per",
]);

/**
 * A word between the number and its noun that makes it relative or a part — or a picked subset, never the Queue's
 * total: "I can't name ten specific cards yet". "Different", "separate" and
 * "individual" stay counts: "fourteen different cards in Everything" is a total.
 */
export const NOT_A_TOTAL_BETWEEN = new Set([
  "of",
  "more",
  "other",
  "fewer",
  "less",
  "extra",
  "additional",
  "than",
  "per",
  "specific",
  "particular",
]);

/**
 * A word opening a supposed case, so a number after it in the same sentence is an example, never a count, as is the
 * last part of a hyphenated word ("what-if"). "Say" is one too ("Say one card contains three controls")
 * unless a speaker comes straight before it: "I'd say fourteen cards" is a claim.
 */
export const SUPPOSING_BEFORE = new Set(["suppose", "imagine", "hypothetically", "if"]);

/** Who can come straight before "say" when it reports a figure ("I'd say fourteen", "as I say") rather than supposes one. */
export const SAYING_SPEAKERS = new Set(["i", "i'd", "i’d", "we", "we'd", "we’d", "you", "they", "would"]);

/** The stops that end a sentence, as against ":" and ";", which only end a clause. */
const SENTENCE_ENDS = new Set([".", "!", "?"]);

/** Words whose "." is an abbreviation's, never a sentence's ("Suppose Dr. Patel has fourteen cards"). */
const ABBREVIATIONS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "st",
  "jr",
  "sr",
  "no",
  "vs",
  "etc",
  "approx",
  "inc",
  "ltd",
  "co",
  "fig",
  "vol",
]);

/** More letters than the longest word of {@link ABBREVIATIONS}: past this many the run is neither one nor the other. */
const LETTER_RUN_CAP = 7;

/**
 * The letters, any script, running straight up to `at`, walked back one code point at a time with every combining
 * mark skipped rather than counted ("é" decomposed is one letter, however many marks ride on it), and the
 * walk stopped at {@link LETTER_RUN_CAP} letters. A window of characters would let a run of marks push the letter out
 * of it.
 *
 * @param at the index just after the run
 * @returns the run's letters in reading order, at most {@link LETTER_RUN_CAP} of them
 */
function lettersBefore({ text, at }: { text: string; at: number }): readonly string[] {
  const letters: string[] = [];
  let index = at;
  while (index > 0 && letters.length < LETTER_RUN_CAP) {
    const low = text.charCodeAt(index - 1);
    const high = text.charCodeAt(index - 2);
    const paired = index >= 2 && low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff;
    const from = paired ? index - 2 : index - 1;
    const point = text.slice(from, index);
    if (!/^\p{M}$/u.test(point)) {
      if (!/^\p{L}$/u.test(point)) {
        break;
      }
      letters.unshift(point);
    }
    index = from;
  }
  return letters;
}

/** Whitespace then a capital or a digit, read from just after a "." (sticky, so it starts exactly there). */
const OPENS_NEXT_SENTENCE = /\s+[\p{Lu}\p{Lt}\d]/uy;

/** Nothing but whitespace from just after a "." to the end of the text. */
const ONLY_SPACE_TO_END = /\s*$/uy;

/**
 * Whether the stop `raw` at `start..end` of `text` ends a sentence, read off the RAW characters: the tokenizer skips
 * brackets, quotes, `*` and letters outside ASCII, so a neighbouring token says nothing about what touches the stop
 * (`. (Fourteen`, `plan é.`). "!" and "?" always do. A "." does only when whitespace and then a capital or a
 * digit follow it straight away, or nothing but whitespace does, and the letters straight before it are neither one
 * letter nor a word of {@link ABBREVIATIONS} ("U.S.", "Dr. Patel"). A sentence end misread here
 * hides an earlier supposing word, so every doubt reads as "not an end": its cost is a dropped claim, never an added one.
 *
 * @param raw the stop's own text
 * @param start where the stop starts in `text`
 * @returns true when the stop is a sentence's last
 */
export function sentenceEndAt({
  text,
  raw,
  start,
  end,
}: {
  text: string;
  raw: string;
  start: number;
  end: number;
}): boolean {
  if (!SENTENCE_ENDS.has(raw)) {
    return false;
  }
  if (raw !== ".") {
    return true;
  }
  const letters = lettersBefore({ at: start, text });
  if (letters.length === 1 || ABBREVIATIONS.has(letters.join("").toLowerCase())) {
    return false;
  }
  OPENS_NEXT_SENTENCE.lastIndex = end;
  ONLY_SPACE_TO_END.lastIndex = end;
  return OPENS_NEXT_SENTENCE.test(text) || ONLY_SPACE_TO_END.test(text);
}

/**
 * Whether the token at `index` ends a sentence.
 *
 * @returns the token's own {@link Token.endsSentence}
 */
export function endsSentence({ tokens, index }: { tokens: readonly Token[]; index: number }): boolean {
  return tokens[index].endsSentence;
}

/**
 * A word before "one" that makes it a pronoun ("the one it asks for", "that one"), never a count. Measured: "that's
 * the one it asks for" was read as one ask, and the correction it owed had the voice say "Everything's ninety-three."
 * twice, out of nowhere.
 */
export const PRONOUN_ONE_BEFORE = new Set(["the", "that", "this", "which", "each", "any", "every", "no"]);

/**
 * A subject pronoun between the number and its noun: the noun is then the verb of a clause of its own ("one it asks
 * for", "two they want"), never what the number counts.
 */
const CLAUSE_SUBJECTS = new Set(["i", "you", "she", "it", "we", "they"]);

/**
 * The masculine pronouns, a clause's subject or a new phrase's determiner exactly as "she" and "her" are. Kept as
 * patterns rather than in the lists: the owner-pronoun gate (`src/devLint/ownerPronouns.ts`) reads a
 * regular-expression literal as a recogniser of speech, never as prose about the owner.
 */
const PERSON_SUBJECT = /^he$/u;
const PERSON_DETERMINER = /^his$/u;

/**
 * Whether a word opens a clause as its subject, so a number before it is not counting what follows.
 *
 * @param word one lowercase token
 * @returns true for a subject pronoun
 */
export function isClauseSubject({ word }: { word: string }): boolean {
  return CLAUSE_SUBJECTS.has(word) || PERSON_SUBJECT.test(word);
}

/** A word that joins two clauses, so a label before it and a figure after it are not said together. */
export const CLAUSE_JOINS = new Set(["and", "but", "or", "so", "while", "whereas", "though", "although", "yet"]);

/**
 * A word between the number and a noun that opens a phrase of its own, so the noun is not what the number counts: a
 * determiner, a joining word, or a word opening a clause. "I picked one because the card is urgent" was read
 * as one urgent card. "The" is not one, since a label carries it: "26 blocking the fleet cards".
 */
const NEW_PHRASE_BETWEEN = new Set([
  ...CLAUSE_JOINS,
  ...[...PRONOUN_ONE_BEFORE].filter((word) => word !== "the"),
  "a",
  "an",
  "these",
  "those",
  "my",
  "your",
  "our",
  "their",
  "her",
  "its",
  "because",
  "since",
  "as",
  "if",
  "when",
  "where",
  "who",
  "whether",
  "until",
  "unless",
]);

/**
 * Whether a word between the number and a noun opens a phrase of its own, so the noun is not what the number counts.
 *
 * @param word one lowercase token
 * @returns true for a determiner, a joining word or a clause opener
 */
export function isNewPhraseBetween({ word }: { word: string }): boolean {
  return NEW_PHRASE_BETWEEN.has(word) || PERSON_DETERMINER.test(word);
}

/** How many words may sit between the number and its noun. */
export const MAX_BETWEEN = 3;

/** How many words after the noun may still name what it counts. */
export const MAX_AFTER = 6;

/** A word that opens a figure said after what it counts: "cards on your Queue is 14", "Everything is at 29". */
export const INVERTED_OPENERS = new Set(["cards", "items", "asks", "check-ins", "checkins", "queue", "everything"]);

/** A word saying the figure follows: "is", "stands", "comes". */
export const COPULAS = new Set(["is", "are", "stands", "sits", "totals", "comes"]);

/** A word that may sit between that word and the figure: "is at", "comes to", "is now". */
export const COPULA_LINKS = new Set(["at", "to", "now", "currently", "still"]);
