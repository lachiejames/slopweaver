/**
 * The two journal events DECIDED about a run's holder from one read and appended after another — `orphaned`
 * (a reap) and `parked` (a seat closed on the owner's question) — and why each no longer describes the run it would
 * end. `./rowEventRefusal.ts`'s `forbiddenTransition` refuses either one when the run moved in between.
 */
import type { RunEvent } from "./ledger.js";
import { parkHolder } from "./parkPolicy.js";
import { writerOf } from "./runOwner.js";

/**
 * Why an `orphaned` or `parked` event no longer names the run it was decided about — `undefined` when it
 * still does, or when the event is neither kind.
 *
 * @param event the event about to be written
 * @param cycle the current cycle's events, which a reap is decided over
 * @param events the whole journal, which a park's holder is read from
 * @returns the reason the append is refused, or `undefined`
 */
export function staleHolderReason({
  event,
  cycle,
  events,
}: {
  event: RunEvent;
  cycle: readonly RunEvent[];
  events: readonly RunEvent[];
}): string | undefined {
  if (event.kind === "orphaned") {
    return staleOrphanReason({ cycle, event });
  }
  if (event.kind === "parked") {
    return staleParkReason({ event, events });
  }
  return undefined;
}

/**
 * Why a `parked` event no longer names the run's holder — `undefined` when it still does.
 *
 * A park is decided from one read of the journal and appended after the cmux reads that follow it. A claim
 * landing in between hands the run to a session the `parked` event does not name. That event would then release
 * nobody, while the verb still closed a seat. So the session it names must still be the
 * run's holder as the journal stands at the append. The read-to-append window is the same accepted residue
 * {@link staleOrphanReason} states.
 */
function staleParkReason({
  event,
  events,
}: {
  event: Extract<RunEvent, { kind: "parked" }>;
  events: readonly RunEvent[];
}): string | undefined {
  const holder = parkHolder({ events });
  if (holder === undefined) {
    return "no session holds this run now, so there is no seat this park could release";
  }
  if (holder.sessionId !== event.sessionId) {
    return `the run is now held by ${holder.sessionId}, not ${event.sessionId}; the park was decided about a run that has since changed hands`;
  }
  return undefined;
}

/**
 * Why an `orphaned` event no longer describes the cycle it would close — `undefined` when it still does.
 *
 * A reap is DECIDED from one read of the journal and appended after another. A claim, a resume or any other
 * event landing in between means the decision was about a cycle that has since moved, and closing it anyway
 * would end a run a live session had just taken over. So both facts the event carries — whose cycle it was,
 * and where it had got to — are compared against the cycle as it stands at the append.
 *
 * ACCEPTED RESIDUE, named by an adversarial review pass rather than discovered later: this closes the ORDINARY
 * stale-plan window and not the last one. The check reads the journal, then `./rowEvent.ts`'s `applyRowEvent`
 * appends through `appendFileSync`, so an event landing between those two operations is seen by neither — the
 * read-back that follows REPORTS the mismatch and cannot undo the line. That window is a property of the
 * filesystem backend rather than of this rule (`./runStore.ts` takes no lock), closing it means serialising
 * every row writer, and the same residue is already stated in `./rowEvent.ts`'s header. What changed is that a
 * reap decided against a cycle which has since moved is now refused in the common case instead of silently
 * closing it.
 */
function staleOrphanReason({
  cycle,
  event,
}: {
  cycle: readonly RunEvent[];
  event: Extract<RunEvent, { kind: "orphaned" }>;
}): string | undefined {
  const writer = writerOf({ events: cycle })?.sessionId;
  // Absence is its OWN arm rather than a sentinel string: a placeholder like "nobody" is a session id the
  // schema accepts, so an event naming it would have matched a writerless cycle and closed it.
  if (writer === undefined) {
    return "the cycle names no writer, so there is no session whose ending this could be";
  }
  if (writer !== event.deadSessionId) {
    return `the cycle's writer is now ${writer}, not ${event.deadSessionId}; the reap was decided about a run that has since changed hands`;
  }
  // The COUNT is the identity check and the timestamp is only a second opinion: two valid events may carry
  // one instant, so a cycle that gained an event in the same millisecond reads as untouched by time alone.
  // The field is OPTIONAL on the type so a journal written before it existed still parses, and REQUIRED here
  // so a new write cannot opt out of the check by omitting it — found by an adversarial review pass.
  if (event.cycleEvents === undefined) {
    return "this ending names no cycle event count, so nothing here can tell whether the cycle moved since the reap was decided";
  }
  if (event.cycleEvents !== cycle.length) {
    return `the cycle now holds ${String(cycle.length)} event(s), not the ${String(event.cycleEvents)} the reap was decided over; it moved since`;
  }
  const last = cycle.at(-1);
  // A cycle naming a writer holds an event, so this arm is the invariant's, and it refuses rather than guess.
  if (last === undefined) {
    return "the cycle holds no event, so nothing here can tell whether it moved since the reap was decided";
  }
  if (last.atIso !== event.lastEventIso) {
    return `the cycle's last event is now at ${last.atIso}, not ${event.lastEventIso}; it moved after the reap was decided`;
  }
  return undefined;
}
