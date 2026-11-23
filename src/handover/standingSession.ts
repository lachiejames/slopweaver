/**
 * Whether a row's seat is a STANDING SESSION right now — the owner's ruling that it stays open between their turns
 * (`./standingSessionTypes.ts`). Three readers ask it: `session close-done` before it parks a seat at rest,
 * `handover park` before it journals a park, and the chair's reconcile, which turns a standing row found parked into
 * one ready to seat again.
 *
 * ## Which ruling decides
 *
 * The latest LIVE ruling that CARRIES a standing session, by decision instant. Two choices there, each the design:
 *
 * - **An ordinary ruling does not end it.** Unlike an explicit steer, which is about one instance and yields to the
 *   owner's newest word, a standing session is about the seat the owner keeps talking to — and talking to it is
 *   exactly what produces more rulings on its row. Ending the session on the first unrelated ruling would close the
 *   seat the next time the owner decided anything there. It ends at its `untilIso`, or when a later standing-session ruling names an
 *   `untilIso` already past (`handover rule … --standing-session --standing-until <now>`).
 * - **A reconstruction neither makes nor ends one.** The write schema and the decoder both refuse a backfilled line
 *   carrying the field, and this read skips reconstructions whole, so a backfill can keep no seat open.
 *
 * Pure: events and an instant in, a ruling out. No filesystem, no clock.
 */
import type { RulingEvent, RunEvent } from "./ledger.js";
import { rulingDecisionOrder } from "./ruling.js";
import type { StandingSession } from "./standingSessionTypes.js";

/** A ruling that carries a standing session, the field known present. */
export type StandingSessionRuling = RulingEvent & { readonly standingSession: StandingSession };

/** Whether a ruling is a live one carrying a standing session. */
function isStandingSessionRuling(event: RunEvent): event is StandingSessionRuling {
  return event.kind === "ruling" && event.standingSession !== undefined && event.backfilledFrom === undefined;
}

/**
 * The row's latest live standing-session ruling, by decision instant — in force or not. Ties go to the later line,
 * the append-order rule the rest of the register uses.
 *
 * @param events the row's journal events, in order
 * @returns the ruling, or `undefined` when the owner never made this row's seat a standing session
 */
export function standingSessionRuling({ events }: { events: readonly RunEvent[] }): StandingSessionRuling | undefined {
  let standing: StandingSessionRuling | undefined;
  let order = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!isStandingSessionRuling(event)) {
      continue;
    }
    const placed = rulingDecisionOrder({ event });
    if (placed >= order) {
      standing = event;
      order = placed;
    }
  }
  return standing;
}

/**
 * Whether one standing-session ruling still holds at an instant: no `untilIso` holds until a later ruling ends it,
 * and an `untilIso` holds strictly before it. Both instants are PARSED, never compared as text. An instant that does
 * not parse cannot be ordered, and reads as still standing: the expensive direction to be wrong in is closing the
 * seat the owner asked to keep.
 *
 * @param nowIso the instant to judge against
 * @param ruling the standing-session ruling
 * @returns true while the seat stands
 */
export function standingSessionHolds({ nowIso, ruling }: { nowIso: string; ruling: StandingSessionRuling }): boolean {
  const { untilIso } = ruling.standingSession;
  if (untilIso === undefined) {
    return true;
  }
  const until = Date.parse(untilIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(until) || Number.isNaN(now)) {
    return true;
  }
  return now < until;
}

/**
 * The standing-session ruling in force on a row at an instant.
 *
 * @param events the row's journal events, in order
 * @param nowIso the instant to judge against
 * @returns the ruling keeping the seat open, or `undefined` when nothing does
 */
export function standingSessionInForce({
  events,
  nowIso,
}: {
  events: readonly RunEvent[];
  nowIso: string;
}): StandingSessionRuling | undefined {
  const ruling = standingSessionRuling({ events });
  if (ruling === undefined || !standingSessionHolds({ nowIso, ruling })) {
    return undefined;
  }
  return ruling;
}

/**
 * One line naming the ruling that keeps a seat open, for a keep or a refusal to print.
 *
 * @param ruling the standing-session ruling in force
 * @returns the line
 */
export function standingSessionLine({ ruling }: { ruling: StandingSessionRuling }): string {
  const { untilIso } = ruling.standingSession;
  const until = untilIso === undefined ? "until the owner ends it" : `until ${untilIso}`;
  return `the owner's standing-session ruling keeps this seat open ${until} (anchor ${ruling.anchor})`;
}
