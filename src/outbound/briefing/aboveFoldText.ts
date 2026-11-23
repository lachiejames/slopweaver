/**
 * WHAT A CARD PUTS ABOVE THE FOLD, read three ways — as a word count, as the composer's own prose, and as
 * everything a reader meets without clicking.
 *
 * Its own module because the three differ only in what they INCLUDE, and each difference is a ruling rather
 * than an implementation detail: the subject line counts against the budget and against readability, and
 * never against the fleet's vocabulary rule, because a colleague's branch name is not the fleet's prose.
 * Stated once here, the three sit next to each other where the difference is visible; `./schema.ts` reads
 * them back as refinements.
 */

import { wordCount } from "../../briefing/text.js";
import type { BriefingCard } from "./types.js";
import { textOfContent } from "./vocabulary.js";

/**
 * Every word one card puts above the fold: the question, the five cells and the option bodies.
 *
 * The backstop the six per-field caps cannot see between them — six fields each just inside its own cap
 * still exceeds this, which is the case the whole-card budget exists for.
 *
 * @param card the card to measure
 * @returns the word count a reader cannot avoid
 */
export function cardAboveFoldWords({ card }: { card: BriefingCard }): number {
  const cells = [card.what, card.whyYou, card.lean, card.ifSilent].map((content) => textOfContent({ content }));
  const options = card.options.map((option) => option.text);
  // The subject line counts, even though no voice rule reads it — the reader's own `checkCardBudget` measures
  // the whole card's above-fold text, so a budget that skipped it would be the two halves disagreeing.
  const subject = card.subject === undefined ? [] : [card.subject.text];
  // A waiting card's wait line renders above the fold, under the question, so its words are words the owner cannot
  // avoid reading — the same reason the subject line counts. BOTH halves count, because the reader's own
  // `checkCardBudget` measures the whole card's above-fold text and a form admitting what the gate refuses is
  // the two halves disagreeing, which is the one failure this pair cannot afford.
  const waitingOn = card.readiness.state === "waiting" ? [card.readiness.session, card.readiness.event] : [];
  return wordCount({ text: [card.question, ...subject, ...cells, ...options, ...waitingOn].join(" ") });
}

/**
 * Every AUTHORED word a card puts above the fold, for a rule that reads the composer's own framing.
 *
 * Deliberately not {@link cardAboveFoldWords}'s input: the subject line is the SUBJECT's own title — a pull
 * request's, a page's — and a rule about the fleet's vocabulary has no business refusing a card because
 * somebody else named their branch `settled-ask-row`. The same call `./schema.ts` already makes about the
 * voice pass, for the same reason.
 *
 * @param card the card to read
 * @returns the composer's above-the-fold prose, joined
 */
export function cardAboveFoldProse({ card }: { card: BriefingCard }): string {
  const cells = [card.what, card.whyYou, card.lean, card.ifSilent].map((content) => textOfContent({ content }));
  return [card.question, ...cells, ...card.options.map((option) => option.text)].join(" ");
}

/**
 * Everything a reader meets WITHOUT clicking anything — {@link cardAboveFoldProse} plus the subject line.
 *
 * Deliberately not the same input as {@link cardAboveFoldProse}, and the difference is the question being
 * asked. That one reads the COMPOSER's own framing, so a rule about the fleet's vocabulary never refuses a
 * card because somebody else named their pull request badly. This one asks whether a string is READABLE
 * without opening the fold, and the subject line is read — the same membership {@link cardAboveFoldWords}
 * charges against the budget, for the same reason.
 *
 * @param card the card to read
 * @returns every above-the-fold string, joined
 */
export function cardAboveFoldReadable({ card }: { card: BriefingCard }): string {
  const subject = card.subject === undefined ? [] : [card.subject.text];
  return [cardAboveFoldProse({ card }), ...subject].join(" ");
}
