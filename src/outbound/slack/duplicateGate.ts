/**
 * The FIRST real door gate: don't double-post.
 *
 * PR2 shipped `DEFAULT_GATES` empty on purpose. This is what fills it — and the shape every later gate
 * copies: a PURE `DoorGate` built over an already-gathered snapshot, so the decision is unit-testable
 * without a filesystem, and the gate itself can never do I/O mid-decision.
 *
 * It is a `warn`, never a `hold`. A repeated send is usually a mistake and occasionally deliberate, and the
 * door's contract is that a warn ALWAYS carries an override token — so the operator is stopped, told
 * exactly how to proceed, and proceeds if they meant it. A hold would make "post it again, I mean it"
 * impossible; a silent pass would double-post. Warn-plus-override is the only honest middle.
 *
 * Evidence direction, stated plainly: the door records its decision BEFORE the effect runs, so a send that
 * was admitted and then FAILED at the Slack call still leaves a `pass` in the ledger. This gate therefore
 * warns on a prior admitted attempt, not on a proven delivery — it can over-warn (you retry a failed send
 * and are asked to confirm) but it cannot under-warn (a real double-post never slips through silently).
 * For an irreversible action that is the correct direction to be wrong in.
 *
 * **The finding must therefore say which of the two it is, and where.** It used to say "this exact message
 * has already gone out to this target under this identity" in BOTH cases and name no target at all, which
 * is a claim the gate cannot support on the unconfirmed branch and gives an operator nothing to check on
 * either. Measured: a card whose first attempt died at Slack's own boundary with `channel_not_found`
 * left a reservation behind, and the wording told the owner the message had already gone out to that
 * target. It had not, and the sentence sent them looking for a destination-blind duplicate key — a bug that
 * does not exist, since {@link ./fingerprint.duplicateKey} has hashed the channel and thread since
 * the lane shipped (reproduce: two `slopweaver slack reply --as bot --dry-run --json` runs differing only
 * in `--channel` print different `duplicateKey`s). Naming the destination and separating "landed" from
 * "reserved, never confirmed" is what this file owes the operator; whether a dangling reservation should
 * expire at all is a separate question, tracked under `failed-send-leaves-dangling-reservation`.
 */
import type { DoorFinding, DoorGate } from "../../admit/types.js";
import type { SendReservation } from "./sendReservation.js";

/** The finding code a duplicate fires. */
export const DUPLICATE_SEND_CODE = "slack.duplicate-send";

/** The token `$SLOPWEAVER_DOOR_OVERRIDE` must carry to waive a duplicate warn. */
export const DUPLICATE_SEND_OVERRIDE = "slack.duplicate-send:v1";

/**
 * What is actually known about ONE prior send of the same key, inside the window.
 *
 * `sentTs` present ⇒ Slack confirmed the message and this is its timestamp, so the gate may say it landed.
 * Absent ⇒ the slot was claimed and nothing ever confirmed, so the only honest thing to say is that the
 * outcome is unknown. `destination` is the operator-facing target the reservation was taken against —
 * it is what makes "to this target" checkable rather than a phrase the reader has to take on trust.
 */
export interface PriorSend {
  /** The key this prior send was reserved under — matched against the request's own. */
  readonly duplicateKey: string;
  /** Where it was aimed, spelled for a human: a channel id, and the thread when there is one. */
  readonly destination: string;
  /** When the reservation was taken. */
  readonly firstSentIso: string;
  /** Slack's own message timestamp, present only once the send was CONFIRMED on the wire. */
  readonly sentTs?: string | undefined;
}

/** The warn finding for a re-send the gate can prove landed. Pure. */
function landedFinding({ prior, windowHours }: { prior: PriorSend; windowHours: number }): DoorFinding {
  return {
    code: DUPLICATE_SEND_CODE,
    correction:
      `an identical message landed in ${prior.destination} at ${prior.firstSentIso} ` +
      `(ts ${String(prior.sentTs)}), inside the last ${String(windowHours)}h. Change the message, or — if the ` +
      `repeat is deliberate — re-run with SLOPWEAVER_DOOR_OVERRIDE=${DUPLICATE_SEND_OVERRIDE}`,
    override: DUPLICATE_SEND_OVERRIDE,
    severity: "warn",
    summary: `this exact message has already gone out to ${prior.destination} under this identity`,
  };
}

/**
 * The warn finding for a prior attempt nothing ever confirmed. Pure.
 *
 * The remedy is the LANE's to name, because the lanes differ: `slack post|reply` take `--resend-unconfirmed`,
 * which states "I read the target and it is not there" and nothing more, while a poll has only the override.
 * Telling a card operator to reach for the override here was measured wrong: the override means
 * "repeat it regardless", and the send it admitted was then refused one line later by the reservation itself.
 */
function unconfirmedFinding({
  prior,
  windowHours,
  unconfirmedRemedy,
}: {
  prior: PriorSend;
  windowHours: number;
  unconfirmedRemedy: string;
}): DoorFinding {
  return {
    code: DUPLICATE_SEND_CODE,
    correction:
      `an identical message was reserved for ${prior.destination} at ${prior.firstSentIso}, inside the last ` +
      `${String(windowHours)}h, and never confirmed — read ${prior.destination} before retrying. If nothing ` +
      `landed there, ${unconfirmedRemedy}`,
    override: DUPLICATE_SEND_OVERRIDE,
    severity: "warn",
    summary: `an identical message to ${prior.destination} was reserved but never confirmed — it may never have been sent`,
  };
}

