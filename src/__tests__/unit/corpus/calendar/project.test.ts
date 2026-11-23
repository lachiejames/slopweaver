/**
 * Unit: the pure bronze projection of a calendar event. The three properties worth pinning are the ones a
 * later reader cannot recover if they are wrong: a recurring master keeps its rule instead of being
 * expanded, a cancellation is stored rather than dropped, and the dedup key carries the calendar because an
 * event id is only unique within one.
 */
import { describe, expect, it } from "vitest";
import {
  calendarSourceId,
  calendarText,
  projectCalendarEvent,
  projectCalendarEvents,
} from "../../../../corpus/calendar/project.js";
import type { CalendarSummary } from "../../../../live/calendar/api.js";
import type { ParsedCalendarEvent } from "../../../../live/calendar/parse.js";

const CALENDAR: CalendarSummary = {
  accessRole: "owner",
  description: undefined,
  id: "me@example.test",
  primary: true,
  selected: true,
  summary: "Me",
  timeZone: "Australia/Sydney",
};

const TEAM: CalendarSummary = { ...CALENDAR, id: "team@example.test", primary: false, summary: "Team" };

function event(over: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    attendees: [],
    calendarId: "me@example.test",
    conferenceUrl: undefined,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: { dateTime: "2026-09-08T01:00:00Z", kind: "timed", timeZone: "Australia/Sydney" },
    htmlLink: "https://calendar.example.test/e/1",
    iCalUID: "uid-1@google.com",
    id: "evt-1",
    location: undefined,
    organizerEmail: "boss@example.test",
    recurrence: [],
    recurringEventId: undefined,
    start: { dateTime: "2026-09-08T00:00:00Z", kind: "timed", timeZone: "Australia/Sydney" },
    status: "confirmed",
    summary: "Weekly sync",
    transparency: "opaque",
    updatedIso: "2026-09-01T05:00:00.000Z",
    visibility: "default",
    ...over,
  };
}

describe("calendarSourceId", () => {
  it("carries the calendar, because an event id is only unique within one", () => {
    expect(calendarSourceId({ calendarId: "team@example.test", eventId: "evt-1" })).toBe("team@example.test/evt-1");
  });

  it("gives the SAME event on two calendars two different keys, so neither dedups the other away", () => {
    const mine = projectCalendarEvent({ calendar: CALENDAR, event: event() })!;
    const theirs = projectCalendarEvent({ calendar: TEAM, event: event() })!;
    expect(mine.sourceId).not.toBe(theirs.sourceId);
  });
});

describe("projectCalendarEvent", () => {
  it("stamps every record private, whatever the caller asked for", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.visibility).toBe("private");
  });

  it("places the record at its start, normalised to UTC", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.tsIso).toBe("2026-09-08T00:00:00.000Z");
  });

  it("uses the calendar as the container, so a diary groups by which calendar the commitment is on", () => {
    expect(projectCalendarEvent({ calendar: TEAM, event: event() })!.container).toBe("team@example.test");
  });

  it("keeps a recurring MASTER's rule in attrs and never expands it", () => {
    const record = projectCalendarEvent({
      calendar: CALENDAR,
      event: event({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] }),
    })!;
    expect(record.attrs!["recurrence"]).toStrictEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
    expect(record.attrs!["recurring"]).toBe(true);
  });

  it("STORES a cancelled event rather than dropping it, and says so in attrs", () => {
    const record = projectCalendarEvent({ calendar: CALENDAR, event: event({ status: "cancelled" }) })!;
    expect(record.attrs!["status"]).toBe("cancelled");
  });

  it("marks an all-day event as such, because its tsIso is a convention rather than an instant", () => {
    const record = projectCalendarEvent({
      calendar: CALENDAR,
      event: event({ end: { date: "2026-09-10", kind: "all-day" }, start: { date: "2026-09-09", kind: "all-day" } }),
    })!;
    expect(record.attrs!["allDay"]).toBe(true);
    expect(record.tsIso).toBe("2026-09-09T00:00:00.000Z");
  });

  it("separates the account's own calendar from one it merely subscribes to", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.attrs!["primaryCalendar"]).toBe(true);
    expect(projectCalendarEvent({ calendar: TEAM, event: event() })!.attrs!["primaryCalendar"]).toBe(false);
  });

  it("keeps the raw SDK object, so a later field never forces a re-crawl of the whole diary", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.raw!["iCalUID"]).toBe("uid-1@google.com");
  });

  it("links to Google's own web link when the event carries one", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.url).toBe("https://calendar.example.test/e/1");
  });

  it("links a stub with no web link to the event's own id in Calendar's editor", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event({ htmlLink: undefined }) })!.url).toBe(
      "https://calendar.google.com/calendar/u/0/r/eventedit/evt-1",
    );
  });

  it("authors the record by the organiser's NAME, else their address's local part, never the address", () => {
    const named = projectCalendarEvent({ calendar: CALENDAR, event: event({ organizerName: "Pat Boss" }) })!;
    expect(named.author).toBe("Pat Boss");
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event() })!.author).toBe("boss");
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event({ organizerEmail: undefined }) })!.author).toBe(
      undefined,
    );
  });

  it("REFUSES an event with no usable start rather than inventing a place on the timeline", () => {
    expect(projectCalendarEvent({ calendar: CALENDAR, event: event({ start: undefined }) })).toBe(undefined);
  });
});

