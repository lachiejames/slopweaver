/**
 * The `outlook-calendar` door's three reads (`live/outlookCalendar/read.ts`) over a plain fake seam: every page of
 * the calendar list with the default first, a window walked page by page up to its cap with the residue saying
 * when it stopped short, and one event labelled with the calendar Graph says holds it. The fake records each
 * request, so the paging asked for is asserted, not assumed.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import type { Page, PageStart } from "../../../../live/outlook/apiCore.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import type {
  CalendarEventsQuery,
  CalendarViewQuery,
  OutlookCalendarApi,
} from "../../../../live/outlookCalendar/api.js";
import {
  DEFAULT_CALENDAR_LABEL,
  holdingCalendarId,
  listOutlookCalendars,
  listOutlookCalendarWindow,
  readOutlookCalendarEvent,
  UNRESOLVED_CALENDAR_LABEL,
  windowResidue,
} from "../../../../live/outlookCalendar/read.js";
import type { GraphCalendar, GraphEvent, GraphEventRead } from "../../../../live/outlookCalendar/wire.js";

/** A Graph-hosted next link, which the seam is allowed to follow. */
const NEXT = "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=FIXTURE";

/** A timed UTC event with only the fields a window read uses. */
function timed({ id }: { id: string }): GraphEvent {
  return {
    end: { dateTime: "2001-01-08T08:00:00", timeZone: "UTC" },
    id,
    start: { dateTime: "2001-01-08T07:00:00", timeZone: "UTC" },
    subject: `Event ${id}`,
  };
}

/** A fake seam answering canned pages, recording each window request it was handed. */
function fakeApi({
  calendarPages = [],
  viewPages = [],
  event,
}: {
  calendarPages?: readonly Page<GraphCalendar>[];
  viewPages?: readonly Page<GraphEvent>[];
  event?: GraphEventRead;
}): { api: OutlookCalendarApi; viewRequests: PageStart<CalendarViewQuery>[] } {
  const viewRequests: PageStart<CalendarViewQuery>[] = [];
  let calendarCall = 0;
  const api: OutlookCalendarApi = {
    getEvent: async ({ eventId }) => {
      if (event === undefined || event.id !== eventId) {
        return err(OutlookErrors.apiFailed({ message: `no event ${eventId}` }));
      }
      return ok(event);
    },
    listCalendarView: async (requested) => {
      viewRequests.push(requested);
      return ok(viewPages[viewRequests.length - 1]!);
    },
    listCalendars: async () => {
      calendarCall += 1;
      return ok(calendarPages[calendarCall - 1]!);
    },
    listEvents: async (_requested: PageStart<CalendarEventsQuery>) => ok({ items: [], nextLink: undefined }),
  };
  return { api, viewRequests };
}

describe("listOutlookCalendars", () => {
  it("reads every page and puts the default calendar first", async () => {
    const { api } = fakeApi({
      calendarPages: [
        { items: [{ id: "birthdays", name: "Birthdays" }], nextLink: NEXT },
        { items: [{ canEdit: true, id: "main", isDefaultCalendar: true, name: "Calendar" }], nextLink: undefined },
      ],
    });
    const calendars = unwrap(await listOutlookCalendars({ api }));
    expect(calendars).toEqual([
      {
        canEdit: true,
        canViewPrivateItems: false,
        color: undefined,
        id: "main",
        isDefault: true,
        name: "Calendar",
        ownerName: undefined,
      },
      {
        canEdit: false,
        canViewPrivateItems: false,
        color: undefined,
        id: "birthdays",
        isDefault: false,
        name: "Birthdays",
        ownerName: undefined,
      },
    ]);
  });
});

