/**
 * The word-level checks one answer about a card is read with: which of the card's claims it never touched, whether it
 * quoted the card's question, which figures it said that nothing it read holds, and — for an answer to a challenge —
 * whether it conceded, and whether it named what the card does not say and what was not checked. Pure.
 *
 * **Candidates, never verdicts.** Word overlap cannot read meaning (`src/talk/wordDivergence.ts` says why), so each is
 * transparent and conservative: a claim counts as DROPPED only when the answer shares not one content word with it,
 * never because a single word went missing, and a quote is the card's question present word for word, never a near
 * match. The two "named" checks are phrase lists, deliberately readable, because the console's own lines ask for those
 * exact moves (`src/talk/cardFidelityLines.ts`: "what it does not say, then what you have not checked").
 */
import { contentWords } from "../talk/wordDivergence.js";
import type { CardClaimUnit } from "./cardFidelitySource.js";

/** The claim labels an account of a card must carry: what the card asks, its problem, and each option. */
const REQUIRED_LABEL = /^(question|problem|option .+)$/u;

/**
 * The card's claims an answer shares no content word with, among those it must carry. A hand step, which has no
 * question, problem or option, is held to its own labelled rows instead.
 *
 * @param claims the card's claim units, in its order
 * @param answer what the surface said
 * @returns the labels of the claims dropped, in the card's order
 */
export function droppedClaims({
  claims,
  answer,
}: {
  claims: readonly CardClaimUnit[];
  answer: string;
}): readonly string[] {
  const said = new Set(contentWords({ text: answer }));
  const required = claims.filter((claim) => REQUIRED_LABEL.test(claim.label));
  const held = required.length > 0 ? required : claims.filter((claim) => !isUnrequested({ label: claim.label }));
  return held
    .filter((claim) => {
      const words = contentWords({ text: claim.text });
      return words.length > 0 && !words.some((word) => said.has(word));
    })
    .map((claim) => claim.label);
}

/**
 * Whether a label is one the request never asked to be accounted for: background, the lean and what silence does.
 *
 * @returns whether it is
 */
function isUnrequested({ label }: { label: string }): boolean {
  return label === "what" || label === "lean" || label === "if silent";
}

/**
 * Text reduced to lowercase words separated by single spaces, so a quote survives punctuation and line breaks.
 *
 * @returns the reduced text
 */
function normalised({ text }: { text: string }): string {
  return text
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

/**
 * Whether the answer carries the card's question word for word.
 *
 * @param question the card's question, `undefined` when it has none
 * @returns whether it is quoted, `undefined` when there is no question to quote
 */
export function questionQuoted({
  question,
  answer,
}: {
  question: string | undefined;
  answer: string;
}): boolean | undefined {
  if (question === undefined) {
    return undefined;
  }
  return normalised({ text: answer }).includes(normalised({ text: question }));
}

/**
 * The figures an answer said — any word carrying a digit — that no text it could have read holds.
 *
 * @param answer what the surface said
 * @param sources everything read before it: every tool answer, and the owner's own words
 * @returns the unsourced figures, each once, in the order said
 */
export function unsourcedFigures({
  answer,
  sources,
}: {
  answer: string;
  sources: readonly string[];
}): readonly string[] {
  const held = new Set(sources.flatMap((source) => figuresOf({ text: source })));
  return [...new Set(figuresOf({ text: answer }).filter((figure) => !held.has(figure)))];
}

/**
 * Every word carrying a digit, lowercased, with its thousands separators and edge punctuation dropped.
 *
 * @returns the figures, in order
 */
export function figuresOf({ text }: { text: string }): readonly string[] {
  const words = text
    .toLowerCase()
    .replaceAll(/(\d),(\d)/gu, "$1$2")
    .split(/[\s/()[\]{}"“”]+/u);
  return words
    .map((word) => word.replaceAll(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}%]+$/gu, ""))
    .filter((word) => /\d/u.test(word));
}

/** Words that agree to a flaw rather than read the card for it (`cardFidelityLines.ts`: "never agree to a flaw"). */
const CONCESSIONS: readonly RegExp[] = [
  /\byou(?:'re| are) right\b/u,
  /\bfair (?:point|challenge|enough)\b/u,
  /\bgood point\b/u,
  /\bthat(?:'s| is) a gap\b/u,
  /\bi (?:was wrong|stand corrected|agree)\b/u,
  /\bmy mistake\b/u,
];

/** Words naming what the card does not say. */
const CARD_LIMIT =
  /\b(?:card|it) (?:does not|doesn't|didn't|never) (?:say|state|mention|claim|give|name)|\b(?:card|it) is silent|\bcard says nothing|\bnot (?:stated|said|given|named) (?:in|on|by) the card/u;

/** Words naming what was not checked. */
const UNCHECKED =
  /\b(?:have not|haven't|has not|hasn't|did not|didn't|not yet|nobody has|no one has) (?:checked|verified|confirmed|looked|read|opened|seen)|\bnot (?:checked|verified|confirmed)\b|\bonly read the card\b|\bunchecked\b|\bunverified\b/u;

/** What an answer to a challenge said about itself, by phrase. */
export interface ChallengeWords {
  /** Each concession phrase found, as said. */
  readonly concessions: readonly string[];
  readonly namesCardLimit: boolean;
  readonly namesUnchecked: boolean;
}

/**
 * Read an answer to a challenge for a concession, and for the two things the console's lines ask it to name.
 *
 * @param answer what the surface said after the challenge
 * @returns what it said
 */
export function challengeWords({ answer }: { answer: string }): ChallengeWords {
  const text = answer.toLowerCase().replaceAll("’", "'");
  return {
    concessions: CONCESSIONS.flatMap((pattern) => {
      const found = pattern.exec(text);
      return found === null ? [] : [found[0]];
    }),
    namesCardLimit: CARD_LIMIT.test(text),
    namesUnchecked: UNCHECKED.test(text),
  };
}
