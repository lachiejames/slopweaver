/**
 * Unit: the pure event projection. The whole file exists for ONE property — a timed event and an all-day
 * event are different kinds of thing and are never flattened into one — so that is what most of it asserts.
 */
import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it } from "vitest";
import {
  conferenceUrl,
  eventSortKey,
  eventTsIso,
  parseCalendarEvent,
  parseEventTime,
  renderEventTime,
} from "../../../../live/calendar/parse.js";

const TIMED: calendar_v3.Schema$Event = {
  attendees: [
    { email: "a@example.test", responseStatus: "accepted", self: true },
    { displayName: "Room 3", resource: true, responseStatus: "accepted" },
    { email: "b@example.test", optional: true, responseStatus: "needsAction" },
  ],
  conferenceData: {
    entryPoints: [
      { entryPointType: "phone", uri: "tel:+61000000000" },
      { entryPointType: "video", uri: "https://meet.example.test/abc-defg-hij" },
    ],
  },
  created: "2026-08-01T02:00:00.000Z",
  creator: { email: "a@example.test" },
  description: "the agenda",
  end: { dateTime: "2026-09-08T00:30:00+10:00", timeZone: "Australia/Sydney" },
  htmlLink: "https://calendar.example.test/event?eid=xyz",
  iCalUID: "abc123@google.com",
  id: "evt-1",
  location: "Level 3",
  organizer: { email: "a@example.test" },
  start: { dateTime: "2026-09-08T00:00:00+10:00", timeZone: "Australia/Sydney" },
  status: "confirmed",
  summary: "Weekly sync",
  transparency: "opaque",
  updated: "2026-09-01T05:00:00.000Z",
  visibility: "default",
};

const ALL_DAY: calendar_v3.Schema$Event = {
  end: { date: "2026-09-10" },
  id: "evt-2",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
  start: { date: "2026-09-09" },
  status: "confirmed",
  summary: "Offsite",
};

describe("parseEventTime", () => {
  it("reads a null zone as no zone, never as one", () => {
    expect(parseEventTime({ point: { dateTime: "2026-09-08T00:00:00Z", timeZone: null } })).toStrictEqual({
      dateTime: "2026-09-08T00:00:00Z",
      kind: "timed",
      timeZone: undefined,
    });
  });

  it("reads a timed point as an instant, keeping the zone it was authored in", () => {
    expect(
      parseEventTime({ point: { dateTime: "2026-09-08T00:00:00+10:00", timeZone: "Australia/Sydney" } }),
    ).toStrictEqual({ dateTime: "2026-09-08T00:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" });
  });

  it("reads an all-day point as a DATE and invents no instant for it", () => {
    expect(parseEventTime({ point: { date: "2026-09-09" } })).toStrictEqual({ date: "2026-09-09", kind: "all-day" });
  });

  it("is undefined when Google carried neither field", () => {
    expect(parseEventTime({ point: {} })).toBe(undefined);
  });

  it("is undefined when there is no point at all", () => {
    expect(parseEventTime({ point: undefined })).toBe(undefined);
  });
});

describe("eventSortKey", () => {
  it("orders an all-day event before a timed event later the same UTC day", () => {
    const allDay = eventSortKey({ time: { date: "2026-09-09", kind: "all-day" } })!;
    const timed = eventSortKey({ time: { dateTime: "2026-09-09T03:00:00Z", kind: "timed", timeZone: undefined } })!;
    expect(allDay).toBeLessThan(timed);
  });

  it("reads a zoned instant as the instant, not as its local wall clock", () => {
    expect(
      eventSortKey({ time: { dateTime: "2026-09-08T00:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" } }),
    ).toBe(Date.parse("2026-09-07T14:00:00Z"));
  });

  it("is undefined for an event with no time", () => {
    expect(eventSortKey({ time: undefined })).toBe(undefined);
  });
});

