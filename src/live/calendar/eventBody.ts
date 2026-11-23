/**
 * Fragments of the event body a calendar write sends Google: a form's span as Google's `start`/`end` pair, and
 * one guest's entry in a rewritten attendee set. `writePlan.ts` assembles whole bodies from these. Pure — no
 * I/O, no clock, no network.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import type { EventSpan } from "../../outbound/calendar/form.js";

/**
 * Turn a span into Google's `start`/`end` pair — a local `dateTime` plus `timeZone`, or bare dates with
 * the end made exclusive.
 *
 * @param span the form's span
 * @param zone the account's zone, used when the span names none
 * @returns the two `EventDateTime`s
 */
export function spanToEventTimes({ span, zone }: { span: EventSpan; zone: string }): {
  start: calendar_v3.Schema$EventDateTime;
  end: calendar_v3.Schema$EventDateTime;
} {
  if (span.allDay) {
    return { end: { date: nextDate({ date: span.end }) }, start: { date: span.start } };
  }
  const timeZone = spanZone({ span, zone });
  return {
    end: { dateTime: `${span.end}:00`, timeZone },
    start: { dateTime: `${span.start}:00`, timeZone },
  };
}

/**
 * The zone a timed span's wall-clock times are read in. A form carries a zone only when its caller gave one,
 * and `EventSpan` declares that a span without one is read in the account's own zone.
 */
function spanZone({ span, zone }: { span: EventSpan; zone: string }): string {
  if (span.zone === undefined) {
    return zone;
  }
  return span.zone;
}

/** The calendar date after `date`, as `YYYY-MM-DD` — Google's exclusive all-day end. */
function nextDate({ date }: { date: string }): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

/**
 * One guest's entry in a rewritten attendee set. A guest already on the event keeps the entry Google holds, and
 * with it their RSVP; an address the event does not carry yet is somebody being INVITED, so they get a fresh
 * entry naming only the address.
 *
 * @returns the existing guest entry, or a new address-only entry
 */
export function keptOrNewGuest({
  byEmail,
  email,
}: {
  byEmail: ReadonlyMap<string | undefined, calendar_v3.Schema$EventAttendee>;
  email: string;
}): calendar_v3.Schema$EventAttendee {
  const kept = byEmail.get(email);
  if (kept === undefined) {
    return { email };
  }
  return kept;
}
