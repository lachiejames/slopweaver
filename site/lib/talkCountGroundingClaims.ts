/**
 * The claim readers: a count at one token, said either way round, and whether the speech only supposes it. Split out
 * of `./talkCountGrounding.ts`.
 */

import { cardinalAt, nounOf, subjectOf } from "./talkCountGroundingTokens";
import type { CountClaim } from "./talkCountGroundingTypes";
import {
  CLAUSE_JOINS,
  COPULA_LINKS,
  COPULAS,
  endsSentence,
  INVERTED_OPENERS,
  isClauseSubject,
  isNewPhraseBetween,
  MAX_AFTER,
  MAX_BETWEEN,
  NOT_A_TOTAL_BEFORE,
  NOT_A_TOTAL_BETWEEN,
  PRONOUN_ONE_BEFORE,
  SAYING_SPEAKERS,
  SUPPOSING_BEFORE,
  TENS,
  type Token,
  UNITS,
} from "./talkCountGroundingWords";

/**
 * The claim starting at one token, if one does.
 *
 * @returns the claim and the index after it, or `undefined`
 */
function claimAt({
  tokens,
  at,
  text,
}: {
  tokens: readonly Token[];
  at: number;
  text: string;
}): { claim: CountClaim; next: number } | undefined {
  const token = tokens[at];
  if (token.kind !== "digits" && token.kind !== "word") {
    return undefined;
  }
  // `.at(-1)` would wrap to the sentence's last token, so the first token has no previous one.
  const previous = at > 0 ? tokens.at(at - 1) : undefined;
  if (previous?.kind === "word" && NOT_A_TOTAL_BEFORE.has(previous.lower)) {
    return undefined;
  }
  if (token.lower === "one" && previous?.kind === "word" && PRONOUN_ONE_BEFORE.has(previous.lower)) {
    return undefined;
  }
  const number = cardinalAt({ at, text, tokens });
  if (number === undefined) {
    return undefined;
  }
  const first = tokens.at(number.next);
  if (first?.kind === "word" && first.lower === "waiting") {
    const words = text.slice(token.start, first.end);
    const claim: CountClaim = {
      count: number.value,
      end: first.end,
      noun: "card",
      start: token.start,
      subject: "waiting",
      words,
    };
    return { claim, next: number.next + 1 };
  }
  const between: string[] = [];
  for (let index = number.next; index < tokens.length && between.length <= MAX_BETWEEN; index += 1) {
    const each = tokens[index];
    // A second number before the noun ("twenty plus nine cards") leaves the first not the count.
    if (
      each.kind !== "word" ||
      NOT_A_TOTAL_BETWEEN.has(each.lower) ||
      isClauseSubject({ word: each.lower }) ||
      isNewPhraseBetween({ word: each.lower }) ||
      cardinalAt({ at: index, text, tokens }) !== undefined
    ) {
      return undefined;
    }
    const noun = nounOf({ word: each.lower });
    if (noun !== undefined) {
      const after = wordsAfter({ from: index + 1, tokens });
      const last = after.at(-1);
      let end = each.end;
      const subject = subjectOf({ noun, words: [...between, ...after.map((word) => word.lower)] });
      if (last !== undefined && subjectOf({ noun, words: between }) !== subject) {
        end = last.end;
      }
      const claim: CountClaim = {
        count: number.value,
        end,
        noun,
        start: token.start,
        subject,
        words: text.slice(token.start, end),
      };
      return { claim, next: index + 1 };
    }
    between.push(each.lower);
  }
  return undefined;
}

/**
 * Whether the sentence holding the token at `at` is a supposed case: a word of {@link SUPPOSING_BEFORE} anywhere before
 * it in its sentence ("Suppose there are fourteen cards", "Hypothetically, for example, there are fourteen cards"),
 * or "say" with no speaker straight before it ("For example—say fourteen cards"; "I'd say fourteen"
 * reports a figure). Scoped to the sentence, not the clause, so no punctuation inside it hides the supposing word; the
 * trade is that a real total after an "if" clause in the same sentence is not recorded either.
 *
 * @param at the index of the token a claim would start at
 * @returns true when a number in it is an example
 */
