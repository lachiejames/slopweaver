/**
 * The tokenizer, the cardinal reader and the Queue noun and subject a count names. Split out of
 * `./talkCountGrounding.ts`.
 */

import type { CountClaim, QueueCountSubject } from "./talkCountGroundingTypes";
import { sentenceEndAt, TENS, TOKEN, type Token, UNITS } from "./talkCountGroundingWords";

/**
 * The text as tokens.
 *
 * @returns every number, word and stop, in order
 */
export function tokensOf({ text }: { text: string }): readonly Token[] {
  let previousEnd = 0;
  return Array.from(text.matchAll(TOKEN), (match) => {
    const raw = match[0];
    const spacedFromPrevious = previousEnd > 0 && /^\s+$/u.test(text.slice(previousEnd, match.index));
    let kind: Token["kind"] = "word";
    if (/^\d/u.test(raw)) {
      kind = "digits";
    } else if (/^[,–—]$/u.test(raw)) {
      kind = "comma";
    } else if (/^[.!?;:]$/u.test(raw)) {
      kind = "stop";
    }
    const end = match.index + raw.length;
    const ends = sentenceEndAt({ end, raw, start: match.index, text });
    previousEnd = end;
    // NFKC before lowercasing, so a compatibility form ("ſAY") folds to the word it spells.
    const lower = raw.normalize("NFKC").toLowerCase();
    return { end, endsSentence: ends, kind, lower, spacedFromPrevious, start: match.index, text: raw };
  });
}

/**
 * A number from zero to 99 starting at one word: "fourteen", "twenty-six", "twenty six".
 *
 * @returns its value and the index after it, or `undefined` when the word is no such number
 */
function smallAt({
  tokens,
  at,
}: {
  tokens: readonly Token[];
  at: number;
}): { value: number; next: number } | undefined {
  const token = tokens.at(at);
  if (token?.kind !== "word") {
    return undefined;
  }
  const parts = token.lower.split("-");
  if (parts.length === 2) {
    const tens = TENS[parts[0]];
    const unit = UNITS[parts[1]];
    if (tens === undefined || unit === undefined || unit < 1 || unit > 9) {
      return undefined;
    }
    return { next: at + 1, value: tens + unit };
  }
  const unit = UNITS[token.lower];
  if (unit !== undefined) {
    return { next: at + 1, value: unit };
  }
  const tens = TENS[token.lower];
  if (tens === undefined) {
    return undefined;
  }
  const after = tokens.at(at + 1);
  const following = after?.kind === "word" ? UNITS[after.lower] : undefined;
  if (following !== undefined && following >= 1 && following <= 9) {
    return { next: at + 2, value: tens + following };
  }
  return { next: at + 1, value: tens };
}

/** One invisible format character (`\p{Cf}`), a surrogate pair included. */
const FORMAT_CHARACTER = /^\p{Cf}$/u;

/**
 * Steps back from `index` over every invisible format character, however many there are.
 *
 * @returns the index just after the nearest visible code unit before `index`, or 0
 */
function visibleEndBefore({ text, index }: { text: string; index: number }): number {
  let at = index;
  while (at > 0) {
    if (at >= 2 && FORMAT_CHARACTER.test(text.slice(at - 2, at))) {
      at -= 2;
    } else if (FORMAT_CHARACTER.test(text.slice(at - 1, at))) {
      at -= 1;
    } else {
      return at;
    }
  }
  return at;
}

/**
 * Steps forward from `index` over every invisible format character, however many there are.
 *
 * @returns the index of the nearest visible code unit at or after `index`, or the text's length
 */
function visibleStartAfter({ text, index }: { text: string; index: number }): number {
  let at = index;
  while (at < text.length) {
    const character = String.fromCodePoint(text.codePointAt(at)!);
    if (!FORMAT_CHARACTER.test(character)) {
      return at;
    }
    at += character.length;
  }
  return at;
}

/**
 * A cardinal starting at one token: digits, or English words up to 999.
 *
 * @returns its value and the index after it, or `undefined` when no cardinal starts there
 */
