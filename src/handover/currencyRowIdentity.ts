/**
 * One currency row per card identity. The console joins a card to its row by exact key and floor
 * (`site/lib/cardCurrencyHalves.ts`), so two rows sharing both would leave the card's reading to whichever came first.
 * Two board docs carrying one slug mint the same identity; a pull request no longer can, since its key names the
 * repository as well as the number (`../talk/prCardKey.ts`), but a hand-edited reading still might. Identical rows are
 * one reading; rows that disagree are one row whose fact says so, never a pick by order.
 */
import { stableStringify } from "#lib/stableStringify.js";

import type { CurrencyRow, NotConfirmedWhy } from "./currency.js";

/** Why a card whose sources disagree is not confirmed. */
const DISAGREE: NotConfirmedWhy =
  "two sources mint this card's key and floor and disagree on its reading, so neither is confirmed";

/**
 * A row's identity as the console joins it. An absent floor serialises as `null` inside the array, kept apart from any
 * string floor, the literal `"undefined"` included.
 */
function identityOf({ row }: { row: CurrencyRow }): string {
  return JSON.stringify([row.key, row.floorIso]);
}

/** The first row of a disagreeing identity, its fact not confirmed and its done-check dropped. */
function disagreed({ row }: { row: CurrencyRow }): CurrencyRow {
  const fact = { kind: "not-confirmed", why: DISAGREE } as const;
  if (row.askedIso === undefined) {
    return { fact, floorIso: row.floorIso, key: row.key, since: row.since };
  }
  return { askedIso: row.askedIso, fact, floorIso: row.floorIso, key: row.key, since: row.since };
}

/**
 * Collapse the rows to one per key and floor, in first-seen order: identical rows merge, and rows that disagree
 * become the first row with its fact not confirmed and no done-check, since neither source's can be shown as the card's.
 *
 * @param rows every card's reading, in document order
 * @returns one row per identity
 */
export function oneRowPerCard({ rows }: { rows: readonly CurrencyRow[] }): CurrencyRow[] {
  const byIdentity = new Map<string, { row: CurrencyRow; text: string }>();
  for (const row of rows) {
    const identity = identityOf({ row });
    // Key-sorted, so two rows carrying the same data merge whatever order their fields were built in.
    const text = stableStringify({ value: row });
    const held = byIdentity.get(identity);
    if (held === undefined) {
      byIdentity.set(identity, { row, text });
      continue;
    }
    if (held.text !== text) {
      byIdentity.set(identity, { row: disagreed({ row: held.row }), text: held.text });
    }
  }
  return [...byIdentity.values()].map(({ row }) => row);
}