function supposing({ tokens, at }: { tokens: readonly Token[]; at: number }): boolean {
  for (let index = at - 1; index >= 0; index -= 1) {
    // Only ". ! ?" end a sentence; ":" and ";" carry the supposition on ("Imagine this: there are fourteen").
    if (endsSentence({ index, tokens })) {
      return false;
    }
    if (supposesAt({ index, tokens })) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the one token at `index` supposes: a word of {@link SUPPOSING_BEFORE}, or "say" with no speaker from
 * {@link SAYING_SPEAKERS} straight before it.
 *
 * @returns true when that token makes a figure after it an example
 */
function supposesAt({ tokens, index }: { tokens: readonly Token[]; index: number }): boolean {
  const word = tokens[index];
  // Every part of a joined word counts: "what-if", "if’s"; and a "say" joined on ("I'd-say") has no
  // speaker separated from it by whitespace alone, so it supposes.
  // Marks stripped too ("İf" lowercases to i plus a dot): this only ever adds a supposing word, never a speaker.
  // "ʼ" (U+02BC) is a letter to Unicode but an apostrophe to a reader ("whatʼif"), so it splits parts too.
  const parts = word.lower
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[-'’ʼ]/u);
  if (SUPPOSING_BEFORE.has(word.lower) || parts.some((part) => SUPPOSING_BEFORE.has(part))) {
    return true;
  }
  if (parts.slice(1).includes("say")) {
    return true;
  }
  // A speaker is matched on its plain lowercase, never folded, so folding can only ever add a supposing word.
  const reported = index > 0 && word.spacedFromPrevious && SAYING_SPEAKERS.has(tokens[index - 1].text.toLowerCase());
  return parts[0] === "say" && !reported;
}

/**
 * The claim starting at one token, said either way round: the number first ({@link claimAt}), else after what it
 * counts ({@link invertedAt}).
 *
 * @returns the claim and the index after it, or `undefined`
 */
export function claimFrom({
  tokens,
  at,
  text,
}: {
  tokens: readonly Token[];
  at: number;
  text: string;
}): { claim: CountClaim; next: number } | undefined {
  if (supposing({ at, tokens })) {
    return undefined;
  }
  const led = claimAt({ at, text, tokens });
  if (led !== undefined) {
    return unsupposed({ at, found: led, tokens });
  }
  const inverted = invertedAt({ at, text, tokens });
  if (inverted === undefined) {
    return undefined;
  }
  return unsupposed({ at, found: inverted, tokens });
}

/**
 * A claim, unless a supposing word sits inside its own words ("Everything hypothetically is twenty-nine").
 *
 * @returns the claim, or `undefined`
 */
function unsupposed({
  at,
  found,
  tokens,
}: {
  at: number;
  found: { claim: CountClaim; next: number };
  tokens: readonly Token[];
}): { claim: CountClaim; next: number } | undefined {
  if (supposedWithin({ from: at, to: found.next, tokens })) {
    return undefined;
  }
  return found;
}

/**
 * Whether a supposing word sits among the claim's own tokens.
 *
 * @returns true when one of `tokens[from..to)` supposes, by {@link supposesAt}
 */
function supposedWithin({ tokens, from, to }: { tokens: readonly Token[]; from: number; to: number }): boolean {
  for (let index = from; index < to; index += 1) {
    if (supposesAt({ index, tokens })) {
      return true;
    }
  }
  return false;
}

/**
 * The claim said the other way round, starting at one token: a plural Queue noun or a figure's name, the words naming
 * it, "is" (or "stands at", "comes to"), then a cardinal that ends the clause — "The count of cards on your Queue is
 * 14". A number running on into more words ("is 14 days old") is not the figure.
 *
 * @returns the claim and the index after it, or `undefined`
 */
function invertedAt({
  tokens,
  at,
  text,
}: {
  tokens: readonly Token[];
  at: number;
  text: string;
}): { claim: CountClaim; next: number } | undefined {
  const token = tokens[at];
  if (token.kind !== "word" || !INVERTED_OPENERS.has(token.lower)) {
    return undefined;
  }
  const previous = at > 0 ? tokens.at(at - 1) : undefined;
  if (previous?.kind === "word" && NOT_A_TOTAL_BEFORE.has(previous.lower)) {
    return undefined;
  }
  const named: string[] = [token.lower];
  let index = at + 1;
  for (; index < tokens.length && named.length <= MAX_AFTER; index += 1) {
    const each = tokens[index];
    if (each.kind !== "word" || CLAUSE_JOINS.has(each.lower) || COPULAS.has(each.lower)) {
      break;
    }
    named.push(each.lower);
  }
  if (tokens.at(index)?.kind !== "word" || !COPULAS.has(tokens[index].lower)) {
    return undefined;
  }
  index += 1;
  while (index < tokens.length && tokens[index].kind === "word" && COPULA_LINKS.has(tokens[index].lower)) {
    index += 1;
  }
  if (index >= tokens.length) {
    return undefined;
  }
  const number = cardinalAt({ at: index, text, tokens });
  if (number === undefined) {
    return undefined;
  }
  const after = tokens.at(number.next);
  const clauseEnds = after?.kind !== "word" || CLAUSE_JOINS.has(after.lower);
  if (!clauseEnds) {
    return undefined;
  }
  // A figure's name ("Queue", "Everything") counts cards, as the selector does.
  let noun: CountClaim["noun"] = "card";
  const counted = nounOf({ word: token.lower });
  if (counted !== undefined) {
    noun = counted;
  }
  const end = tokens[number.next - 1].end;
  let subject = subjectOf({ noun, words: named });
  // "Queue is 29" names the badge by its label, never Everything: only "cards on your Queue" may mean either.
  if (token.lower === "queue" && subject === "queue") {
    subject = "waiting";
  }
  const claim: CountClaim = {
    count: number.value,
    end,
    noun,
    start: token.start,
    subject,
    words: text.slice(token.start, end),
  };
  return { claim, next: number.next };
}

/**
 * The words after a noun that may still name what it counts: up to the clause's end, a comma, or another number.
 *
 * @returns the words, in order
 */
function wordsAfter({ tokens, from }: { tokens: readonly Token[]; from: number }): readonly Token[] {
  const words: Token[] = [];
  for (let index = from; index < tokens.length && words.length < MAX_AFTER; index += 1) {
    const each = tokens[index];
    const number = UNITS[each.lower] !== undefined || TENS[each.lower] !== undefined;
    // A joining word ends the clause, so "twenty-nine cards and Blocking the fleet remains" names no fleet count.
    if (each.kind !== "word" || number || CLAUSE_JOINS.has(each.lower)) {
      break;
    }
    words.push(each);
  }
  return words;
}
