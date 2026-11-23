/**
 * A question the voice says to the owner a second time, after the owner has spoken to it, that no answer the thinking
 * model wrote since asks again. The page feeds {@link foldRepeatedAsks} what the call says in order — the owner's FINAL
 * sentences, the thinking model's completed messages and the voice's FINAL sentences, a voice sentence with the card
 * open as it was said — and a repeat is posted on the claim-grounding route as a closed shape
 * (`./talkSpokenClaims.ts`), which keeps it as the call's provenance for the thinking model. Nothing is said aloud
 * about it.
 *
 * Measured on one call: the voice said the thinking model's question "For those documents, upload now, get owners'
 * review first, or wait for live checks?"; the owner answered that none of the above was their answer; the thinking
 * model wrote "The briefing comes first; your decision follows after you've read it." and no question; and 32s later
 * the voice said that answer and then "Upload now, get owners' review first, or wait for live checks?", asking the
 * owner the same thing again. The voice prompt already told it never to add a question to a handed-back answer
 * (`src/talk/handedBackAnswerLines.ts`); it did anyway.
 *
 * Narrow on purpose: a wrong entry is worse than a missed one. The earlier ask must be one the voice SAID over
 * the same card — a question only written, which the voice never got to, the owner has not heard — every content word
 * of the shorter of the two in the longer, and the owner must have spoken since. That proves they heard it and spoke,
 * never that their words answered it, so the kept entry claims only the first. A repeat after the thinking model wrote
 * any question of its own since that ask is never flagged, since the voice may say the model's question in its earlier
 * words (a paraphrase can share six of eight words); nor is one of the voice's own between hand-offs (the walk's),
 * one inside quotation marks, or one too short to compare ("Next card?").
 *
 * MEASURED over every call file (243 calls, 10,022 FINAL voice sentences), fed in file order: TWO owed, both real.
 * Each narrowing was a false hit before it — 163 owed when an unspoken written question counted as asked and the
 * voice's own questions were read too, 16 with the hand-off rule, 1 once a message's own question grounded a longer
 * voiced one. Repro with `SLOPWEAVER_HOME` exported, printing `owed=2` and the two calls: `yarn tsx -e 'import
 * {readdirSync as d, readFileSync as r}
 * from "node:fs"; import {foldRepeatedAsks as f, NO_REPEATED_ASKS as z} from "./site/lib/talkRepeatedAsk"; const h =
 * process.env.SLOPWEAVER_HOME + "/talk/calls/"; let n = 0; for (const c of d(h)) { let s = z; for (const l of r(h + c,
 * "utf8").split("\n")) { let e; try { e = JSON.parse(l) } catch { continue } const t = e.kind === "segment" && e.final
 * ? {card: e.open, id: e.id, kind: e.who === "owner" ? "heard" : "said", text: e.text} : e.kind === "wrote" && e.text ?
 * {id: e.itemId, kind: "wrote", text: e.text} : undefined; if (!t) continue; const o = f({input: t, state: s}); s =
 * o.state; for (const w of o.owed) { n++; console.log(c, e.atIso, w.words) } } } console.log("owed=" + n)'`. A written
 * synthetic trace in the failure's shape — its timing and every word the fold reads kept, every other word invented — replays
 * whole in `site/__tests__/unit/talkRepeatedAsk.test.ts`.
 */
import { isNumberWord, spokenNumberOf } from "./spokenNumbers";
import { maskQuotes } from "./spokenQuotes";
import type { SpokenClaim } from "./talkSpokenClaims";

/**
 * What the fold is fed, in order: a voice sentence with the key of the card open as it was said (`undefined` over
 * none), one of the owner's, or a completed message. An id is the segment's speech id or the message's item id, so a repeated
 * one is read once.
 */
export type RepeatedAskInput =
  | { readonly kind: "said"; readonly id: string; readonly text: string; readonly card: string | undefined }
  | { readonly kind: "heard" | "wrote"; readonly id: string; readonly text: string };

/** A question the voice put to the owner: its distinct content words, its card, where it stood, and whether they spoke since. */
interface Asked {
  readonly words: readonly string[];
  readonly card: string | undefined;
  readonly at: number;
  readonly spokenSince: boolean;
}

/**
 * A completed message of the thinking model's: its distinct content words, those run together, whether it asks a
 * question of its own, and where it stood.
 */
interface Written {
  readonly words: readonly string[];
  readonly compact: string;
  readonly asks: boolean;
  readonly at: number;
}

/**
 * The fold's state: every input already read, how many have been, the questions the voice put to the owner, the
 * thinking model's messages, and whether one has completed since the owner last spoke — so the voice is saying a
 * hand-off.
 */
