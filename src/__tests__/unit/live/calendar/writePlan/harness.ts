/*
 * What the calendar write-plan test files share: the owner's bound address, the account's zone, an intent built
 * over a form, and a minimal inward booking. They moved here when the write plan's one test file was split by
 * behaviour.
 */
import type { calendar_v3 } from "@googleapis/calendar";
import type { CalendarIntent } from "../../../../../live/calendar/writePlan.js";
import type { CalendarBookForm, CalendarWriteForm } from "../../../../../outbound/calendar/form.js";

export const ME = "me@x.test";
export const ZONE = "Australia/Melbourne";

/**
 * An intent over a form, with an optional `before` snapshot.
 *
 * @returns a pending calendar intent on the owner's primary calendar
 */
export function intentFor({
  form,
  before,
  eventId = "evt-1",
}: {
  form: CalendarWriteForm;
  before?: { etag: string; event: calendar_v3.Schema$Event };
  eventId?: string;
}): CalendarIntent {
  return {
    account: ME,
    before,
    calendarId: "primary",
    createdAtIso: "2026-09-13T04:00:00.000Z",
    eventId,
    form,
    intentId: "intent-1",
    state: "pending",
    version: 1,
  };
}

// Typed as the booking form itself: an exported const keeps only its declared type, so a wider annotation would
// lose the `book` narrowing the old file's local const got from its own initialiser.
export const BOOK: CalendarBookForm = {
  attendees: [],
  description: undefined,
  kind: "book",
  location: undefined,
  meet: false,
  span: { allDay: false, end: "2026-09-20T10:30", start: "2026-09-20T10:00", zone: undefined },
  title: "Sync",
};