describe("calendarText", () => {
  it("names attendees and what each of them said", () => {
    const text = calendarText({
      event: event({
        attendees: [
          {
            displayName: "Jane",
            email: "jane@example.test",
            optional: false,
            resource: false,
            responseStatus: "accepted",
            self: false,
          },
          {
            displayName: undefined,
            email: "seth@example.test",
            optional: true,
            resource: false,
            responseStatus: "declined",
            self: false,
          },
        ],
      }),
    });
    expect(text).toContain("attendees (2):");
    expect(text).toContain("- Jane — accepted");
    expect(text).toContain("- seth@example.test — declined (optional)");
  });

  it("lists an attendee with neither a name nor an address as unnamed, and one with no answer as no reply", () => {
    const text = calendarText({
      event: event({
        attendees: [
          {
            displayName: undefined,
            email: undefined,
            optional: false,
            resource: true,
            responseStatus: undefined,
            self: false,
          },
          {
            displayName: "Jane",
            email: "jane@example.test",
            optional: false,
            resource: false,
            responseStatus: undefined,
            self: false,
          },
        ],
      }),
    });
    expect(text.split("\n").slice(-2)).toStrictEqual(["- (unnamed) — no reply (resource)", "- Jane — no reply"]);
  });

  it("BOUNDS the list, so an all-hands is not four hundred lines of names", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      displayName: `Person ${String(index)}`,
      email: undefined,
      optional: false,
      resource: false,
      responseStatus: "accepted",
      self: false,
    }));
    const text = calendarText({ event: event({ attendees: many }) });
    expect(text).toContain("attendees (45):");
    expect(text).toContain("- and 5 more, not named here");
  });

  it("carries the description and the location a reader needs to place the meeting", () => {
    const text = calendarText({ event: event({ description: "the agenda", location: "Level 3" }) });
    expect(text).toContain("the agenda");
    expect(text).toContain("location: Level 3");
  });

  it("is exactly the title for an event with nothing else — never empty, because the store refuses empty text", () => {
    expect(calendarText({ event: event() })).toBe("Weekly sync");
  });

  it("leads with the title, then the description", () => {
    expect(calendarText({ event: event({ description: "the agenda" }) })).toBe("Weekly sync\n\nthe agenda");
  });

  it("is empty only when the event carries no title at all and was not cancelled", () => {
    expect(calendarText({ event: event({ summary: undefined }) })).toBe("");
  });

  it("says so for a cancelled stub Google serves with no title, so the record still has text", () => {
    expect(calendarText({ event: event({ status: "cancelled", summary: undefined }) })).toBe("cancelled");
    expect(calendarText({ event: event({ status: "cancelled" }) })).toBe("Weekly sync\n\ncancelled");
  });
});

describe("projectCalendarEvents", () => {
  it("counts what it could not place instead of dropping it silently", () => {
    const projected = projectCalendarEvents({
      events: [
        { calendar: CALENDAR, event: event() },
        { calendar: CALENDAR, event: event({ id: "evt-2", start: undefined }) },
      ],
    });
    expect(projected.records.length).toBe(1);
    expect(projected.warnings[0]).toContain("1 event(s) carried no usable start time");
  });

  it("warns about nothing when every event placed", () => {
    expect(projectCalendarEvents({ events: [{ calendar: CALENDAR, event: event() }] }).warnings).toStrictEqual([]);
  });
});