export interface RepeatedAskState {
  readonly checked: readonly string[];
  readonly read: number;
  readonly asked: readonly Asked[];
  readonly written: readonly Written[];
  readonly answering: boolean;
}

/** The state of a call that has said nothing yet. */
export const NO_REPEATED_ASKS: RepeatedAskState = { answering: false, asked: [], checked: [], read: 0, written: [] };

/** A repeat owed a grounding: the question sentence as the voice said it again, and where it starts. */
export type RepeatedAsk = Extract<SpokenClaim, { kind: "repeated-ask" }>;

/** Words that carry no subject of a question, dropped before two are compared. */
const GLUE = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "it's",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "so",
  "that",
  "the",
  "them",
  "then",
  "these",
  "this",
  "those",
  "to",
  "want",
  "we",
  "what",
  "which",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** The fewest distinct content words a question must carry to be compared at all: "what do you think?" carries one. */
const MIN_WORDS = 3;

/**
 * Any question mark a written message can end a question with — ASCII, fullwidth, Arabic and Greek — since one the
 * thinking model asked only stops a repeat being flagged, so a wider set can only cost a missed entry.
 * Residue: a mark outside this set (Armenian U+055E, Ethiopic U+1367) in an answer worded too far from the voice's
 * question — another language, say — leaves that ask unseen, and the repeat after it is recorded wrongly. The cost is
 * one false provenance entry, never anything spoken, and the console runs in English. Matching every script's mark,
 * or a translation, is what would close it.
 */
const WRITTEN_QUESTION_MARK = /[?;؟？]/u;

/**
 * How much of a voiced question's content words a later message must carry to have asked it: below a whole share,
 * because the voice says a message in its own words. The copy-tray case above is why it is not the match bar.
 */
const CARRIED_SHARE = 0.8;

/** One word, an apostrophe inside it kept: "it's" is one word, never "it" and a stray "s". */
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu;

/** What may sit between two words of one spoken number: spaces, or the hyphen in "twenty-one". */
const NUMBER_JOIN = /^[\s-]*$/u;

/**
 * A text's words in order, each run of number words joined only by spaces or hyphens read as its digits, so the
 * voice's "eight documents" and the thinking model's "8 documents" are one word. A run that says no
 * single number keeps its words, and punctuation ends a run, so "one, two or three" stays three numbers.
 *
 * @param text lowercased, apostrophes straightened
 * @returns the words
 */
function numbersFolded({ text }: { text: string }): readonly string[] {
  const words: string[] = [];
  let run: string[] = [];
  let end = 0;
  const close = (): void => {
    let last = run.length;
    while (last > 0 && run[last - 1] === "and") {
      last -= 1;
    }
    const value = spokenNumberOf({ words: run.slice(0, last) });
    words.push(...(value === undefined ? run.slice(0, last) : [String(value)]), ...run.slice(last));
    run = [];
  };
  for (const match of text.matchAll(WORD)) {
    const [word] = match;
    const joins = run.length > 0 && NUMBER_JOIN.test(text.slice(end, match.index)) && isNumberWord({ word });
    if (!joins && run.length > 0) {
      close();
    }
    if (joins || (word !== "and" && isNumberWord({ word }))) {
      run.push(word);
    } else {
      words.push(word);
    }
    end = match.index + word.length;
  }
  if (run.length > 0) {
    close();
  }
  return words;
}

/**
 * A text's content words in order, repeats kept, lowercased, curly apostrophes read as straight ones, a spoken number
 * as its digits, glue words dropped.
 *
 * @returns the words
 */
function wordsOf({ text }: { text: string }): readonly string[] {
  return numbersFolded({ text: text.toLowerCase().replaceAll("’", "'") }).filter((word) => !GLUE.has(word));
}

/**
 * A text's distinct content words in order of first use.
 *
 * @returns the words
 */
function contentWords({ text }: { text: string }): readonly string[] {
  return [...new Set(wordsOf({ text }))];
}

/**
 * A text's content words run together, so a spelling split differently — "real-time pre-checks" said, "realtime
 * prechecks" written — reads the same.
 *
 * @returns the letters
 */
function compactOf({ text }: { text: string }): string {
  return wordsOf({ text }).join("");
}

/**
 * One question sentence: its distinct content words, those run together, the sentence as said, and where it starts in
 * the text.
 */
interface Question {
  readonly words: readonly string[];
  readonly compact: string;
  readonly sentence: string;
  readonly start: number;
}

/**
 * The question sentences of a text, quotations blanked before they are read, so a question quoted by name is none.
 *
 * @returns one entry per question sentence carrying at least {@link MIN_WORDS} content words, in order
 */
