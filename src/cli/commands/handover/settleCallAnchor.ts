/**
 * A settled row's `talk:` anchor whose relay turn will not read — split out of `./settleCardRun.ts` under the
 * file-size ratchet. It holds a CALL id rather than a relay turn id (the measured row and the predicate are
 * `../../../talk/relayAnchorCall.ts`), its turn file was simply never written, or the turn is damaged.
 */
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { type SettleCardError, SettleCardErrors } from "../../../handover/settleCardErrors.js";
import type { TalkError } from "../../../talk/errors.js";
import { relayAnchorTurnReading } from "../../../talk/relayAnchorCall.js";
import { refuseOpenRowCard, rowCardReceiptOrRefusal } from "./settleRowCard.js";

/** What a `talk:` anchor whose turn would not read comes to, short of a refusal. */
export type UnreadTurnReading =
  /** The anchor holds a console call id, which carries no relay turn and so no relay card. */
  | { readonly kind: "call"; readonly call: string }
  /** No turn file is there at all and the call store proved the id no call's: a relay turn never written. */
  | { readonly kind: "absent" }
  /** No turn file is there on either read, and the call store cannot say whether the id is a call's: `why` says why. */
  | { readonly kind: "call-unproven"; readonly why: string };

/**
 * A `talk:` anchor whose turn will not read: a CALL id written under the relay scheme settles as the call anchor it
 * is, a turn file that is simply NOT THERE is read as absent, and anything else is the unreadable relay it looks like.
 *
 * A call carries no relay turn and so no relay card, exactly as a row anchored `talk-call:` or `call:` carries none.
 * An absent turn names no card either, so the caller asks the hand register by the row instead
 * (`./settleRowCard.ts`). Damaged provenance is never read as either: a turn file that is there but unreadable, or a
 * turn filed under another id, still refuses. A call store that cannot say whether the id is a call is NOT refused
 * when the turn is absent on both reads: a call and an absent turn are decided by the same row check, so the store
 * could change only which receipt is printed, and the receipt names the store's failure instead.
 *
 * Absence must hold on BOTH reads — the caller's, and the call reading's own: a turn written between them comes back
 * `neither`, and a file the caller saw there but unreadable and that is gone by the second read was still damaged
 * provenance when the settle looked. Either disagreement refuses as unreadable; a retry reads what is there now.
 *
 * @param anchor the row's raw `anchor:`
 * @param turnError why the caller's own `readTurn` failed, carried into a refusal
 * @returns the call id the anchor holds, the absent turn (with why the call store could not prove it, when it could
 *   not), or the unreadable-relay refusal
 */
export function unreadTurnReading({
  home,
  anchor,
  turnError,
}: {
  home: string;
  anchor: string;
  turnError: TalkError;
}): Result<UnreadTurnReading, SettleCardError> {
  const why = turnError.message;
  const firstAbsent =
    turnError.code === "PATH_UNREADABLE" && isAbsentError({ error: turnError.cause, path: turnError.path });
  if (!firstAbsent) {
    return err(SettleCardErrors.relayTurnUnreadable({ anchor, why }));
  }
  const reading = relayAnchorTurnReading({ anchor, home });
  if (reading.isErr()) {
    return ok({ kind: "call-unproven", why: reading.error.message });
  }
  if (reading.value.kind === "call") {
    return ok({ call: reading.value.id, kind: "call" });
  }
  if (reading.value.kind === "absent") {
    return ok({ kind: "absent" });
  }
  return err(SettleCardErrors.relayTurnUnreadable({ anchor, why }));
}

/**
 * A relay anchor whose turn would not read, decided: a console call anchor or a turn absent on both reads names no
 * hand card, so the row is decided by the register alone — even when the call store cannot say which of the two it
 * is, since both are decided alike and the receipt names the store's failure; a turn present but damaged is refused.
 *
 * @param anchor the row's `anchor:`, already parsed as a relay anchor
 * @param slug the row's slug, which an open hand card must name to refuse
 * @param nowIso the instant the hand register's lock is taken at
 * @param turnError why the caller's own `readTurn` failed
 * @returns the receipt lines, or why the row cannot be settled
 */
export function unreadTurnReceipt({
  home,
  anchor,
  slug,
  nowIso,
  turnError,
}: {
  home: string;
  anchor: string;
  slug: string;
  nowIso: string;
  turnError: TalkError;
}): Result<readonly string[], SettleCardError> {
  const reading = unreadTurnReading({ anchor, home, turnError });
  if (reading.isErr()) {
    return err(reading.error);
  }
  if (reading.value.kind === "call") {
    const receiptLines = callAnchorReceipt({ anchor, call: reading.value.call });
    return refuseOpenRowCard({ home, nowIso, slug }).map(() => receiptLines);
  }
  const storeLines = reading.value.kind === "call-unproven" ? [`    the call store: ${reading.value.why}`] : [];
  const reason = reading.value.kind === "call-unproven" ? "call-unproven" : "turn-absent";
  return rowCardReceiptOrRefusal({ anchor, home, nowIso, reason, slug }).map((receiptLines) => [
    ...receiptLines,
    ...storeLines,
  ]);
}

/**
 * The receipt line saying a row's `talk:` anchor was read as the call it holds.
 *
 * @param anchor the row's raw `anchor:`
 * @param call the call id it holds, or undefined when it named a relay or no relay at all
 * @returns the one line, or none
 */
export function callAnchorReceipt({
  anchor,
  call,
}: {
  anchor: string | undefined;
  call: string | undefined;
}): readonly string[] {
  if (anchor === undefined || call === undefined) {
    return [];
  }
  return [
    `  ${anchor} holds call id ${call}, not a relay turn's, so it was read as that call: no relay card to answer for`,
  ];
}
