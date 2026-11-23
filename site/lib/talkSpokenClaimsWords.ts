/**
 * The word sets, act forms and tokenizer the spoken-claim readers walk a sentence with. Split out of
 * `./talkSpokenClaims.ts`.
 */

import { maskQuotes } from "./spokenQuotes";
import { OUTCOME_ACTS, type OutcomeAct } from "./talkSpokenClaimsTypes";

/** One token of a sentence, with where it stands in the text. */
export interface Token {
  readonly kind: "word" | "digits" | "stop";
  readonly lower: string;
  readonly start: number;
  readonly end: number;
}

/** Words that, earlier in the same sentence, make a past form anything but a claim that it happened. */
export const NOT_DONE_BEFORE = new Set([
  "not",
  "never",
  "no",
  "nothing",
  "nor",
  "without",
  "unless",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "when",
  "once",
  "if",
  "until",
  "before",
  "after",
  "whether",
  "want",
  "wants",
  "ready",
  "about",
  "going",
  "gonna",
  "try",
  "tried",
  "trying",
  "pending",
  "waiting",
  "being",
  "get",
  "gets",
  "getting",
]);

/** A word directly before a past form that makes it an adjective: "your sent folder", "the approved draft". */
const DETERMINERS = new Set(["the", "a", "an", "your", "her", "my", "our", "their", "its"]);

/**
 * The masculine possessive, a determiner exactly as "her" is. Kept as a pattern rather than in the list: the
 * owner-pronoun gate (`src/devLint/ownerPronouns.ts`) reads a regular-expression literal as a recogniser of speech, never
 * as prose about the owner.
 */
const PERSON_DETERMINER = /^his$/u;

/**
 * Whether a word is a determiner, so a past form directly after it is an adjective: "your sent folder", "her
 * approved draft".
 *
 * @param word one lowercase token
 * @returns true for a determiner, a spoken possessive pronoun included
 */
export function isDeterminer({ word }: { word: string }): boolean {
  return DETERMINERS.has(word) || PERSON_DETERMINER.test(word);
}

/** Subjects that make an act the owner's, never the console's: "you posted the review" recaps what the owner did. */
export const OWNER_SUBJECTS = new Set(["you", "you've", "you'd"]);

/** Words between a subject and its verb: "you've already sent", "you just approved". */
export const BETWEEN_SUBJECT = new Set([
  "have",
  "has",
  "had",
  "already",
  "just",
  "also",
  "then",
  "finally",
  "actually",
]);

/** Words before a past form in its sentence that make it something read off a record: "the card says Ada approved". */
export const REPORTING = new Set([
  "says",
  "said",
  "shows",
  "showed",
  "records",
  "recorded",
  "reports",
  "reported",
  "noting",
]);

/**
 * Words in its clause that place a past form in history: "posted two hours ago", "merged yesterday", "sent on Monday".
 * "May" and "March" are left out, each an ordinary word as often as a month.
 */
export const HISTORY = new Set([
  "yesterday",
  "ago",
  "last",
  "overnight",
  "earlier",
  "previously",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/** Subjects that make an act somebody else's: "noting who already approved", "someone approved them". */
const OTHER_SUBJECTS = new Set(["who", "she", "they", "someone", "somebody"]);

/** The masculine subject pronoun, somebody else exactly as "she" is; a pattern for the reason {@link PERSON_DETERMINER} is. */
const PERSON_SUBJECT = /^he$/u;

/**
 * Whether a word, as an act's subject, makes the act somebody else's.
 *
 * @param word one lowercase token
 * @returns true for "who", a third-person pronoun, "someone" or "somebody"
 */
export function isOtherSubject({ word }: { word: string }): boolean {
  return OTHER_SUBJECTS.has(word) || PERSON_SUBJECT.test(word);
}

/** Acts one grounds the other of: a Slack message the thinking model says was posted is one the voice says was sent. */
export const SAME_ACT: Readonly<Partial<Record<OutcomeAct, OutcomeAct>>> = { posted: "sent", sent: "posted" };

/**
 * Each act's forms, one word or two. The past form alone can say it was done; any form can say it is still to happen.
 */
const ACT_FORMS: Readonly<Record<OutcomeAct, readonly string[]>> = {
  approved: ["approve", "approves", "approving", "approved"],
  landed: ["land", "lands", "landing", "landed"],
  merged: ["merge", "merges", "merging", "merged"],
  posted: ["post", "posts", "posting", "posted"],
  released: ["release", "releases", "releasing", "released"],
  sent: ["send", "sends", "sending", "sent"],
  "went up": ["go up", "goes up", "going up", "went up"],
};

/**
 * The act a form at `at` names, one word or two ("went up"), and the form as matched.
 *
 * @param tokens the sentence's tokens
 * @param at the index of the form's first word
 * @returns the act and its form, or `undefined` when no act's form starts there
 */
export function actFormAt({
  tokens,
  at,
}: {
  tokens: readonly Token[];
  at: number;
}): { act: OutcomeAct; form: string } | undefined {
  const next = itemAt({ at: at + 1, items: tokens });
  const word = tokens[at].lower;
  const pair = next === undefined ? undefined : `${word} ${next.lower}`;
  for (const act of OUTCOME_ACTS) {
    const form = ACT_FORMS[act].find((each) => each === word || each === pair);
    if (form !== undefined) {
      return { act, form };
    }
  }
  return undefined;
}

/** How many words back an infinitive's "to" reaches: "to be sent", "to get it posted". */
export const TO_REACH = 3;

const TOKEN = /#\d+|\d+(?:,\d{3})*(?!\d)|[A-Za-z]+(?:[-'’][A-Za-z]+)*|[.!?;,]/gu;

/**
 * The item at an index, or `undefined` past either end — never `.at()`, which reads -1 as the last item.
 *
 * @returns the item, or `undefined` when the index is out of range
 */
export function itemAt<T>({ items, at }: { items: readonly T[]; at: number }): T | undefined {
  return at >= 0 && at < items.length ? items[at] : undefined;
}

/** One sentence: its tokens outside quotation marks, whether it asks, and its words as said. */
interface Sentence {
  readonly tokens: readonly Token[];
  readonly question: boolean;
  readonly words: string;
}

/**
 * The text's sentences, read with every quotation blanked ({@link maskQuotes}).
 *
 * @returns the sentences that hold a token, in order
 */
export function sentencesOf({ text }: { text: string }): readonly Sentence[] {
  const sentences: Sentence[] = [];
  let tokens: Token[] = [];
  const close = ({ end, question }: { end: number; question: boolean }): void => {
    if (tokens.length > 0) {
      sentences.push({ question, tokens, words: text.slice(tokens[0].start, end) });
    }
    tokens = [];
  };
  for (const match of maskQuotes({ text }).matchAll(TOKEN)) {
    const raw = match[0];
    const start = match.index;
    if (/^[.!?;]$/u.test(raw)) {
      close({ end: start + 1, question: raw === "?" });
    } else {
      let kind: Token["kind"] = "digits";
      if (raw === ",") {
        // A comma ends a spoken number ("PR twenty, one of three") but not the sentence.
        kind = "stop";
      } else if (/^[A-Za-z]/u.test(raw)) {
        kind = "word";
      }
      tokens.push({ end: start + raw.length, kind, lower: raw.toLowerCase().replaceAll("’", "'"), start });
    }
  }
  const last = tokens.at(-1);
  if (last !== undefined) {
    close({ end: last.end, question: false });
  }
  return sentences;
}