/**
 * The HOLD finding for a second delivery of a keyed one. Pure.
 *
 * A hold rather than a warn, and the difference is the whole of what a delivery key buys. A content
 * duplicate is usually a mistake and occasionally deliberate, so the door stops the operator and lets them
 * proceed — there IS an operator. A keyed duplicate is a second delivery of a firing whose caller has
 * already asserted it happens exactly once, and that caller is a schedule with nobody watching it: an
 * override nobody reads is not a safeguard, it is the double-post the key exists to prevent.
 *
 * **It therefore carries no override, and says so** — `error-handling.md`: a hold has no hatch, and silence
 * reads as a forgotten one, so it names the absence and the fix. The fix is real rather than a shrug: the
 * firing is already delivered or already unknown, and `live/automation/slotAttempt.ts` retires it to a
 * dead-letter board row where a person decides, which is the honest end for a delivery nobody can prove.
 */
function keyedFinding({ prior }: { prior: PriorSend }): DoorFinding {
  return {
    code: DUPLICATE_SEND_CODE,
    correction:
      `this delivery was already reserved for ${prior.destination} at ${prior.firstSentIso} under its own ` +
      "idempotency key, so the schedule has already delivered this firing once. There is NO override for " +
      "this one, deliberately: nobody is watching a scheduled send, so it would admit the second post it " +
      "refuses. The firing retires to a dead-letter board row instead — read the channel, and if nothing " +
      "landed there, post it by hand or let the next firing carry it.",
    severity: "hold",
    summary: `this exact delivery has already been made to ${prior.destination} under its idempotency key`,
  };
}

/** The remedy `slack post|reply` name for an unconfirmed prior: the flag that exists for exactly this. */
export const RESEND_UNCONFIRMED_REMEDY = "re-run with --resend-unconfirmed";

/** The remedy a lane with no resend flag names: the override, which repeats regardless. */
export const OVERRIDE_REMEDY = `re-run with SLOPWEAVER_DOOR_OVERRIDE=${DUPLICATE_SEND_OVERRIDE}`;

/**
 * Build the duplicate-send gate over what is known about ONE prior send. The gate matches on the request's
 * own `duplicateKey` artifact field, and the caller gathers that prior per action label, so one noun's
 * sends never shadow another's.
 *
 * @param prior the prior send inside the window, or `null` when there is none
 * @param windowHours the window that prior was gathered over (quoted in the correction)
 * @param unconfirmedRemedy what the operator re-runs with once they have read the target and found it empty
 * @param keyed whether the request's key came from a caller-supplied delivery identity, which HOLDS
 * @returns the pure gate
 */
export function duplicateSendGate({
  prior,
  windowHours,
  unconfirmedRemedy,
  keyed = false,
}: {
  prior: PriorSend | null;
  windowHours: number;
  unconfirmedRemedy: string;
  keyed?: boolean;
}): DoorGate {
  return (request) => {
    const key = request.artifact["duplicateKey"];
    if (prior === null || typeof key !== "string" || key !== prior.duplicateKey) {
      return [];
    }
    // The action label is not re-checked here: `prior` is gathered per action label by the caller, so a key
    // matching it is by construction a prior send of the same verb.
    if (keyed) {
      return [keyedFinding({ prior })];
    }
    if (prior.sentTs === undefined) {
      return [unconfirmedFinding({ prior, unconfirmedRemedy, windowHours })];
    }
    return [landedFinding({ prior, windowHours })];
  };
}

/**
 * The operator-facing name of a send's destination: the channel, and the thread when there is one.
 *
 * One spelling, here, because three lanes build the same sentence and a fourth wording would make the
 * warning read as being about a different place than the one it is about.
 *
 * @param channel the destination channel id
 * @param threadTs the parent timestamp when replying in a thread
 * @returns the destination as a human reads it back
 */
export function destinationLabel({ channel, threadTs }: { channel: string; threadTs?: string | undefined }): string {
  return threadTs === undefined ? channel : `${channel} (thread ${threadTs})`;
}

/**
 * The prior send a peeked reservation describes, or `null` when there is none — the ONE adapter from the
 * reservation store to what the gate says out loud.
 *
 * All three lanes (card, drip, poll) peek the same store and want the same sentence, so the mapping lives
 * here rather than three times at the call sites. It is the mapping that decides whether the warning claims
 * a delivery, so a second copy would be a second chance to claim one the store cannot support.
 *
 * @param reservation what {@link ./sendReservation.peekSend} returned for this key
 * @param duplicateKey the key the gate matches the request against
 * @param destination where the send is aimed, as {@link destinationLabel} spells it
 * @returns the prior send to warn about, or `null` to pass
 */
export function priorSendFrom({
  reservation,
  duplicateKey,
  destination,
}: {
  reservation: SendReservation;
  duplicateKey: string;
  destination: string;
}): PriorSend | null {
  if (reservation.kind !== "duplicate") {
    return null;
  }
  return {
    destination,
    duplicateKey,
    firstSentIso: reservation.firstSentIso,
    ...(reservation.sentTs !== undefined ? { sentTs: reservation.sentTs } : {}),
  };
}
