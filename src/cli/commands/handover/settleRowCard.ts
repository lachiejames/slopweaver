/**
 * The hand register read WHOLE, and the card a relay row owes when no relay turn names one — split out of
 * `./settleCardRun.ts` under the file-size ratchet.
 *
 * ## A relay row no turn names a card for
 *
 * A row's `talk:` anchor can name a turn whose file was never written, or a turn whose `about` is empty (one from
 * before `about` existed decodes that way), or one whose `about` names a card that is not a hand card. Refusing the
 * first as unreadable stranded a shipped relay row for good, since settlement is write-once and that refusal has no
 * hatch. None of them names a HAND card the relay was spoken over, so the register is asked by the ROW instead: a hand step whose `row` is this slug (`hand post --row`) is the
 * one card that is provably waiting on it. Any open one refuses with `ROW_CARD_OPEN`, naming each; none settles the
 * row with nothing to answer for, and a receipt line saying how it was read. The step is NOT routed through a
 * `--card` disposition: a step unblocking a row is not proof the relay was spoken over it, so closing it in the
 * relay's name would invent provenance. A `talk:` anchor over a console CALL id passes the same check: a call has no
 * turn to name a card either.
 *
 * Residue, stated: both reads are plan-time reads. A step posted naming the row between the read and the row write
 * is not seen; `../../../hand/evidence.ts` retracts it once the row reads terminal. A turn file created for the
 * anchor in that window is not seen either — but a relay writes its turn BEFORE it registers the row
 * (`../talk/relayRun.ts`: `claimTurn`, then `ensureRow`, then `markRegistered`), so that needs the same turn id
 * relayed again after its file was lost, and such a turn is not `registered` until its row is marked.
 */
import { skippedLines } from "../../../hand/postingChecks.js";
import { type HandRow, openHandSteps } from "../../../hand/row.js";
import { readHandRows, underLock, unreadBesideTornTail } from "../../../hand/store.js";
import { type SettleCardError, SettleCardErrors } from "../../../handover/settleCardErrors.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** Why no relay turn could name a hand card for the row. */
export type NoTurnCard = "turn-absent" | "call-unproven" | "about-empty" | "about-not-hand";

/** How each {@link NoTurnCard} reads in the receipt, after the anchor. */
const NO_TURN_CARD_TEXT: Readonly<Record<NoTurnCard, string>> = {
  "about-empty": "names a turn that names no card",
  "about-not-hand": "names a turn whose card is not a hand card",
  "call-unproven": "has no turn file, and the call store could not say whether it holds a call id",
  "turn-absent": "has no turn file",
};

/**
 * Every row of the hand register, refusing a register that skipped a line — the skipped line may be the very
 * posting, settling or re-cut edge the card's fate turns on.
 *
 * @param path the register file
 * @returns the rows, or why they cannot be trusted whole
 */
export function wholeHandRows({ path }: { path: string }): Result<readonly HandRow[], SettleCardError> {
  const read = readHandRows({ missing: "empty", path });
  if (read.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: read.error.message }));
  }
  const unread = unreadBesideTornTail({ path, unparsed: read.value.unparsed });
  if (unread.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: unread.error.message }));
  }
  if (unread.value.length > 0) {
    return err(SettleCardErrors.handRegisterIncomplete({ lineNumbers: skippedLines({ unparsed: unread.value }) }));
  }
  return ok(read.value.rows);
}

/**
 * {@link wholeHandRows} at plan time, taken under the register's own lock: the row read and the torn-tail judgement
 * are two opens of the file, and an append landing between them would let the second judge the first's last skipped
 * line torn, forgiving a line that may be the very card a check needs. Inside the lock the file cannot
 * move between them. The card effect already holds this lock, so it calls {@link wholeHandRows} directly.
 *
 * @param home the state home whose register is read
 * @param nowIso the instant the lock is taken at
 * @returns the rows, or why they cannot be trusted whole, or why the lock could not be had
 */
export function lockedWholeHandRows({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<readonly HandRow[], SettleCardError> {
  const locked = underLock({ home, nowIso, section: (path) => ok(wholeHandRows({ path })) });
  if (locked.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: locked.error.message }));
  }
  return locked.value;
}

/**
 * The ids of every open hand step naming `slug` as the row it unblocks, in register order — pure.
 *
 * @param rows every row of the hand register
 * @param slug the row being settled
 * @returns the open steps' ids, empty when none names the row
 */
export function openCardsNamingRow({ rows, slug }: { rows: readonly HandRow[]; slug: string }): readonly string[] {
  return openHandSteps({ rows })
    .filter((step) => step.row === slug)
    .map((step) => step.id);
}

/**
 * The receipt line for a relay row no turn named a card for and no open hand card names — pure.
 *
 * @param anchor the row's raw `anchor:`
 * @param slug the row being settled
 * @param reason why no turn named a card
 * @returns the one line
 */
export function noTurnCardReceipt({
  anchor,
  slug,
  reason,
}: {
  anchor: string;
  slug: string;
  reason: NoTurnCard;
}): string {
  return `  ${anchor} ${NO_TURN_CARD_TEXT[reason]}, so the hand register was read by the row: no open card names ${slug}, none to answer for`;
}

/**
 * Refuse while any open hand card names the row, read off the WHOLE register — the check every `talk:` row with no
 * readable turn passes, a call anchor's included, since a call carries no turn to name a card either.
 *
 * @param slug the row being settled
 * @param nowIso the instant the register's lock is taken at
 * @returns nothing when no open card names the row, or the open cards naming it, or why the register cannot be trusted
 */
export function refuseOpenRowCard({
  home,
  slug,
  nowIso,
}: {
  home: string;
  slug: string;
  nowIso: string;
}): Result<void, SettleCardError> {
  const rows = lockedWholeHandRows({ home, nowIso });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const ids = openCardsNamingRow({ rows: rows.value, slug });
  if (ids.length > 0) {
    return err(SettleCardErrors.rowCardOpen({ home, ids, slug }));
  }
  return ok(undefined);
}

/**
 * Settle a relay row no turn names a card for by the hand register alone: refused while any open card names the
 * row, otherwise the receipt saying how it was read.
 *
 * @param anchor the row's raw `anchor:`
 * @param slug the row being settled
 * @param reason why no turn named a card
 * @param nowIso the instant the register's lock is taken at
 * @returns the receipt lines, or the open cards naming the row, or why the register cannot be trusted
 */
export function rowCardReceiptOrRefusal({
  home,
  anchor,
  slug,
  reason,
  nowIso,
}: {
  home: string;
  anchor: string;
  slug: string;
  reason: NoTurnCard;
  nowIso: string;
}): Result<readonly string[], SettleCardError> {
  return refuseOpenRowCard({ home, nowIso, slug }).map(() => [noTurnCardReceipt({ anchor, reason, slug })]);
}
