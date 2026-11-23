import type { BoardRow } from "../components/live/read";

/**
 * When an ask was last confirmed to still stand, and by what.
 *
 * The board READ is not a confirmation of an ask: it only proves the row is still recorded, which a stale
 * ask always is. Only the still-real check (`--still-real`, dated by the verb or by `handover reconfirm`)
 * says someone looked, and the check's own words ride along so a vague one is visible on the mark itself —
 * a row reconfirmed without stakes has no stakes block to print them in.
 *
 * It carries the ask's landing floor too: a question asked again after the owner spoke is a new question, so words said
 * over the old one do not hold it off the owner's list (`./cardLandings.ts`).
 *
 * @param row the board's row
 * @returns the instant and its source, the instant absent when the ask was never re-confirmed, and the last asking
 *   as `landingFloorIso` when the board dates one, and the later of the two as the card's `currencyFloorIso` — the
 *   floor `handover currency` stamps on an ask's row (`src/handover/currencyCards.ts` `askFloorOf`)
 */
export function askVerified({ row }: { row: BoardRow }): {
  verifiedIso: string | undefined;
  verifiedBy: string;
  landingFloorIso?: string;
  currencyFloorIso: string | undefined;
} {
  const floor = {
    currencyFloorIso: laterOf({ left: row.questionAskedIso, right: row.stillRealIso }),
    ...(row.questionAskedIso === undefined ? {} : { landingFloorIso: row.questionAskedIso }),
  };
  if (row.stillRealIso === undefined) {
    return { ...floor, verifiedBy: "never re-confirmed since it was asked", verifiedIso: undefined };
  }
  if (row.stillReal === undefined) {
    return { ...floor, verifiedBy: "its still-real check", verifiedIso: row.stillRealIso };
  }
  return { ...floor, verifiedBy: `its still-real check: ${row.stillReal}`, verifiedIso: row.stillRealIso };
}

/**
 * The later of two optional instants, the earlier one on a tie — `askFloorOf` in `src/handover/currencyCards.ts`, restated
 * because the console cannot import it, so the floor this stamps is byte for byte the one the producer stamps.
 *
 * @returns the later one, either when only one is present, `undefined` when neither is
 */
function laterOf({ left, right }: { left: string | undefined; right: string | undefined }): string | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}
