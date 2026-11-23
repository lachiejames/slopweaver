/**
 * Unit: the three Calendar read document builders, over a plain fake seam. What is asserted is the part a
 * caller cannot re-derive — the coverage detail, the residue lines, and the cross-calendar ordering that
 * Google does not do for you.
 */
import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it } from "vitest";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { CalendarApi } from "../../../../live/calendar/api.js";
import { type CalendarError, CalendarErrors } from "../../../../live/calendar/errors.js";
import { readCalendarEvent, readCalendarListing, readCalendarVocabulary } from "../../../../live/calendar/read.js";

const NOW = "2026-09-05T00:00:00.000Z";
const nowIso = (): string => NOW;

function event({ id, start, summary }: { id: string; start: string; summary?: string }): calendar_v3.Schema$Event {
  return {
    end: { dateTime: start },
    id,
    start: { dateTime: start },
    status: "confirmed",
    ...(summary !== undefined ? { summary } : {}),
  };
}

/** A seam whose pages are supplied per calendar, so cross-calendar ordering can be exercised. */
function fakeApi({
  byCalendar = {},
  calendars = [
    {
      accessRole: "owner",
      description: undefined,
      id: "primary",
      primary: true,
      selected: true,
      summary: "Me",
      timeZone: "Australia/Sydney",
    },
  ],
  timeZoneFails = false,
  eventFails = false,
}: {
  byCalendar?: Readonly<Record<string, readonly calendar_v3.Schema$Event[]>>;
  calendars?: readonly {
    id: string;
    summary: string | undefined;
    description: string | undefined;
    timeZone: string | undefined;
    accessRole: string | undefined;
    primary: boolean;
    selected: boolean;
  }[];
  timeZoneFails?: boolean;
  eventFails?: boolean;
} = {}): CalendarApi {
  // A calendar the test supplied no fixture for is a typo in the test, so the fake refuses it rather than
  // answering with an empty calendar that would let a wrong id read as a quiet one.
  const fixture = ({
    calendarId,
  }: {
    calendarId: string;
  }): Result<readonly calendar_v3.Schema$Event[], CalendarError> => {
    const events = byCalendar[calendarId];
    if (events === undefined) {
      return err(CalendarErrors.apiFailed({ message: `the fake seam holds no fixture for calendar ${calendarId}` }));
    }
    return ok(events);
  };
  return {
    getEvent: async ({ eventId, calendarId }) =>
      eventFails
        ? err(CalendarErrors.apiFailed({ message: "no such event" }))
        : fixture({ calendarId }).map((events) => events.find((item) => item.id === eventId)!),
    getTimeZone: async () =>
      timeZoneFails ? err(CalendarErrors.scopeMissing({ missing: ["settings"] })) : ok("Australia/Sydney"),
    listCalendars: async () => ok({ calendars, nextPageToken: undefined }),
    listEvents: async ({ calendarId }) =>
      fixture({ calendarId }).map((events) => ({
        events,
        nextPageToken: undefined,
        nextSyncToken: "tok",
        timeZone: "Australia/Sydney",
      })),
  };
}

describe("readCalendarVocabulary", () => {
  it("reports every calendar the grant can see, and the account's own zone", async () => {
    const result = await readCalendarVocabulary({ account: "me@x.test", api: fakeApi(), nowIso });
    expect(result.isOk()).toBe(true);
    const value = unwrap(result);
    expect(value.vocabulary.calendars.length).toBe(1);
    expect(value.vocabulary.accountTimeZone).toBe("Australia/Sydney");
    expect(value.document.coverage.detail).toBe("1 calendar(s) this grant can see");
    expect(value.document.source).toBe("calendar");
  });

  it("degrades to 'not established' rather than failing when the settings scope is absent", async () => {
    const result = await readCalendarVocabulary({
      account: "me@x.test",
      api: fakeApi({ timeZoneFails: true }),
      nowIso,
    });
    const value = unwrap(result);
    expect(value.vocabulary.accountTimeZone).toBe(undefined);
    expect(value.document.coverage.residue[0]).toContain("time zone was NOT established");
  });

  it("always says an unticked calendar still holds events", async () => {
    const result = await readCalendarVocabulary({ account: "me@x.test", api: fakeApi(), nowIso });
    expect(unwrap(result).document.coverage.residue.join(" ")).toContain("unticked calendar still holds events");
  });
});

