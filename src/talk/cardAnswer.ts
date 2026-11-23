/**
 * Whether words said with a card open may land on it as the owner's answer — pure: the card and the words in, a verdict out.
 *
 * Words that are obviously not an answer must never be treated as one: a greeting such as "Uh, good morning" that
 * landed on an open hand card took the card off the owner's Queue with its paste fields dead, a bug in any reading.
 *
 * Two vetoes, and neither is an answer detector: no text test can tell "yes, send it" — an answer sharing no word with
 * its card — from a stretch about something else. That judgement is the visible voice's (`relay_steer`'s
 * `answers_open_card`, `./cardUtterance.ts`). These are the cases no judgement is needed for:
 *
 * - **A hand step never takes words.** It is a thing only the owner's hands do; it settles when the step is done (`hand done`,
 *   its settle check), never because the owner spoke with it open. The words still reach the board on the relay's own row.
 * - **Nothing but greeting, hesitation or noise** — "Uh, good morning", "Um, but, where was I, um", "[chuckle]" — is
 *   never an answer. Assent words ("okay", "yeah", "right", "sure") are deliberately NOT here: said to the voice's
 *   "shall I send it?", each is one, and only the voice heard the question.
 */
import { CARD_KEY } from "./cardKey.js";
import { CardLandingErrors, type NotAnAnswerError } from "./cardLandingErrors.js";

/** Whether words land on a card, or the one reason they never do. */
export type CardAnswerVerdict =
  | { readonly kind: "land" }
  | { readonly kind: "skip"; readonly reason: "hand-step" | "not-an-answer"; readonly why: string };

/** Sounds that carry no word at all, dropped before the phrases are matched. */
const HESITATIONS: ReadonlySet<string> = new Set([
  "ah",
  "eh",
  "er",
  "erm",
  "hm",
  "hmm",
  "huh",
  "mm",
  "mmm",
  "oh",
  "uh",
  "uhh",
  "uhhh",
  "uhm",
  "um",
  "umm",
  "ummm",
]);

/**
 * Greetings and discourse fillers, each a whole phrase, longest matched first. A phrase is here only when no reading
 * of it answers a card: "good" alone, or "right", could be the owner's yes, and "morning" alone could answer "when should it
 * go?", so none of those is.
 */
const FILLER_PHRASES: readonly (readonly string[])[] = [
  ["good", "morning"],
  ["good", "afternoon"],
  ["good", "evening"],
  ["good", "day"],
  ["gday"],
  ["hello"],
  ["hullo"],
  ["hi"],
  ["hiya"],
  ["hey"],
  ["heya"],
  ["howdy"],
  ["yo"],
  ["hey", "there"],
  ["hi", "there"],
  ["hello", "there"],
  ["how", "are", "you"],
  ["how", "are", "you", "going"],
  ["how", "is", "it", "going"],
  ["hows", "it", "going"],
  ["whats", "up"],
  ["where", "was", "i"],
  ["where", "were", "we"],
  ["let", "me", "see"],
  ["let", "me", "think"],
].toSorted((left, right) => right.length - left.length);

/**
 * Words that join filler to filler and are consumed beside it, never alone: "and" answers "AND or OR?", and "so" can
 * be the owner's whole reply to a card asking whether that is right.
 */
const CONNECTIVES: ReadonlySet<string> = new Set(["and", "anyway", "anyways", "but", "so", "well"]);

/**
 * The owner's words as comparable tokens: bracketed noise the recogniser writes (`[chuckle]`, and the unclosed `[chuckle`
 * it also writes) dropped, case folded, every run of non-letters a break, hesitations dropped.
 *
 * @param words the owner's words as transcribed
 * @returns the words left, in order
 */
function spokenTokens({ words }: { words: string }): readonly string[] {
  return words
    .replace(/\[[^\]]*\]?/gu, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "" && !HESITATIONS.has(token));
}

/**
 * Whether words are nothing but greeting, hesitation or noise: every token left is consumed by a filler phrase or a
 * connective, and a connective alone is not enough — at least one filler phrase, or no word at all.
 *
 * @param words the owner's words as transcribed
 * @returns `true` only when no word of substance is left
 */
export function isOnlyFiller({ words }: { words: string }): boolean {
  const tokens = spokenTokens({ words });
  let at = 0;
  let phrases = 0;
  while (at < tokens.length) {
    if (CONNECTIVES.has(tokens[at]!)) {
      at += 1;
      continue;
    }
    const phrase = FILLER_PHRASES.find((candidate) =>
      candidate.every((token, offset) => tokens[at + offset] === token),
    );
    if (phrase === undefined) {
      return false;
    }
    at += phrase.length;
    phrases += 1;
  }
  return tokens.length === 0 || phrases > 0;
}

/**
 * Whether words said with a card open may land on it as the owner's answer. A `land` verdict is permission, never a finding
 * that they answer it: that is the voice's judgement, made before this is asked.
 *
 * @param cardKey the card the words were said over
 * @param words the owner's words
 * @returns `land`, or which veto holds them off the card and the sentence saying so
 */
export function cardAnswerVerdict({ cardKey, words }: { cardKey: string; words: string }): CardAnswerVerdict {
  if (CARD_KEY.test(cardKey) && cardKey.startsWith("hand:")) {
    return {
      kind: "skip",
      reason: "hand-step",
      why: `${cardKey} is a step only the owner's hands take: it settles when the step is done, never on words said with it open`,
    };
  }
  if (isOnlyFiller({ words })) {
    return {
      kind: "skip",
      reason: "not-an-answer",
      why: `"${words.trim().slice(0, 80)}" is a greeting or filler, never an answer to ${cardKey}`,
    };
  }
  return { kind: "land" };
}

/**
 * The refusal every landing path returns for words {@link cardAnswerVerdict} holds off the card.
 *
 * @param cardKey the card the words were said over
 * @param words the owner's words
 * @returns the `NOT_AN_ANSWER` error, or `undefined` when the words may land
 */
export function cardAnswerRefusal({
  cardKey,
  words,
}: {
  cardKey: string;
  words: string;
}): NotAnAnswerError | undefined {
  const verdict = cardAnswerVerdict({ cardKey, words });
  if (verdict.kind === "land") {
    return undefined;
  }
  return CardLandingErrors.notAnAnswer({ cardKey, reason: verdict.reason, why: verdict.why });
}
