/**
 * Applying one call's Queue-walk moves (`../../../talk/cardMove.ts`): a move on takes the card they left off their Queue
 * in the moved-on ledger, and a "come back to it" defers it exactly as a press of the page's button does. Called by
 * `talk transcript` (`./transcriptLand.ts`) under the card-landing lock, after the answers are landed, so a move and a
 * landing of the same call never race and a batch posted again writes nothing twice.
 *
 * A move writes no ruling, registers no work and checks no subject gate: it is a local overlay on their own Queue, and a
 * `talk restore` of the card lifts it.
 */
import type { Result } from "#lib/result.js";

import { voiceDeferralRow } from "../../../queueDefer/cardDeferral.js";
import { appendCardDeferral, readCardDeferrals } from "../../../queueDefer/cardDeferralStore.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { cardWalkMoves } from "../../../talk/cardMove.js";
import { movedOnRowToWrite } from "../../../talk/cardMoveLedger.js";
import { appendCardMove, readCardMoves } from "../../../talk/cardMoveStore.js";

/** What applying one call's moves came to. */
export interface MovesApplied {
  /** Rows written just now: moved-on rows and deferrals together. */
  readonly written: number;
  /** Each write that failed, as `<card>: <why>`; the next run retries it. */
  readonly failed: readonly string[];
}

/**
 * Whether one call's walk still owes a row — a move on or a come-back not yet on file — so the sweep a failed landing
 * owes retries a call whose words all landed but whose move did not. A ledger that does not read
 * owes one, since the sweep is the retry and saying "nothing owed" would be a guess.
 *
 * @param callId the voice call whose file the lines came from
 * @param entries the call's lines, in file order
 * @param home the Slopweaver home
 * @returns whether applying the call's moves would write anything
 */
export function movesOwed({
  callId,
  entries,
  home,
}: {
  callId: string;
  entries: readonly CallEntry[];
  home: string;
}): boolean {
  const moves = cardWalkMoves({ callId, entries });
  if (moves.length === 0) {
    return false;
  }
  const landings = readCardLandings({ home });
  const ledger = readCardMoves({ home });
  const deferrals = readCardDeferrals({ home });
  if (landings.isErr() || ledger.isErr() || deferrals.isErr()) {
    return true;
  }
  const nowIso = new Date().toISOString();
  return moves.some(
    (move) =>
      movedOnRowToWrite({ landings: landings.value.rows, move, moves: ledger.value.rows, nowIso }) !== undefined ||
      voiceDeferralRow({ move, rows: deferrals.value.rows }) !== undefined,
  );
}

/**
 * Apply every move one call's walk made that is not already on file.
 *
 * @param callId the voice call whose file the lines came from, which names each move's anchor
 * @param entries the call's lines, in file order, read under the lock
 * @param home the Slopweaver home
 * @param nowIso when the rows are written
 * @returns how many rows were written, and each that failed
 */
export function applyCallMoves({
  callId,
  entries,
  home,
  nowIso,
}: {
  callId: string;
  entries: readonly CallEntry[];
  home: string;
  nowIso: string;
}): MovesApplied {
  const moves = cardWalkMoves({ callId, entries });
  if (moves.length === 0) {
    return { failed: [], written: 0 };
  }
  const landings = readCardLandings({ home });
  const ledger = readCardMoves({ home });
  const deferrals = readCardDeferrals({ home });
  if (landings.isErr() || ledger.isErr() || deferrals.isErr()) {
    const why = [landings, ledger, deferrals].flatMap((read) => (read.isErr() ? [read.error.message] : []));
    return { failed: [`any card: ${why.join("; ")}`], written: 0 };
  }
  const movedOn = [...ledger.value.rows];
  const deferred = [...deferrals.value.rows];
  const failed: string[] = [];
  let written = 0;
  for (const move of moves) {
    written += writeOne({
      append: (row) => appendCardMove({ home, row }),
      cardKey: move.fromCardKey,
      failed,
      kept: movedOn,
      row: movedOnRowToWrite({ landings: landings.value.rows, move, moves: movedOn, nowIso }),
    });
    written += writeOne({
      append: (row) => appendCardDeferral({ home, row }),
      cardKey: move.fromCardKey,
      failed,
      kept: deferred,
      row: voiceDeferralRow({ move, rows: deferred }),
    });
  }
  return { failed, written };
}

/**
 * Append one row when there is one, keeping it beside what is on file so the next move reads it, or naming the card
 * and why when the write failed.
 *
 * @param row the row to write, `undefined` when there is nothing to write
 * @param append the ledger's append
 * @param kept the rows on file so far, grown in place
 * @param failed each failed write so far, grown in place
 * @param cardKey the card the failure names
 * @returns how many rows were written: one or none
 */
function writeOne<T>({
  row,
  append,
  kept,
  failed,
  cardKey,
}: {
  row: T | undefined;
  append: (row: T) => Result<string, { readonly message: string }>;
  kept: T[];
  failed: string[];
  cardKey: string;
}): number {
  if (row === undefined) {
    return 0;
  }
  const appended = append(row);
  if (appended.isErr()) {
    failed.push(`${cardKey}: ${appended.error.message}`);
    return 0;
  }
  kept.push(row);
  return 1;
}
