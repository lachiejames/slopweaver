/**
 * The arrival fold — the one rule that decides whether the owner keeps this lane switched on.
 *
 * A monitor posts a step when its subject set GAINS a member, and at no other time. Not on persistence, not
 * on departure, and **never on age**: there is no clock read anywhere in this file. A wait on a person is a
 * STATE and not a countdown, made mechanical — a lane that re-pinged every fifteen minutes about a pull
 * request the owner already knows about is one they switch off, and switching it off takes the case it
 * exists for with it.
 *
 * ## The hand register IS the memory, and that is the design rather than a shortcut
 *
 * A separate `monitor-state.jsonl` recording what each monitor has told the owner is the wrong build:
 * `src/hand/` already holds exactly that fact, as OPEN steps, and it holds it better — a step the owner
 * settled with `hand done` leaves the open set, so the same subject arriving again next week is a genuine
 * arrival rather than a row some other file still calls told. A parallel ledger would have to be kept in
 * step with the owner's own dismissals, and the first time the two disagreed they would get a card about
 * something they had already closed. So `told` below is DERIVED from the register on every pass, never stored.
 *
 * Pure: two sets in, a decision out. No I/O, no clock.
 */

import type { MonitorSubject } from "./types.js";

/** What one pass decided, before a card is composed from it. */
export interface ArrivalDecision {
  /** Subjects present now that the register holds no open step for. */
  readonly arrived: readonly MonitorSubject[];
  /** Open step ids whose subject is no longer present — the steps this pass settles. */
  readonly departed: readonly string[];
}

/**
 * Fold what a monitor sees now against the steps already open for it.
 *
 * **Departures matter as much as arrivals.** A monitor that only ever posted would leave a step open for a
 * pull request that landed hours ago, and a register carrying steps that are no longer true is one the owner stops
 * believing — which costs more than the missed card, because it costs every other card too.
 *
 * @param current every subject the monitor's condition holds over right now
 * @param openStepIds the hand-step ids currently open for THIS monitor
 * @param stepIdOf how a subject becomes a step id, injected so this stays pure and the registry owns the shape
 * @returns what arrived and which open steps to settle
 */
export function foldArrivals({
  current,
  openStepIds,
  stepIdOf,
}: {
  current: readonly MonitorSubject[];
  openStepIds: ReadonlySet<string>;
  stepIdOf: (options: { subject: MonitorSubject }) => string;
}): ArrivalDecision {
  const arrived = current.filter((subject) => !openStepIds.has(stepIdOf({ subject })));
  const present = new Set(current.map((subject) => stepIdOf({ subject })));
  const departed = Array.from(openStepIds).filter((id) => !present.has(id));
  return { arrived, departed };
}
