/**
 * The duplicate-send check, made ATOMIC.
 *
 * Reading prior sends out of the door ledger and then deciding is a test-and-set split in two: two sends of
 * the same message started at the same moment both read "nothing sent yet", both pass the gate, and both post.
 * For an irreversible action that is the one failure the gate exists to prevent, so the check is not a read —
 * it is a RESERVATION, and exactly one caller can take it.
 *
 * The reservation lives at `$SLOPWEAVER_HOME/ledgers/slack-sends/<duplicateKey>` and holds only the instant it
 * was taken — the key is already an opaque hash, so nothing here carries a target id or a word of content. The
 * door ledger still records the key as the audit trail; this is the concurrency primitive underneath it. This
 * module is the policy; the slot on disk, its lock and its ownership are `./sendReservationSlot.ts`.
 *
 * ## Every change to a slot is made under that slot's lock, and lands whole
 *
 * An `O_EXCL` create alone was not enough, because a slot is also REPLACED: an aged or unreadable one is taken
 * over, a confirmed send re-dates it, a provider-proven failure releases it. The takeover used to be `unlink`
 * then an exclusive create, so a contender holding a stale read could unlink a peer's brand-new reservation and
 * win its own create; and `confirmSend` rewrote the file in place, so a reader that caught it empty judged it
 * unreadable and took the slot over. MEASURED on main: twelve processes released at
 * one instant against a slot 48 hours old got 2, 2, 1, 1 and 3 fresh winners over five laps. The race is
 * `src/__tests__/subprocess/outbound/slack/sendReservationRace.test.ts`.
 *
 * So three rules, each closing one way a second sender could find the slot empty:
 *
 * - **One lock per slot.** Every read-then-change of a slot (reserve, takeover, confirm, release, re-take)
 *   holds the operation lock `slack-send:<duplicateKey>` (`../../admit/operationLock.ts`) for its whole
 *   critical section. It is a NEVER-STALE lease, so a live holder is never taken over mid-section while a
 *   dead one is recovered at once, and it is dated by the real clock rather than the caller's `nowIso`,
 *   which is the send window's time and may be a fixture's.
 * - **A record lands whole.** A new reservation is written in full to a private sibling and `link`ed into
 *   place, which fails `EEXIST` rather than replacing; a confirmation is a temp-then-rename
 *   (`writeFileAtomic`). No reader, locked or not, ever sees the slot empty or half-written.
 * - **A release drops only its own reservation.** Each reservation carries a random `claim` id that the
 *   process taking it remembers, and a provider-proven failure releases the slot only while that claim still
 *   stands there and its take never overlapped another of this process's takes of the slot. A failure settled
 *   late, after the slot aged out and another send took it (another process, or this one again), leaves the
 *   newer reservation in place instead of emptying the slot for a third. An explicit resend's re-take keeps
 *   the reservation it replaced as `prior`, and its own proven failure puts that one back rather than
 *   emptying a slot whose earlier message may have landed.
 *
 * A lock that stays busy through a short bounded wait, or cannot be taken at all because the shared lock
 * directory is broken, FAILS CLOSED: a reserve reads as a duplicate, a confirm
 * or a release does nothing and leaves the slot as it was. Each over-warns on the next attempt and none can
 * double-post.
 *
 * Evidence direction (deliberate): a reservation is taken BEFORE the send, so a send that was reserved and then
 * failed for a reason nobody can read — a timeout, a lost response — still leaves one. That over-warns on a
 * retry (you are asked to confirm) and never under-warns (a real double-post cannot slip through) — the correct
 * direction to be wrong in. A failure Slack ITSELF reported is different, and {@link settleFailedSend} treats it
 * so: an `ok: false` answer proves nothing was posted, and a reservation kept for it blocks every later attempt
 * at the same words for the whole window while protecting nothing. Measured on a card whose first
 * attempt died on `channel_not_found`: the reservation dangled, the door override and `--resend-unconfirmed`
 * were both refused downstream of it, and only hand-deleting the file let the send through.
 *
 * PR5.1 adds ONE thing to that record, because a drip inverts the bias. A drip is N reservations, and a
 * resumed drip SKIPS the messages it finds reserved — so a reservation left behind by a message that
 * reserved and then failed would make the resume skip a line that never landed. Silent under-sending is a
 * worse failure than the over-warning this file was tuned for. The record therefore also carries the `ts`
 * of the message once it is CONFIRMED on the wire, which splits a reservation into "confirmed landed"
 * (skip it) and "outcome unknown" (say so, and refuse to guess). The card lane gets the same record and is
 * unaffected by the distinction.
 */