describe("listOutlookCalendarWindow", () => {
  it("follows every page of the window and reports it complete", async () => {
    const { api, viewRequests } = fakeApi({
      viewPages: [
        { items: [timed({ id: "a" }), timed({ id: "b" })], nextLink: NEXT },
        { items: [timed({ id: "c" })], nextLink: undefined },
      ],
    });
    const window = unwrap(
      await listOutlookCalendarWindow({
        api,
        calendarId: undefined,
        endIso: "2001-01-15T00:00:00.000Z",
        limit: 50,
        startIso: "2001-01-08T00:00:00.000Z",
      }),
    );
    expect(window.events.map((event) => event.id)).toEqual(["a", "b", "c"]);
    expect(window.complete).toBe(true);
    expect(window.calendar).toBe(DEFAULT_CALENDAR_LABEL);
    expect(viewRequests).toEqual([
      {
        first: {
          calendarId: undefined,
          endIso: "2001-01-15T00:00:00.000Z",
          startIso: "2001-01-08T00:00:00.000Z",
          top: 50,
        },
      },
      { link: NEXT },
    ]);
  });

  it("stops at the limit with a link still standing and says the answer is incomplete", async () => {
    const { api, viewRequests } = fakeApi({
      viewPages: [{ items: [timed({ id: "a" }), timed({ id: "b" })], nextLink: NEXT }],
    });
    const window = unwrap(
      await listOutlookCalendarWindow({
        api,
        calendarId: "work",
        endIso: "2001-01-15T00:00:00.000Z",
        limit: 2,
        startIso: "2001-01-08T00:00:00.000Z",
      }),
    );
    expect(viewRequests).toHaveLength(1);
    expect(window.complete).toBe(false);
    expect(window.residue[0]).toBe(
      "INCOMPLETE: more events matched than the 2 read — narrow the window or raise --limit",
    );
    expect(window.residue[1]).toBe("only calendar work was read");
  });

  it("caps a limit above the ceiling at 1,000 events", async () => {
    const { api, viewRequests } = fakeApi({ viewPages: [{ items: [], nextLink: undefined }] });
    await listOutlookCalendarWindow({
      api,
      calendarId: undefined,
      endIso: "2001-01-15T00:00:00.000Z",
      limit: 5_000,
      startIso: "2001-01-08T00:00:00.000Z",
    });
    expect(viewRequests).toEqual([
      {
        first: {
          calendarId: undefined,
          endIso: "2001-01-15T00:00:00.000Z",
          startIso: "2001-01-08T00:00:00.000Z",
          top: 100,
        },
      },
    ]);
  });
});

describe("windowResidue", () => {
  it("names the unread calendars when the default one was read, and never claims incompleteness it did not see", () => {
    expect(windowResidue({ calendar: DEFAULT_CALENDAR_LABEL, complete: true, limit: 50 })).toEqual([
      "only the default calendar was read; an event on any other calendar is unread, not absent (`outlook-calendar calendars` lists them)",
      "recurring events are shown as the occurrences Microsoft computed for this window; `outlook-calendar read <series id>` shows the rule",
      "an event with no subject is busy time with no detail, never an empty hour",
    ]);
  });
});

describe("readOutlookCalendarEvent", () => {
  it("labels the event with the calendar Graph expanded", async () => {
    const event: GraphEventRead = { ...timed({ id: "e-1" }), calendar: { id: "calendar-regular-id" } };
    const { api } = fakeApi({ event });
    const read = unwrap(await readOutlookCalendarEvent({ api, eventId: "e-1" }));
    expect(read.calendarId).toBe("calendar-regular-id");
    expect(read.summary).toBe("Event e-1");
  });

  it("says the calendar is unresolved when Graph expanded none", () => {
    expect(holdingCalendarId({ event: timed({ id: "e-1" }) })).toBe(UNRESOLVED_CALENDAR_LABEL);
  });

  it("hands the seam's failure through", async () => {
    const { api } = fakeApi({});
    expect(unwrapErr(await readOutlookCalendarEvent({ api, eventId: "missing" })).message).toBe("no event missing");
  });
});
