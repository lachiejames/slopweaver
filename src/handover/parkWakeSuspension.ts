/**
 * Whether a standing park's WAKE is suspended on the owner's open question — the `park-wake-suspended` line
 * `handover wake` writes once the pull request a park waited on has merged while the run waits on the owner.
 *
 * The suspension is a projection, never a stored flag, and it is bound by journal POSITION: it holds only while a
 * question is open AND no line after it touches what the run waits on — a fresh ask, an answer, a withdrawal, a
 * correction, a reshape, an offer, a reconfirmation, a ruling, or a message queued for the seat. Any of those lifts it
 * with no line of its own, and the wake reseats the seat that may now have something to do (a
 * park answered after it parked must still reseat). Two comparisons that read as enough are refused: the park's own `question` field is the snapshot it was written with and outlives every answer, and the
 * question's text plus its asked instant is not monotonic — a correction from A to B and back to A, or a fresh
 * identical ask stamped in the same millisecond, would re-arm an old suspension without a new judgement.
 *
 * Pure: events in, a verdict out. It reads no park itself, so `./parked.ts` can call it without a cycle.
 */

import { heldQuestion } from "./heldQuestion.js";
import type { RunEvent } from "./ledger.js";
import type { ParkWakeSuspendedEvent } from "./parkedEvent.js";

/**
 * Every kind whose line, after a suspension, lifts it: each changes what the run waits on, or carries the owner's
 * word to the seat — a ruling is what a reseat is for, and a queued message is delivered only by a seat.
 */
const LIFTS_SUSPENSION: ReadonlySet<RunEvent["kind"]> = new Set<RunEvent["kind"]>([
  "question",
  "question-corrected",
  "question-shaped",
  "question-offered",
  "question-reconfirmed",
  "question-withdrawn",
  "answered",
  "ruling",
  "said",
]);

/**
 * Every kind that carries the owner's word to a closed seat, which only a reseat delivers — so one standing after the
 * park means its wake has work, whatever the question, and no suspension may be written over it (a `said`
 * landing during the head read would otherwise be masked by the suspension appended after it).
 */
const OWNER_WORD: ReadonlySet<RunEvent["kind"]> = new Set<RunEvent["kind"]>([
  "answered",
  "question-withdrawn",
  "ruling",
  "said",
]);

/**
 * The first line after the park at `parkIndex` that carries the owner's word to the seat, when one stands there.
 *
 * @param events the journal's events, in order
 * @param parkIndex the standing park's position in the whole journal
 * @returns that line, or `undefined` when nothing has been said to the seat since it parked
 */
export function ownerWordSincePark({
  events,
  parkIndex,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
}): RunEvent | undefined {
  return events.slice(parkIndex + 1).find((event) => OWNER_WORD.has(event.kind));
}

/**
 * Whether a line lifts a suspension written before it — and so, landing between the wake's judgement and its append,
 * means the suspension must not be written at all.
 *
 * @param event the journal line
 * @returns true when the line changes what the run waits on or carries the owner's word to the seat
 */
export function liftsSuspension({ event }: { event: RunEvent }): boolean {
  return LIFTS_SUSPENSION.has(event.kind);
}

/**
 * The suspension holding the wake of the park at `parkIndex` now: the last `park-wake-suspended` after it naming
 * exactly that position, provided a question is open, nothing has been said to the seat since the park, and no line
 * past the journal length the wake JUDGED at lifts it — read on both sides of the suspension, because the append's
 * read and its write are not one atomic step, so a line can land between them and sit before the suspension.
 *
 * @param events the journal's events, in order
 * @param parkIndex the standing park's position in the whole journal
 * @returns the suspension that holds, or `undefined` when the park's wake is live
 */
export function parkWakeSuspension({
  events,
  parkIndex,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
}): ParkWakeSuspendedEvent | undefined {
  if (heldQuestion({ events }) === undefined) {
    return undefined;
  }
  const at = events.findLastIndex(
    (event, index) => index > parkIndex && event.kind === "park-wake-suspended" && event.parkIndex === parkIndex,
  );
  const suspension = events[at];
  if (suspension?.kind !== "park-wake-suspended") {
    return undefined;
  }
  if (ownerWordSincePark({ events, parkIndex }) !== undefined) {
    return undefined;
  }
  const judgedFrom = Math.min(suspension.judgedLength, at);
  return events.slice(judgedFrom).some((event) => liftsSuspension({ event })) ? undefined : suspension;
}

/**
 * Why a `park-wake-suspended` about to be written must be refused: it names a position other than the standing
 * park's, the owner has said something to the seat since it parked, or it names a question that is not the one
 * open now — either way it would suspend nothing, or a wake that has work to wake for.
 *
 * @param event the event about to be written
 * @param events the whole journal as it stands
 * @param standingIndex the standing park's position, or `undefined` when no park stands
 * @returns the reason, or `undefined` when the event is no suspension or binds the park and question that stand
 */
export function straySuspensionReason({
  event,
  events,
  standingIndex,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
  standingIndex: number | undefined;
}): string | undefined {
  if (event.kind !== "park-wake-suspended") {
    return undefined;
  }
  if (standingIndex !== event.parkIndex) {
    return `no park stands at position ${String(event.parkIndex)}, so there is no wake this suspends`;
  }
  if (event.judgedLength > events.length || event.judgedLength <= event.parkIndex) {
    return `it names a judged length of ${String(event.judgedLength)} lines, outside the park and the ${String(events.length)} the journal holds`;
  }
  const word = ownerWordSincePark({ events, parkIndex: event.parkIndex });
  if (word !== undefined) {
    return `the ${word.kind} line at ${word.atIso} came after the park, and only a reseat carries it to the seat`;
  }
  const open = heldQuestion({ events });
  if (open === undefined) {
    return "no question is open, so the wake has work to wake for and nothing to wait on";
  }
  if (open.question !== event.question || open.askedIso !== event.questionAskedIso) {
    return `the question open now (asked ${open.askedIso}) is not the one this names, so it would suspend the wake on a question nobody is waiting on`;
  }
  return undefined;
}
