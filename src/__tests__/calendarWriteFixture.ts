/**
 * The fakes a calendar write test drives the effectful half with: the bound account, its zone and clock, one booking
 * form, a read seam answering a fixed event, and a write seam recording every mutation it is asked for.
 */
import type { calendar_v3 } from "@googleapis/calendar";
import { err, ok, type Result } from "../lib/result.js";
import type { CalendarApi } from "../live/calendar/api.js";
import type { CalendarError } from "../live/calendar/errors.js";
import type { CalendarWriteApi } from "../live/calendar/writeApi.js";
import type { CalendarWriteForm } from "../outbound/calendar/form.js";

/** The account the grant is bound to. */
export const ME = "me@x.test";

/** The calendar's own time zone. */
export const ZONE = "Australia/Melbourne";

/** The fixed instant a prepared intent records. */
export const NOW = "2026-09-13T04:00:00.000Z";

/** One plain booking with a single attendee and no conference. */
export const BOOK: CalendarWriteForm = {
  attendees: ["a@x.test"],
  description: undefined,
  kind: "book",
  location: undefined,
  meet: false,
  span: { allDay: false, end: "2026-09-20T10:30", start: "2026-09-20T10:00", zone: undefined },
  title: "Sync",
};

/**
 * A read seam answering one fixed event, or a fixed failure.
 *
 * @param event what `getEvent` answers when no failure is given
 * @param failure what `getEvent` answers instead, when given
 * @returns the read seam a prepare, commit or apply reads Google through
 */
export function readApi({
  event = {},
  failure,
}: {
  event?: calendar_v3.Schema$Event;
  failure?: CalendarError;
}): CalendarApi {
  return {
    getEvent: async () => (failure === undefined ? ok(event) : err(failure)),
    getTimeZone: async () => ok(ZONE),
    listCalendars: async () => ok({ calendars: [], nextPageToken: undefined }),
    listEvents: async () => ok({ events: [], nextPageToken: undefined, nextSyncToken: undefined, timeZone: ZONE }),
  };
}

/**
 * A write seam recording every call and answering a fixed result.
 *
 * @param calls the log each mutation appends its kind and `sendUpdates` to
 * @param answer what every mutation answers; a delete answers only its success or failure
 * @returns the write seam an apply sends its one mutation through
 */
export function writeApi({
  calls,
  answer,
}: {
  calls: { kind: string; sendUpdates: string }[];
  answer: Result<calendar_v3.Schema$Event, CalendarError>;
}): CalendarWriteApi {
  return {
    deleteEvent: async ({ sendUpdates }) => {
      calls.push({ kind: "delete", sendUpdates });
      return answer.isErr() ? err(answer.error) : ok(undefined);
    },
    insertEvent: async ({ sendUpdates }) => {
      calls.push({ kind: "insert", sendUpdates });
      return answer;
    },
    patchEvent: async ({ sendUpdates }) => {
      calls.push({ kind: "patch", sendUpdates });
      return answer;
    },
  };
}
