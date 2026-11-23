/**
 * Two lifecycle facts a run journal answers that no single event states: whether its last dispatch was ever
 * picked up, and who last vouched for it.
 *
 * ## Why these need a module at all
 *
 * Measured across four incidents, every journal event that names a writer is written by the
 * SUBJECT of the work, and no event ever records an ABSENCE. A dispatch that never took leaves no entry at all,
 * and a run that closed itself reads exactly like one somebody else signed. Both answers are therefore derived
 * across the whole journal here, once, rather than re-derived by each verb that needs them — `handover abandon`
 * asks the first (`../cli/commands/handover/lifecycleRunCore.ts`), the finish ending reports the second
 * (`../cli/commands/handover/finishEnding.ts`).
 *
 * Neither is a notification. What needs the owner belongs on the console's Queue page, drawn from the same
 * journals; nothing here posts anywhere (a blocked-on-the-owner row never DMs them).
 *
 * ## Pure throughout
 *
 * No filesystem, no clock. The caller enumerates the journal and hands over its events.
 */

import type { RunEvent } from "./ledger.js";

/**
 * Whether a dispatch was ever picked up, judged over the WHOLE journal rather than the current cycle.
 *
 * Deliberately not `currentCycle`: that slices from the last `started`, so a dispatch which was never followed
 * by a `started` sits outside every cycle it could be compared against, and the one question being asked here —
 * did anything start AFTER this dispatch — would be unanswerable by construction.
 *
 * @param events the journal's events, in order
 * @returns the index of the last dispatch and whether anything started after it
 */
function dispatchPickup({ events }: { events: readonly RunEvent[] }):
  | {
      dispatch: Extract<RunEvent, { kind: "dispatched" }>;
      pickedUp: boolean;
    }
  | undefined {
  const at = events.map((event) => event.kind).lastIndexOf("dispatched");
  // `findLast` rather than an index lookup so the variant narrows on its own predicate: reading `events[at]`
  // yields the whole union again, and re-narrowing it would need an assertion the type already forbids.
  const dispatch = events.findLast((event) => event.kind === "dispatched");
  if (dispatch === undefined) {
    return undefined;
  }
  return {
    dispatch,
    // Cleared by anything that shows a HUMAN OR SESSION acted on the dispatch, not only by a pickup. A start or
    // a launch is the happy path; a `finished` or `abandoned` after the dispatch means somebody dealt with it
    // deliberately, and continuing to report that as an unanswered dispatch would be false.
    //
    // No expiry window: an unresolved dispatch SHOULD persist until someone acts, and `handover abandon` is the
    // typed way to say "this dispatch is not happening", which clears it here.
    pickedUp: events
      .slice(at + 1)
      .some(
        (event) =>
          event.kind === "started" ||
          event.kind === "launched" ||
          event.kind === "finished" ||
          event.kind === "closed" ||
          event.kind === "abandoned",
      ),
  };
}

/**
 * Whether a dispatch is still awaiting any response — a no-show, however recent.
 *
 * Deliberately window-free: nothing about a grace period has any business gating whether a supervisor may
 * deliberately give up on a dispatch. Measured against a real `cmux spawn`: a journal holding only a
 * `dispatched` event reports phase `closed`, so `handover abandon` refused it with "no run is open" — the one
 * state a no-show describes could not be cleared through the front door until this landed.
 *
 * @param events the journal's events, in order
 * @returns true when the last dispatch has had no start, launch or closure after it
 */
export function hasUnansweredDispatch({ events }: { events: readonly RunEvent[] }): boolean {
  const pickup = dispatchPickup({ events });
  return pickup !== undefined && !pickup.pickedUp;
}

/**
 * The most recent sign-off on a run, for a caller reporting who last vouched for it.
 *
 * The LAST one, because a later sign-off supersedes an earlier one — a run signed, reopened and signed again
 * should report the current signature rather than the first one ever recorded.
 *
 * @param events the journal's events, in order
 * @returns who signed and when, or `undefined` when nobody has
 */
export function lastSignOff({ events }: { events: readonly RunEvent[] }): { by: string; atIso: string } | undefined {
  // `findLast` narrows on the predicate, so no assertion is needed to reach the variant's own fields.
  const event = events.findLast((one) => one.kind === "signed-off");
  return event === undefined ? undefined : { atIso: event.atIso, by: event.by };
}