export function cardinalAt({
  tokens,
  at,
  text,
}: {
  tokens: readonly Token[];
  at: number;
  text: string;
}): { value: number; next: number } | undefined {
  const token = tokens[at];
  if (token.kind === "digits") {
    const before = text.slice(Math.max(0, token.start - 1), token.start);
    const after = text.slice(token.end, token.end + 2);
    // A money figure, an identifier, a percentage or a decimal is not a count of cards. Digits glued to a
    // letter are part of a name: "KnowBe4 card" read as "4 card" handed the voice a correction it spoke
    // unasked ("Everything shows eighty-six cards, not four.").
    // Two code units back, so a letter outside the BMP (a surrogate pair, "𐐀4") is still seen whole; a
    // combining mark ends a decomposed letter ("é" + "4"), so it counts as one. The trade: a word
    // run into its figure ("exactly4 cards") reads as a name too and goes unrecorded. A transcript spaces
    // its words while product names glue (KnowBe4, Office365), and a missed count is only a missing record line.
    // A run of invisible format characters of any length (a zero-width joiner, U+200D)
    // glues as well as no character does, so it is stepped over on both sides. Such a run also splits one
    // figure into two digit tokens ("KnowBe4" + U+200D + "2"), so a digit across it glues too;
    // with no run between them, the tokenizer has already taken neighbouring digits into one token. Any number
    // character glues, not only a decimal digit: "4²" is no count of four.
    const leadEnd = visibleEndBefore({ index: token.start, text });
    const lead = text.slice(Math.max(0, leadEnd - 2), leadEnd);
    const trailStart = visibleStartAfter({ index: token.end, text });
    const trail = text.slice(trailStart, trailStart + 2);
    const glued = /[\p{L}\p{M}\p{N}]$/u.test(lead) || /^[\p{L}\p{M}\p{N}]/u.test(trail);
    if (glued || before === "$" || before === "#" || after.startsWith("%") || /^\.\d/u.test(after)) {
      return undefined;
    }
    const value = Number(token.text.replaceAll(",", ""));
    // A digit run past exact integers is no figure a sentence says, and no grounding could carry it.
    if (!Number.isSafeInteger(value)) {
      return undefined;
    }
    return { next: at + 1, value };
  }
  const small = smallAt({ at, tokens });
  if (small === undefined) {
    return undefined;
  }
  const scale = tokens.at(small.next);
  if (small.value < 1 || small.value > 9 || scale?.lower !== "hundred") {
    return small;
  }
  const hundreds = small.value * 100;
  let rest = small.next + 1;
  const joined = tokens.at(rest);
  if (joined?.lower === "and") {
    rest += 1;
  }
  const tail = smallAt({ at: rest, tokens });
  if (tail === undefined) {
    return { next: small.next + 1, value: hundreds };
  }
  return { next: tail.next, value: hundreds + tail.value };
}

/**
 * The Queue noun a word is, if it is one.
 *
 * @returns the noun, or `undefined`
 */
export function nounOf({ word }: { word: string }): CountClaim["noun"] | undefined {
  if (word === "card" || word === "cards") {
    return "card";
  }
  if (word === "item" || word === "items") {
    return "item";
  }
  if (word === "ask" || word === "asks") {
    return "ask";
  }
  if (/^check-?ins?$/u.test(word)) {
    return "check-in";
  }
  return undefined;
}

/** The prepositions that place a count IN a context: "in the work context", "from the Slopweaver context". */
const CONTEXT_PLACES: ReadonlySet<string> = new Set(["from", "in", "on", "under"]);

/**
 * Whether the words before `at` open a phrase placing the count in a context: a place preposition directly, or one
 * then "the" — never a context that is only a clause's subject, as in "because the Slopweaver context is open".
 *
 * @param at the index of the context's name
 * @returns true when the name is the object of a place preposition
 */
function placedAt({ at, words }: { at: number; words: readonly string[] }): boolean {
  let place = at - 1;
  if (words[place] === "the") {
    place = at - 2;
  }
  // A clause opening on the name, or on "the" and the name, has no word before it to place it.
  return place >= 0 && CONTEXT_PLACES.has(words[place]);
}

/**
 * The work contexts a clause places its count in: each name standing directly before the word "context", inside a
 * place phrase, once each.
 *
 * @param words the clause's words, lowercased
 * @returns the distinct contexts named, in the order first named
 */
function contextsNamed({ words }: { words: readonly string[] }): readonly ("slopweaver" | "work")[] {
  const named: ("slopweaver" | "work")[] = [];
  words.forEach((word, at) => {
    const before = words[at - 1];
    if (word !== "context" || (before !== "slopweaver" && before !== "work") || named.includes(before)) {
      return;
    }
    if (placedAt({ at: at - 1, words })) {
      named.push(before);
    }
  });
  return named;
}

/**
 * Which figure the words around a count name.
 *
 * @param noun the counted noun
 * @param words the words between the number and the noun, and after the noun up to the clause's end
 * @returns the subject
 */
export function subjectOf({ noun, words }: { noun: CountClaim["noun"]; words: readonly string[] }): QueueCountSubject {
  if (noun === "check-in") {
    return "check-in";
  }
  // Only a context the count is placed IN, the name directly before "context": "twenty work cards" is a bare count,
  // "twenty cards in the work context" is not, "cards about Slopweaver in the work context" names the work context, and
  // "fourteen cards because the Slopweaver context is open" names none. Naming both names neither.
  const named = contextsNamed({ words });
  if (named.length === 1) {
    return named[0] === "slopweaver" ? "slopweaver-context" : "work-context";
  }
  const qualified = QUALIFIERS.find(({ pattern }) => words.some((word) => pattern.test(word)));
  if (qualified !== undefined) {
    return qualified.subject;
  }
  if (noun === "ask") {
    return "asks";
  }
  if (words.includes("queue")) {
    return "queue";
  }
  return "everything";
}

/** The words that name a figure, most specific first. */
const QUALIFIERS: readonly { readonly pattern: RegExp; readonly subject: QueueCountSubject }[] = [
  { pattern: /^check-?ins?$/u, subject: "check-in" },
  { pattern: /^fleet$/u, subject: "fleet" },
  { pattern: /^colleagues?$/u, subject: "colleague" },
  { pattern: /^urgent$/u, subject: "urgent" },
  { pattern: /^(slack|drafts?)$/u, subject: "slack" },
  { pattern: /^findings?$/u, subject: "finding" },
  { pattern: /^reviews?$/u, subject: "review" },
  { pattern: /^waiting$/u, subject: "waiting" },
];