import { classifySendFailure, type SendFailureVerdict } from "./sendFailure.js";
import {
  confirmSlot,
  ensureSlotDir,
  type ReservationRecord,
  readReservation,
  releaseOwnTake,
  removeSlot,
  reservationPath,
  retakeSlot,
  settledHere,
  takeSlot,
  withSlotLock,
} from "./sendReservationSlot.js";

/**
 * Whether a message with this content+identity has already been sent inside the window.
 *
 * `sentTs` present ⇒ the send was CONFIRMED by Slack and this is its message timestamp. Absent on a
 * `duplicate` ⇒ the slot was claimed but nothing ever confirmed, so the message may or may not have
 * landed; the only honest answers are to ask a human or to be told explicitly to send it again.
 */
export type SendReservation =
  | { readonly kind: "fresh" }
  | { readonly kind: "duplicate"; readonly firstSentIso: string; readonly sentTs?: string | undefined };

/** Milliseconds in an hour. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a repeated identical send stays "recent". One value for both lanes, defined here beside the
 * reservation it dates rather than at each call site — two lanes disagreeing about the window would mean
 * the card and the drip remember a send for different lengths of time, for no reason anyone chose.
 */
export const DUPLICATE_WINDOW_HOURS = 24;

/**
 * Whether a prior send is still inside the duplicate window. An unparseable timestamp counts as OUTSIDE it —
 * evidence we cannot date is no evidence, matching the ledger-side rule. Pure.
 *
 * @param firstSentIso when the prior send was reserved
 * @param nowIso the reference instant
 * @param windowHours how long a prior send keeps warning
 * @returns true iff the prior send still counts
 */
export function isWithinWindow({
  firstSentIso,
  nowIso,
  windowHours,
}: {
  firstSentIso: string;
  nowIso: string;
  windowHours: number;
}): boolean {
  const first = Date.parse(firstSentIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(first) || !Number.isFinite(now)) {
    return false;
  }
  return now - first < windowHours * HOUR_MS;
}

/** The `duplicate` verdict for a record, carrying its confirmed `ts` when it has one. */
function duplicateOf({ record }: { record: ReservationRecord }): SendReservation {
  return {
    firstSentIso: record.reservedIso,
    kind: "duplicate",
    ...(record.sentTs !== undefined ? { sentTs: record.sentTs } : {}),
  };
}

/** The reservation decision itself, with the slot's lock held: honour a live record, else take the slot. */
function reserveWhileLocked({
  path,
  nowIso,
  windowHours,
}: {
  path: string;
  nowIso: string;
  windowHours: number;
}): SendReservation {
  const record = readReservation({ path });
  if (record !== undefined && isWithinWindow({ firstSentIso: record.reservedIso, nowIso, windowHours })) {
    return duplicateOf({ record });
  }
  // Absent, aged out or unreadable: nobody else can change the slot while this lock is held, so what was just
  // read is still what stands there, and dropping it cannot drop a peer's newer reservation.
  removeSlot({ path });
  if (takeSlot({ nowIso, path })) {
    return { kind: "fresh" };
  }
  return { firstSentIso: nowIso, kind: "duplicate" };
}

/**
 * Take the reservation for a send, atomically. `fresh` means this caller may send; `duplicate` means an
 * identical message under the same identity was already reserved inside the window.
 *
 * A reservation that has aged out, or cannot be read, is replaced rather than trusted — under the slot's
 * lock, so of any number of callers racing for it exactly one wins and every other sees a duplicate. A lock
 * still busy after its bounded wait reads as a duplicate too: someone else is deciding this slot right now.
 *
 * @param home the state home
 * @param duplicateKey the opaque send identity (identity ⊕ rendered payload)
 * @param nowIso the reference instant
 * @param windowHours how long a prior send keeps warning
 * @returns whether this caller holds the reservation
 */
