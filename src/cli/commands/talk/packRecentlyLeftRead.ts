/**
 * The talk pack's recently-left half, read: the landings and Queue-walk moves still holding a card off the owner's Queue, and
 * the settled asks on the board. Split out of `./packRun.ts` (the file-size ratchet) along that seam; the projection itself is
 * `../../../talk/packRecentlyLeft.ts`.
 */

import { activeCardLandings } from "../../../talk/cardLanding.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { unreadableCardLinesSince } from "../../../talk/cardLedgerFile.js";
import { activeCardMoves } from "../../../talk/cardMoveLedger.js";
import { readCardMoves } from "../../../talk/cardMoveStore.js";
import type { PackUnread } from "../../../talk/contextPack.js";
import { type PackRecentlyLeft, packRecentlyLeftOf } from "../../../talk/packRecentlyLeft.js";
import { PACK_LOOKBACK_MS } from "../../../talk/packText.js";
import type { BoardJsonRow } from "../handover/listJson.js";

/**
 * The cards that left the owner's Queue in the last day. Either register unread is named, never read as "nothing left": a
 * card the ledger or the board could not say is missing.
 *
 * @param home the state home the landing ledger lives under
 * @param rows the board's rows, or `undefined` when the board could not be read
 * @param nowIso the end of the look-back window
 * @returns the departed cards, and why any of them may be missing
 */
export function readRecentlyLeft({
  home,
  rows,
  nowIso,
}: {
  home: string;
  rows: readonly BoardJsonRow[] | undefined;
  nowIso: string;
}): { left: readonly PackRecentlyLeft[]; unread: PackUnread | undefined } {
  const read = readCardLandings({ home });
  const gaps: string[] = [];
  const sinceIso = lookbackFloorIso({ nowIso });
  let landings: ReturnType<typeof activeCardLandings> = [];
  if (read.isErr()) {
    gaps.push(`the card-landing ledger could not be read: ${read.error.message}`);
  } else {
    landings = activeCardLandings({ rows: read.value.rows });
    const unread = unreadableCardLinesSince({ lines: read.value.unreadableLines, sinceIso }).length;
    if (unread > 0) {
      gaps.push(`${String(unread)} card-landing line(s) did not read`);
    }
  }
  // Unread, the landing ledger's restores cannot lift a move, so no move is listed rather than one restored since —
  // but the moved-on ledger is still read, so what it could not say is named too.
  const moves = activeMovesRead({ gaps, home, landingRows: read.isErr() ? undefined : read.value.rows, sinceIso });
  let boardRows: readonly BoardJsonRow[] = [];
  if (rows === undefined) {
    // Unread, the board cannot say which ask was the owner's card, so the projection lists no ask rather than a voice relay
    // row as one, and this names what may be missing.
    gaps.push("the board could not be read, so an ask that left may be missing");
  } else {
    boardRows = rows;
  }
  const left = packRecentlyLeftOf({ landings, moves, nowIso, rows: boardRows });
  if (gaps.length === 0) {
    return { left, unread: undefined };
  }
  return { left, unread: { section: "recentlyLeft", why: gaps.join("; ") } };
}

/**
 * The instant the section looks back to. A clock that does not read gives no floor, so every refused line stays a gap.
 *
 * @param nowIso the end of the look-back window
 * @returns the start of the window, or `nowIso` itself when it does not read
 */
function lookbackFloorIso({ nowIso }: { nowIso: string }): string {
  const floorMs = Date.parse(nowIso) - PACK_LOOKBACK_MS;
  return Number.isNaN(floorMs) ? nowIso : new Date(floorMs).toISOString();
}

/**
 * The Queue-walk moves still holding a card off the owner's Queue, naming any part of the moved-on ledger that did not
 * read and may fall inside the window: a refused line naming a real card it recorded leaving before the window cannot
 * be a card that left today, and one naming no card key is no card at all (`../../../talk/cardLedgerFile.ts`).
 *
 * @param home the state home the ledger lives under
 * @param landingRows the card-landing ledger, whose restores lift a move; `undefined` when it could not be read
 * @param gaps what may be missing so far, grown in place
 * @param sinceIso the start of the look-back window
 * @returns the active moves, none when either ledger could not be read
 */
function activeMovesRead({
  home,
  landingRows,
  gaps,
  sinceIso,
}: {
  home: string;
  landingRows: Parameters<typeof activeCardMoves>[0]["landings"] | undefined;
  gaps: string[];
  sinceIso: string;
}): ReturnType<typeof activeCardMoves> {
  const movedRead = readCardMoves({ home });
  if (movedRead.isErr()) {
    gaps.push(`the moved-on ledger could not be read: ${movedRead.error.message}`);
    return [];
  }
  const unread = unreadableCardLinesSince({ lines: movedRead.value.unreadableLines, sinceIso }).length;
  if (unread > 0) {
    gaps.push(`${String(unread)} moved-on line(s) did not read`);
  }
  if (landingRows === undefined) {
    return [];
  }
  return activeCardMoves({ landings: landingRows, moves: movedRead.value.rows });
}