describe("readCalendarListing", () => {
  it("orders events across calendars by start, not by the order the calendars were named", async () => {
    const api = fakeApi({
      byCalendar: {
        a: [event({ id: "a1", start: "2026-09-06T03:00:00Z", summary: "later" })],
        b: [event({ id: "b1", start: "2026-09-06T01:00:00Z", summary: "earlier" })],
      },
    });
    const result = await readCalendarListing({
      account: "me@x.test",
      api,
      calendarIds: ["a", "b"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    expect(unwrap(result).listing.events.map((item) => item.id)).toStrictEqual(["b1", "a1"]);
  });

  it("leads with every event that has no usable start, in Google's own order, then the dated ones by start", async () => {
    const api = fakeApi({
      byCalendar: {
        a: [
          event({ id: "late", start: "2026-09-06T03:00:00Z" }),
          { id: "no-start" },
          event({ id: "unparseable", start: "not a time" }),
          event({ id: "early", start: "2026-09-06T01:00:00Z" }),
        ],
      },
    });
    const result = await readCalendarListing({
      account: "me@x.test",
      api,
      calendarIds: ["a"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    expect(unwrap(result).listing.events.map((item) => item.id)).toStrictEqual([
      "no-start",
      "unparseable",
      "early",
      "late",
    ]);
  });

  it("leads an event with no start ahead of a dated one from before 1970", async () => {
    const api = fakeApi({
      byCalendar: {
        a: [event({ id: "dated-1960", start: "1960-01-01T00:00:00Z" }), { id: "no-start" }],
      },
    });
    const result = await readCalendarListing({
      account: "me@x.test",
      api,
      calendarIds: ["a"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "1959-12-31T00:00:00.000Z",
    });
    expect(unwrap(result).listing.events.map((item) => item.id)).toStrictEqual(["no-start", "dated-1960"]);
  });

  it("names the window and both calendars in its residue, so a gap reads as unread not absent", async () => {
    const result = await readCalendarListing({
      account: "me@x.test",
      api: fakeApi({ byCalendar: { a: [], b: [] } }),
      calendarIds: ["a", "b"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    const residue = unwrap(result).document.coverage.residue.join(" ");
    expect(residue).toContain("ONE window across 2 calendar(s) (a, b)");
    expect(residue).toContain("unread rather than absent");
  });

  it("always says instances were expanded, because that is not what the owner authored", async () => {
    const result = await readCalendarListing({
      account: "me@x.test",
      api: fakeApi({ byCalendar: { primary: [event({ id: "e", start: "2026-09-06T01:00:00Z", summary: "s" })] } }),
      calendarIds: ["primary"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    expect(unwrap(result).document.coverage.residue.join(" ")).toContain("EXPANDED into instances");
  });

  it("says a walk stopped at its cap is incomplete, even when an event it read failed to parse", async () => {
    const capped: CalendarApi = {
      ...fakeApi(),
      listEvents: async () =>
        ok({
          events: [{ start: { dateTime: "2026-09-06T00:00:00Z" } }, event({ id: "e", start: "2026-09-06T01:00:00Z" })],
          nextPageToken: "more",
          nextSyncToken: undefined,
          timeZone: "Australia/Sydney",
        }),
    };
    const listing = unwrap(
      await readCalendarListing({
        account: "me@x.test",
        api: capped,
        calendarIds: ["primary"],
        limit: 2,
        nowIso,
        timeMaxIso: "2026-09-12T00:00:00.000Z",
        timeMinIso: "2026-09-05T00:00:00.000Z",
      }),
    ).listing;
    expect([listing.complete, listing.events.map((item) => item.id)]).toEqual([false, ["e"]]);
  });

  it("says a walk that reached its end is incomplete when an event Google returned carried no id", async () => {
    const result = await readCalendarListing({
      account: "me@x.test",
      api: fakeApi({ byCalendar: { primary: [{ start: { dateTime: "2026-09-06T00:00:00Z" } }] } }),
      calendarIds: ["primary"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    const value = unwrap(result);
    expect([value.listing.complete, value.listing.events]).toEqual([false, []]);
    expect(value.document.coverage.residue[0]).toBe(
      "1 event(s) Google returned carried no id and are not listed — the window is not complete",
    );
  });

  it("says a walk that reached the end of every calendar is complete", async () => {
    const result = await readCalendarListing({
      account: "me@x.test",
      api: fakeApi({ byCalendar: { primary: [event({ id: "e", start: "2026-09-06T01:00:00Z" })] } }),
      calendarIds: ["primary"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    expect(unwrap(result).listing.complete).toBe(true);
  });

  it("counts titleless events and warns that a blank hour is still a busy one", async () => {
    const result = await readCalendarListing({
      account: "me@x.test",
      api: fakeApi({ byCalendar: { primary: [event({ id: "e", start: "2026-09-06T01:00:00Z" })] } }),
      calendarIds: ["primary"],
      limit: 50,
      nowIso,
      timeMaxIso: "2026-09-12T00:00:00.000Z",
      timeMinIso: "2026-09-05T00:00:00.000Z",
    });
    expect(unwrap(result).document.coverage.residue.join(" ")).toContain("1 event(s) carried no title");
  });
});

describe("readCalendarEvent", () => {
  it("reads one event and says its thread of instances is not shown when it is a master", async () => {
    const api = fakeApi({
      byCalendar: { primary: [{ id: "m", recurrence: ["RRULE:FREQ=DAILY"], start: { date: "2026-09-06" } }] },
    });
    const result = await readCalendarEvent({ account: "me@x.test", api, calendarId: "primary", eventId: "m", nowIso });
    const value = unwrap(result);
    expect(value.payload.event.recurrence).toStrictEqual(["RRULE:FREQ=DAILY"]);
    expect(value.document.coverage.residue.join(" ")).toContain("recurring MASTER");
  });

  it("reports a CANCELLED event rather than hiding it", async () => {
    const api = fakeApi({ byCalendar: { primary: [{ id: "c", status: "cancelled" }] } });
    const result = await readCalendarEvent({ account: "me@x.test", api, calendarId: "primary", eventId: "c", nowIso });
    expect(unwrap(result).document.coverage.residue.join(" ")).toContain("CANCELLED");
  });

  it("addresses the event by calendar AND id, because an id is only unique within one", async () => {
    const api = fakeApi({ byCalendar: { "team@x.test": [{ id: "e", summary: "s" }] } });
    const result = await readCalendarEvent({
      account: "me@x.test",
      api,
      calendarId: "team@x.test",
      eventId: "e",
      nowIso,
    });
    expect(unwrap(result).document.target.address).toBe("team@x.test/e");
  });

  it("surfaces the seam's own failure rather than reporting an empty event", async () => {
    const result = await readCalendarEvent({
      account: "me@x.test",
      api: fakeApi({ eventFails: true }),
      calendarId: "primary",
      eventId: "e",
      nowIso,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("API_FAILED");
  });
});