export function reserveSend({
  home,
  duplicateKey,
  nowIso,
  windowHours,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  windowHours: number;
}): SendReservation {
  // An instant that cannot be dated can neither be judged against the window nor written into the slot: the
  // record it left would read as aged, and the next identical send would claim it fresh. Never `fresh`.
  if (!Number.isFinite(Date.parse(nowIso))) {
    return { firstSentIso: nowIso, kind: "duplicate" };
  }
  ensureSlotDir({ home });
  const path = reservationPath({ duplicateKey, home });
  const decided = withSlotLock({
    body: () => reserveWhileLocked({ nowIso, path, windowHours }),
    duplicateKey,
    home,
  });
  if (decided.isOk()) {
    return decided.value;
  }
  // Busy past the wait: never `fresh`. Records land whole, so an unlocked read is a real one, and a live
  // record is reported as itself; anything else is reported as a reservation taken now.
  const record = readReservation({ path });
  if (record !== undefined && isWithinWindow({ firstSentIso: record.reservedIso, nowIso, windowHours })) {
    return duplicateOf({ record });
  }
  return { firstSentIso: nowIso, kind: "duplicate" };
}

/**
 * Record that the send actually went out, with the `ts` Slack gave it.
 *
 * Two jobs in one write, and both matter:
 *
 *  1. **Re-date the window** to the LAST real send rather than the first. Without it, a duplicate the
 *     operator deliberately let through with the override token would keep the original timestamp, so a
 *     third identical send just past the original window would read as fresh though one went out minutes
 *     ago.
 *  2. **Confirm the outcome.** A reservation with a `ts` proves the message landed; one without proves only
 *     that a slot was claimed. A resumed drip skips the first and refuses to guess about the second.
 *
 * The rewrite is a temp-then-rename under the slot's lock, so a reader never catches the slot empty — the
 * state an in-place rewrite passed through, and which read as "unreadable, take it over".
 *
 * Call it once per send this process reserved, never alongside {@link settleFailedSend} for the same send:
 * each call counts one take as settled.
 *
 * @param home the state home
 * @param duplicateKey the opaque send identity
 * @param nowIso the instant the send completed
 * @param sentTs the Slack message timestamp the send returned
 */
export function confirmSend({
  home,
  duplicateKey,
  nowIso,
  sentTs,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  sentTs: string;
}): void {
  // A confirmation that cannot be written leaves the slot claimed but unconfirmed: the next attempt halts and
  // asks rather than guessing, and the window edge is the claim's instant, seconds earlier. Never fatal.
  confirmSlot({ duplicateKey, home, nowIso, sentTs });
  settledHere({ path: reservationPath({ duplicateKey, home }) });
}

/**
 * WHICH prior sends a caller is allowed to send again. Two independent permissions, because they answer two
 * different questions and conflating them produces a silent bug in one direction or the other.
 *
 * - `unconfirmed` — `--resend-unconfirmed`: the operator looked at the target and says a message whose
 *   outcome was unknown did NOT land. Without this a stuck send can never be finished.
 * - `landed` — the door's duplicate override: the operator means to post the message AGAIN. Without this,
 *   "post it again, I mean it" is admitted by the door and then posts nothing at all, because the message is
 *   recognised as already sent. That is the exact opposite of what the override asks for, and it is silent.
 */
export interface ResendPolicy {
  readonly unconfirmed: boolean;
  readonly landed: boolean;
}

/** What one message's reservation says the caller should do with it. */
export type SendClaim =
  | { readonly kind: "send" }
  | { readonly kind: "already-sent"; readonly ts: string }
  | { readonly kind: "unconfirmed"; readonly reservedIso: string };

/**
 * Decide one message's fate from its reservation, taking the reservation as a side effect when the verdict
 * is `send`. This is the ONE place the three lanes (card, drip, poll) turn a reservation plus the operator's
 * stated permissions into a decision — a lane that read `reserveSend` directly and refused every `duplicate`
 * is how the door override came to be admitted at the door and then refused one line later.
 *
 * @param home the state home
 * @param duplicateKey the opaque send identity
 * @param nowIso the reference instant
 * @param windowHours how long a prior send keeps warning
 * @param resend which prior outcomes the operator has explicitly allowed to be sent again
 * @returns send it, skip it as landed, or halt on an outcome nobody can vouch for
 */
