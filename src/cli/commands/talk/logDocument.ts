/**
 * The JSON document `talk log --json` prints. A `--turn` read carries one more field, at the document's level and
 * never inside the row: `chairReceipt`, how the chair holds that relay whatever its delivery was graded
 * (`../../../talk/chairReceipt.ts`), or `null` when it holds none that could be read — so whoever checks a relay
 * (the chair, a seat, `recent_steers`' reader) sees whether the chair has it whatever the grade says. The receipt names
 * the turn it was read for, and is printed exactly as read, never re-stamped with the row's turn, so a receipt handed
 * the wrong row reads as naming another turn.
 */
import type { ChairReceipt } from "../../../talk/chairReceipt.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

/** The listing's document, or one turn's with its receipt. */
export type TalkLogDocument =
  | { readonly home: string; readonly rows: readonly TurnRecord[] }
  | { readonly home: string; readonly rows: readonly TurnRecord[]; readonly chairReceipt: ChairReceipt | null };

/**
 * The listing's document: the rows and the home they were read from.
 *
 * @returns `{ home, rows }`
 */
export function talkLogListDocument({ home, rows }: { home: string; rows: readonly TurnRecord[] }): TalkLogDocument {
  return { home, rows };
}

/**
 * One turn's document, its receipt beside the row, carrying the turn id it was read for.
 *
 * @param receipt how the chair holds the relay, `undefined` when it holds none
 * @returns `{ home, rows, chairReceipt }`, the receipt `null` when there is none
 */
export function talkLogTurnDocument({
  home,
  row,
  receipt,
}: {
  home: string;
  row: TurnRecord;
  receipt: ChairReceipt | undefined;
}): TalkLogDocument {
  if (receipt === undefined) {
    return { chairReceipt: null, home, rows: [row] };
  }
  return { chairReceipt: receipt, home, rows: [row] };
}
