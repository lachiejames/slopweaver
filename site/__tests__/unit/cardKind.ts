/**
 * Narrow a queue card to the kind a test built, throwing rather than casting — the `unwrap` of a `QueueCard`, so an
 * assertion on a briefing field reads that field and a card of the other kind fails the test by name.
 */
import type { BriefingCard, QueueCard, StepCard } from "../../lib/queueCard";

/**
 * The card as the fleet briefing.
 *
 * @param card a card the test expects to be a briefing
 * @returns the same card, narrowed
 */
export function briefingOf({ card }: { card: QueueCard }): BriefingCard {
  if (card.kind !== "briefing") {
    throw new Error(`expected a briefing card, got a ${card.kind} card: ${card.question}`);
  }
  return card;
}

/**
 * The card as a hand step's own record.
 *
 * @param card a card the test expects to be a step card
 * @returns the same card, narrowed
 */
export function stepOf({ card }: { card: QueueCard }): StepCard {
  if (card.kind !== "step") {
    throw new Error(`expected a step card, got a ${card.kind} card: ${card.question}`);
  }
  return card;
}