export function questionsOf({ text }: { text: string }): readonly Question[] {
  return [...maskQuotes({ text }).matchAll(/[^.!?\n]+[.!?]*/gu)]
    .filter((match) => match[0].trim().endsWith("?"))
    .map((match) => ({
      compact: compactOf({ text: match[0] }),
      sentence: text.slice(match.index, match.index + match[0].length).trim(),
      start: match.index,
      words: contentWords({ text: match[0] }),
    }))
    .filter((question) => question.words.length >= MIN_WORDS);
}

/**
 * The share of a question's content words that another set of words carries.
 *
 * @param question the distinct content words measured
 * @param within the words they are looked for in
 * @returns from 0 to 1
 */
function shareOf({ question, within }: { question: readonly string[]; within: readonly string[] }): number {
  const there = new Set(within);
  return question.filter((word) => there.has(word)).length / question.length;
}

/**
 * Whether two questions' words ask one thing at a bar: that share of the shorter's content words in the longer.
 *
 * @param bar the share required, from 0 to 1
 * @returns true when they ask the same thing
 */
function sameWords({ one, other, bar }: { one: readonly string[]; other: readonly string[]; bar: number }): boolean {
  const [shorter, longer] = one.length <= other.length ? [one, other] : [other, one];
  return shareOf({ question: shorter, within: longer }) >= bar;
}

/**
 * Whether a message could be where the voice's question came from: it asks any question of its own — the voice may say
 * the thinking model's question in the words it used before, and a paraphrase sharing six of eight words is still the
 * model's ask — its words carry nearly all of it, as when the voice runs two of the message's
 * sentences into one question, or its words run together hold the question's, spelled apart differently.
 *
 * @returns true when the message carries the question
 */
function carries({ message, question }: { message: Written; question: Question }): boolean {
  return (
    message.asks ||
    shareOf({ question: question.words, within: message.words }) >= CARRIED_SHARE ||
    message.compact.includes(question.compact)
  );
}

/**
 * The repeat a voice sentence's questions owe, if any: one said while it voices a hand-off, matching an earlier ask
 * over the same card the owner has spoken since, and carried by no message the thinking model completed after that ask.
 *
 * @param put the sentence's questions
 * @param card the card open as it was said
 * @returns the first repeat owed, or `undefined`
 */
function repeatIn({
  state,
  put,
  card,
}: {
  state: RepeatedAskState;
  put: readonly Question[];
  card: string | undefined;
}): Question | undefined {
  if (!state.answering) {
    return undefined;
  }
  return put.find((one) =>
    state.asked.some(
      (earlier) =>
        earlier.spokenSince &&
        earlier.card === card &&
        sameWords({ bar: 1, one: one.words, other: earlier.words }) &&
        !state.written.some((message) => message.at > earlier.at && carries({ message, question: one })),
    ),
  );
}

/**
 * Fold one thing the call said. The owner's words mark every ask spoken to and end the hand-off; a completed message is kept
 * and starts one; a voice sentence's questions are checked by {@link repeatIn} and then kept as asks. At most one
 * repeat is owed per sentence.
 *
 * @returns the next state and the repeats owed a grounding
 */
export function foldRepeatedAsks({ state, input }: { state: RepeatedAskState; input: RepeatedAskInput }): {
  state: RepeatedAskState;
  owed: readonly RepeatedAsk[];
} {
  const key = `${input.kind}:${input.id}`;
  if (state.checked.includes(key)) {
    return { owed: [], state };
  }
  const at = state.read;
  const next = { ...state, checked: [...state.checked, key], read: at + 1 };
  switch (input.kind) {
    case "heard": {
      const asked = state.asked.map((each) => ({ ...each, spokenSince: true }));
      return { owed: [], state: { ...next, answering: false, asked } };
    }
    case "wrote": {
      const { text } = input;
      // Any question outside quotation marks, however short: "Ready?" asks the owner something too.
      const asks = WRITTEN_QUESTION_MARK.test(maskQuotes({ text }));
      const written = [...state.written, { asks, at, compact: compactOf({ text }), words: contentWords({ text }) }];
      return { owed: [], state: { ...next, answering: true, written } };
    }
    case "said": {
      const put = questionsOf({ text: input.text });
      const repeat = repeatIn({ card: input.card, put, state });
      const owed: readonly RepeatedAsk[] =
        repeat === undefined ? [] : [{ kind: "repeated-ask", start: repeat.start, words: repeat.sentence }];
      const asked = [...state.asked, ...put.map(({ words }) => ({ at, card: input.card, spokenSince: false, words }))];
      return { owed, state: { ...next, asked } };
    }
    default: {
      const never: never = input;
      return never;
    }
  }
}
