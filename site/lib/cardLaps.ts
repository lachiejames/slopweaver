/**
 * What a Queue card says about how many looks it took the owner — pure, over `talk laps --json`.
 *
 * Done is opening a card and having no notes to give, the first time. So a card the owner steered says how many laps
 * it has taken and whose each was. Nothing about laps is drawn under the list: the page ends at its last card.
 *
 * Three things it never claims, each because no record holds it: that a card was APPROVED (it left the Queue; the
 * owner's yes and no look the same here), that a world lap means the world moved (it means the owner was away three
 * days or more), and that a card the owner never spoke on was a first-try pass (no look of theirs is recorded on it). How each figure is
 * derived: `docs/console/queue-card-laps.md`.
 */

import type { CardLapsReading, ServerCardLaps } from "../components/live/readCardLaps";

/**
 * The reading for one Queue card: the one whose lineage carries the card's key, so a re-cut hand step reads its
 * predecessor's laps.
 *
 * @param reading the verb's reading
 * @param key the Queue row's key
 * @returns the card's laps, or `undefined` when no word of the owner's in the window names it
 */
export function cardLapsFor({ reading, key }: { reading: CardLapsReading; key: string }): ServerCardLaps | undefined {
  return reading.cards.find((card) => card.keys.includes(key));
}

/**
 * The line a steered card carries under its question.
 *
 * @param card the card's laps
 * @returns the line, or `undefined` for a card the owner has looked at once — that is the state every card should be in
 */
export function lapsLine({ card }: { card: ServerCardLaps }): string | undefined {
  if (card.laps === 0) {
    return undefined;
  }
  return `${String(card.laps)} lap(s) so far: ${String(card.fleetLaps)} fleet, ${String(card.worldLaps)} world`;
}
