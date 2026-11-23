/**
 * The reader for `queue deferred --json` — the Queue cards the owner put off with "Come back to it"
 * (`src/queueDefer/cardDeferral.ts`).
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never DROP a row. The reading ORDERS the queue rather than being drawn, so a deferral that does not read
 * refuses the whole reading: a skipped one is a card the owner stepped aside, drawn back on top of the owner.
 */

import { bags, isBag, str } from "../../lib/bag";

/** One card the owner put off and has not put back. */
export interface CardDeferral {
  readonly cardKey: string;
  readonly deferredIso: string;
}

/** What the queue orders by. */
export interface CardDeferrals {
  /** Oldest deferral first, as the verb folded them. */
  readonly deferrals: readonly CardDeferral[];
  /** How many ledger lines the verb could not read — a partial order the page says it is. */
  readonly unreadable: number;
}

/** A UTC ISO-8601 instant, as `Date.prototype.toISOString` writes one, fraction optional. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

/**
 * Whether a deferral's instant is one: a UTC ISO-8601 instant and nothing else. Any other string would ride the row it
 * stamps as words the voice scans for a briefing (`../../lib/openCard.ts`) while no chip was drawn for it, so both this reader and the overlay that stamps it (`../../lib/cardDeferrals.ts`) ask.
 *
 * @param iso the deferral's `deferredIso`
 * @returns true when it is a UTC instant
 */
export function isDeferralInstant({ iso }: { iso: string }): boolean {
  return UTC_INSTANT.test(iso);
}

/**
 * Project `queue deferred --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the deferrals, or `undefined` when the payload or any deferral in it does not read
 */
export function readCardDeferrals(payload: unknown): CardDeferrals | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "deferrals" });
  const unreadable = payload["unreadable"];
  if (rows === undefined || !Array.isArray(unreadable)) {
    return undefined;
  }
  const deferrals: CardDeferral[] = [];
  for (const row of rows) {
    const cardKey = str({ bag: row, key: "cardKey" });
    const deferredIso = str({ bag: row, key: "deferredIso" });
    // The instant is a UTC ISO instant or the deferral does not read ({@link isDeferralInstant}).
    if (cardKey === undefined || deferredIso === undefined || !isDeferralInstant({ iso: deferredIso })) {
      return undefined;
    }
    deferrals.push({ cardKey, deferredIso });
  }
  return { deferrals, unreadable: unreadable.length };
}