describe("eventTsIso", () => {
  it("normalises a zoned instant to UTC", () => {
    expect(
      eventTsIso({ time: { dateTime: "2026-09-08T00:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" } }),
    ).toBe("2026-09-07T14:00:00.000Z");
  });

  it("extends an all-day date to UTC midnight, the stated convention", () => {
    expect(eventTsIso({ time: { date: "2026-09-09", kind: "all-day" } })).toBe("2026-09-09T00:00:00.000Z");
  });

  it("is undefined when the event carried no start", () => {
    expect(eventTsIso({ time: undefined })).toBe(undefined);
  });
});

describe("conferenceUrl", () => {
  it("prefers the structured VIDEO entry point over a phone one", () => {
    expect(conferenceUrl({ event: TIMED })).toBe("https://meet.example.test/abc-defg-hij");
  });

  it("falls back to the legacy hangoutLink when there is no conferenceData", () => {
    expect(conferenceUrl({ event: { hangoutLink: "https://meet.example.test/legacy", id: "e" } })).toBe(
      "https://meet.example.test/legacy",
    );
  });

  it("is undefined when the event has no conferencing at all", () => {
    expect(conferenceUrl({ event: ALL_DAY })).toBe(undefined);
  });
});

describe("parseCalendarEvent", () => {
  it("projects a timed event with its attendees, conferencing and calendar", () => {
    const parsed = parseCalendarEvent({ calendarId: "primary", event: TIMED })!;
    expect(parsed.id).toBe("evt-1");
    expect(parsed.calendarId).toBe("primary");
    expect(parsed.summary).toBe("Weekly sync");
    expect(parsed.iCalUID).toBe("abc123@google.com");
    expect(parsed.organizerEmail).toBe("a@example.test");
    expect(parsed.conferenceUrl).toBe("https://meet.example.test/abc-defg-hij");
    expect(parsed.updatedIso).toBe("2026-09-01T05:00:00.000Z");
    expect(parsed.transparency).toBe("opaque");
  });

  it("keeps rooms and optional attendees rather than filtering them out silently", () => {
    const parsed = parseCalendarEvent({ calendarId: "primary", event: TIMED })!;
    expect(parsed.attendees.length).toBe(3);
    expect(parsed.attendees[1]!.resource).toBe(true);
    expect(parsed.attendees[1]!.displayName).toBe("Room 3");
    expect(parsed.attendees[2]!.optional).toBe(true);
    expect(parsed.attendees[2]!.responseStatus).toBe("needsAction");
  });

  it("carries the recurrence rule of a master and leaves recurringEventId undefined", () => {
    const parsed = parseCalendarEvent({ calendarId: "primary", event: ALL_DAY })!;
    expect(parsed.recurrence).toStrictEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
    expect(parsed.recurringEventId).toBe(undefined);
    expect(parsed.start).toStrictEqual({ date: "2026-09-09", kind: "all-day" });
  });

  it("carries an instance's master id", () => {
    const parsed = parseCalendarEvent({
      calendarId: "primary",
      event: { id: "evt-3", recurringEventId: "evt-2", start: { date: "2026-09-16" } },
    })!;
    expect(parsed.recurringEventId).toBe("evt-2");
  });

  it("REFUSES an event with no id rather than inventing one", () => {
    expect(parseCalendarEvent({ calendarId: "primary", event: { summary: "no id" } })).toBe(undefined);
  });

  it("reports an empty attendee list as empty, not as undefined", () => {
    expect(parseCalendarEvent({ calendarId: "primary", event: ALL_DAY })!.attendees).toStrictEqual([]);
  });

  it("projects an event carrying only an id with every unset field present as undefined", () => {
    expect(parseCalendarEvent({ calendarId: "primary", event: { id: "bare" } })).toStrictEqual({
      attendees: [],
      calendarId: "primary",
      conferenceUrl: undefined,
      createdIso: undefined,
      creatorEmail: undefined,
      description: undefined,
      end: undefined,
      htmlLink: undefined,
      iCalUID: undefined,
      id: "bare",
      location: undefined,
      organizerEmail: undefined,
      recurrence: [],
      recurringEventId: undefined,
      start: undefined,
      status: undefined,
      summary: undefined,
      transparency: undefined,
      updatedIso: undefined,
      visibility: undefined,
    });
  });

  it("reads a missing creator block and a missing organiser block each on its own, as no address", () => {
    const noCreator = parseCalendarEvent({
      calendarId: "primary",
      event: { id: "evt-4", organizer: { email: "o@example.test" } },
    })!;
    const noOrganiser = parseCalendarEvent({
      calendarId: "primary",
      event: { creator: { email: "c@example.test" }, id: "evt-5" },
    })!;
    expect([noCreator.creatorEmail, noCreator.organizerEmail]).toStrictEqual([undefined, "o@example.test"]);
    expect([noOrganiser.creatorEmail, noOrganiser.organizerEmail]).toStrictEqual(["c@example.test", undefined]);
  });

  it("reads a creator and an organiser block carrying no address as no address, even one Google sent as null", () => {
    const named = parseCalendarEvent({
      calendarId: "primary",
      event: {
        creator: { displayName: "Room 3", id: "room-3", self: false },
        id: "evt-6",
        organizer: { displayName: "Team", id: "team-1", self: false },
      },
    })!;
    // The SDK types the child address `string | undefined`; the wire is JSON, so a null can still arrive.
    const wire = JSON.parse(
      '{"id":"evt-7","creator":{"email":null},"organizer":{"email":null}}',
    ) as calendar_v3.Schema$Event;
    const nulled = parseCalendarEvent({ calendarId: "primary", event: wire })!;
    expect([named.creatorEmail, named.organizerEmail]).toStrictEqual([undefined, undefined]);
    expect(named.organizerName).toBe("Team");
    expect(nulled.organizerName).toBe(undefined);
    expect([nulled.creatorEmail, nulled.organizerEmail]).toStrictEqual([undefined, undefined]);
  });

  it("reads every null Google sent exactly as it reads an omitted field", () => {
    const nulls: calendar_v3.Schema$Event = {
      attendees: [{ displayName: null, email: null, responseStatus: null }],
      created: null,
      creator: {},
      description: null,
      hangoutLink: null,
      htmlLink: null,
      iCalUID: null,
      id: "nulls",
      location: null,
      organizer: {},
      recurrence: null,
      recurringEventId: null,
      status: null,
      summary: null,
      transparency: null,
      updated: null,
      visibility: null,
    };
    expect(parseCalendarEvent({ calendarId: "primary", event: nulls })).toStrictEqual({
      attendees: [
        {
          displayName: undefined,
          email: undefined,
          optional: false,
          resource: false,
          responseStatus: undefined,
          self: false,
        },
      ],
      calendarId: "primary",
      conferenceUrl: undefined,
      createdIso: undefined,
      creatorEmail: undefined,
      description: undefined,
      end: undefined,
      htmlLink: undefined,
      iCalUID: undefined,
      id: "nulls",
      location: undefined,
      organizerEmail: undefined,
      recurrence: [],
      recurringEventId: undefined,
      start: undefined,
      status: undefined,
      summary: undefined,
      transparency: undefined,
      updatedIso: undefined,
      visibility: undefined,
    });
  });
});

describe("renderEventTime", () => {
  it("marks an all-day date as all day and never prints a time for it", () => {
    expect(renderEventTime({ time: { date: "2026-09-09", kind: "all-day" } })).toBe("2026-09-09 (all day)");
  });

  it("prints a timed event's zone beside its instant", () => {
    expect(
      renderEventTime({ time: { dateTime: "2026-09-08T00:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" } }),
    ).toBe("2026-09-08T00:00:00+10:00 [Australia/Sydney]");
  });

  it("prints just the instant when Google reported no zone", () => {
    expect(renderEventTime({ time: { dateTime: "2026-09-08T00:00:00Z", kind: "timed", timeZone: undefined } })).toBe(
      "2026-09-08T00:00:00Z",
    );
  });

  it("says so when there is no time at all", () => {
    expect(renderEventTime({ time: undefined })).toBe("(no time)");
  });
});
