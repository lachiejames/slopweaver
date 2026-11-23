/**
 * Which of a queue card's texts are drawn and which carry its citations — split out of `./inlineCitations.ts`.
 */

import { stepCardTexts } from "./handCardTexts";
import type { QueueCard } from "./queueCard";

/**
 * Every sentence a card draws above its fold, in the order the card draws them — what {@link notInline} reads to
 * decide which of the row's pull requests the card already links.
 *
 * @param card the derived card
 * @returns its heading, what, problem, stakes, options, lean and if-silent, each as written — or a step card's
 *   heading, rows and its ask's own fields
 */
export function drawnTexts({ card }: { card: QueueCard }): readonly string[] {
  if (card.kind === "step") {
    return stepCardTexts({ card });
  }
  const stakes: string[] = [];
  if (card.stakes?.kind === "stated") {
    stakes.push(card.stakes.risk, card.stakes.blastRadius, card.stakes.stillReal);
  }
  if (card.stakes?.kind === "pull-request") {
    stakes.push(card.stakes.risk, card.stakes.blastRadius, card.stakes.status);
  }
  const options = card.options.flatMap((option) => {
    if (option.tradeoff === undefined) {
      return [option.sentence];
    }
    return [option.sentence, option.tradeoff];
  });
  const drawn = [card.question, card.what?.aboveFold, card.problem, ...stakes, ...options, card.lean, card.ifSilent];
  return drawn.filter((text): text is string => text !== undefined);
}

/**
 * Every sentence a card draws, its subject included — what the drawer's citation finding reads, so a reference the
 * head's subtitle names is held to the same bar as one the body names.
 *
 * @param card the derived card
 * @returns the sentences above the fold, then the subject
 */
export function citationTexts({ card }: { card: QueueCard }): readonly string[] {
  return [...drawnTexts({ card }), card.subject];
}