export function claimSend({
  home,
  duplicateKey,
  nowIso,
  windowHours,
  resend,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  windowHours: number;
  resend: ResendPolicy;
}): SendClaim {
  const reservation = reserveSend({ duplicateKey, home, nowIso, windowHours });
  if (reservation.kind === "fresh") {
    return { kind: "send" };
  }
  // A permitted repeat sends only once its own reservation is in place. One that could not re-take the slot
  // keeps the verdict it would have had without the permission, so a busy lock never becomes a send.
  if (reservation.sentTs !== undefined) {
    if (resend.landed && retakeSlot({ duplicateKey, home, nowIso })) {
      return { kind: "send" };
    }
    return { kind: "already-sent", ts: reservation.sentTs };
  }
  if ((resend.unconfirmed || resend.landed) && retakeSlot({ duplicateKey, home, nowIso })) {
    return { kind: "send" };
  }
  return { kind: "unconfirmed", reservedIso: reservation.firstSentIso };
}

/** How a failed send's reservation was left. */
type FailedSendSettlement =
  | {
      readonly kind: "released";
      readonly verdict: Extract<SendFailureVerdict, { kind: "rejected" | "retracted" | "refused-before-wire" }>;
    }
  | { readonly kind: "confirmed"; readonly ts: string }
  | { readonly kind: "kept" };

/**
 * Settle the reservation of a send that THREW, by what the failure proves — see {@link ./sendFailure}. Call it
 * once per send this process reserved, in place of {@link confirmSend}.
 *
 * Slack answered `ok: false`, or the composite send retracted what it posted ⇒ nothing is on the wire, so the
 * reservation is RELEASED and the next attempt is fresh. The composite send posted and could not retract ⇒ the
 * message is visible, so the reservation is CONFIRMED with its `ts` and the next attempt is a real duplicate.
 * Anything else ⇒ KEPT unconfirmed, the honest state for an outcome nobody read.
 *
 * @param home the state home
 * @param duplicateKey the opaque send identity
 * @param nowIso the instant the failure was observed
 * @param error the value the send threw
 * @returns what was done to the reservation, for the caller's report
 */
export function settleFailedSend({
  home,
  duplicateKey,
  nowIso,
  error,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  error: unknown;
}): FailedSendSettlement {
  const settlement = settleByVerdict({ duplicateKey, error, home, nowIso });
  // Whatever was done to the slot, this send is now settled, so it no longer counts as one of this process's
  // takes in flight. Settling BEFORE the release would let a second take's claim pass for this send's own.
  settledHere({ path: reservationPath({ duplicateKey, home }) });
  return settlement;
}

/**
 * {@link settleFailedSend}'s decision, before the send is counted as settled.
 *
 * @returns what was done to the reservation
 */
function settleByVerdict({
  home,
  duplicateKey,
  nowIso,
  error,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  error: unknown;
}): FailedSendSettlement {
  const verdict = classifySendFailure({ error });
  switch (verdict.kind) {
    case "rejected":
    case "retracted":
    case "refused-before-wire":
      // A release or confirmation its lock would not allow is reported as what is really there: kept.
      if (releaseOwnTake({ duplicateKey, home })) {
        return { kind: "released", verdict };
      }
      return { kind: "kept" };
    case "visible":
      if (confirmSlot({ duplicateKey, home, nowIso, sentTs: verdict.ts })) {
        return { kind: "confirmed", ts: verdict.ts };
      }
      return { kind: "kept" };
    case "ambiguous":
      return { kind: "kept" };
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/**
 * Read whether a send WOULD be a duplicate, without reserving anything — the `--dry-run` path, which must
 * leave no trace that could poison the next real send.
 *
 * @param home the state home
 * @param duplicateKey the opaque send identity
 * @param nowIso the reference instant
 * @param windowHours how long a prior send keeps warning
 * @returns what a real send would find
 */
export function peekSend({
  home,
  duplicateKey,
  nowIso,
  windowHours,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  windowHours: number;
}): SendReservation {
  const record = readReservation({ path: reservationPath({ duplicateKey, home }) });
  if (record !== undefined && isWithinWindow({ firstSentIso: record.reservedIso, nowIso, windowHours })) {
    return duplicateOf({ record });
  }
  return { kind: "fresh" };
}
