/**
 * The PURE reading of a Graph `event` into the shared calendar shape (`live/outlookCalendar/parse.ts`): time as an
 * instant or a bare date and never one dressed as the other, the join link's precedence, the series rule as one
 * line, and the Outlook-only facts. Every fixture is a wire event as the boundary would hand it on.
 */
import { describe, expect, it } from "vitest";

import { parseOutlookEvent, parseOutlookEventTime } from "../../../../live/outlookCalendar/parse.js";
import type { GraphEvent } from "../../../../live/outlookCalendar/wire.js";

/** A timed single event with one guest, as Graph answers it under `Prefer: outlook.timezone="UTC"`. */
function wireEvent({ over = {} }: { over?: Partial<GraphEvent> } = {}): GraphEvent {
  return {
    attendees: [
      {
        emailAddress: { address: "guest@example.test", name: "Guest One" },
        status: { response: "accepted", time: "2001-01-01T00:00:00Z" },
        type: "required",
      },
    ],
    body: { content: "  Agenda  \r\n", contentType: "text" },
    end: { dateTime: "2001-01-08T08:30:00.0000000", timeZone: "UTC" },
    iCalUId: "ical-1",
    id: "event-1",
    isAllDay: false,
    isCancelled: false,
    isOrganizer: false,
    organizer: { emailAddress: { address: "host@example.test", name: "Host" } },
    originalStartTimeZone: "Australia/Brisbane",
    responseStatus: { response: "accepted", time: "2001-01-01T00:00:00Z" },
    sensitivity: "normal",
    showAs: "busy",
    start: { dateTime: "2001-01-08T07:30:00.1234567", timeZone: "UTC" },
    subject: "Planning",
    type: "singleInstance",
    webLink: "https://outlook.example.test/item",
    ...over,
  };
}

describe("parseOutlookEventTime", () => {
  it("reads a UTC wall time as an instant, cutting seven fractional digits to milliseconds", () => {
    expect(
      parseOutlookEventTime({ allDay: false, point: { dateTime: "2001-01-08T07:30:00.1234567", timeZone: "UTC" } }),
    ).toEqual({ dateTime: "2001-01-08T07:30:00.123Z", kind: "timed", timeZone: undefined });
  });

  it("reads a wall time with no fraction", () => {
    expect(
      parseOutlookEventTime({ allDay: false, point: { dateTime: "2001-01-08T07:30:00", timeZone: "UTC" } }),
    ).toEqual({ dateTime: "2001-01-08T07:30:00Z", kind: "timed", timeZone: undefined });
  });

  it("reads an all-day point as its bare date, never as midnight", () => {
    expect(
      parseOutlookEventTime({ allDay: true, point: { dateTime: "2001-01-08T00:00:00.0000000", timeZone: "UTC" } }),
    ).toEqual({ date: "2001-01-08", kind: "all-day" });
  });

  it("refuses to place a timed point read in a zone other than UTC", () => {
    expect(
      parseOutlookEventTime({
        allDay: false,
        point: { dateTime: "2001-01-08T07:30:00", timeZone: "E. Australia Standard Time" },
      }),
    ).toBe(undefined);
  });

  it("answers no time for a missing point or one that is not a wall time", () => {
    expect(parseOutlookEventTime({ allDay: false, point: null })).toBe(undefined);
    expect(parseOutlookEventTime({ allDay: false, point: { dateTime: "next tuesday", timeZone: "UTC" } })).toBe(
      undefined,
    );
  });
});

describe("parseOutlookEvent", () => {
  it("reads a timed event into the shared shape plus the Outlook facts", () => {
    expect(parseOutlookEvent({ calendarId: "default", event: wireEvent() })).toEqual({
      attendees: [
        {
          displayName: "Guest One",
          email: "guest@example.test",
          optional: false,
          resource: false,
          responseStatus: "accepted",
          self: false,
        },
      ],
      calendarId: "default",
      conferenceUrl: undefined,
      createdIso: undefined,
      creatorEmail: undefined,
      description: "Agenda",
      end: { dateTime: "2001-01-08T08:30:00.000Z", kind: "timed", timeZone: undefined },
      htmlLink: "https://outlook.example.test/item",
      iCalUID: "ical-1",
      id: "event-1",
      location: undefined,
      organizerEmail: "host@example.test",
      organizerName: "Host",
      outlook: {
        authoredZone: "Australia/Brisbane",
        categories: [],
        isOrganizer: false,
        myResponse: "accepted",
        showAs: "busy",
        type: "singleInstance",
      },
      recurrence: [],
      recurringEventId: undefined,
      start: { dateTime: "2001-01-08T07:30:00.123Z", kind: "timed", timeZone: undefined },
      status: "confirmed",
      summary: "Planning",
      transparency: "opaque",
      updatedIso: undefined,
      visibility: "normal",
    });
  });

  it("prefers the built meeting's join link over the older top-level one", () => {
    const event = wireEvent({
      over: { onlineMeeting: { joinUrl: "https://join.example.test/built" }, onlineMeetingUrl: "https://old.test" },
    });
    expect(parseOutlookEvent({ calendarId: "default", event }).conferenceUrl).toBe("https://join.example.test/built");
  });

  it("falls to the top-level join link when the built meeting carries none", () => {
    const event = wireEvent({ over: { onlineMeeting: { joinUrl: "" }, onlineMeetingUrl: "https://old.example.test" } });
    expect(parseOutlookEvent({ calendarId: "default", event }).conferenceUrl).toBe("https://old.example.test");
  });

  it("reads a cancelled, free event as cancelled and transparent", () => {
    const parsed = parseOutlookEvent({
      calendarId: "default",
      event: wireEvent({ over: { isCancelled: true, showAs: "free" } }),
    });
    expect(parsed.status).toBe("cancelled");
    expect(parsed.transparency).toBe("transparent");
  });

  it("marks optional and resource attendees, and reads a solo block as nobody on it", () => {
    const event = wireEvent({
      over: {
        attendees: [
          { emailAddress: { address: "maybe@example.test", name: null }, type: "optional" },
          { emailAddress: { address: "room@example.test", name: "Room 1" }, type: "resource" },
        ],
      },
    });
    const parsed = parseOutlookEvent({ calendarId: "default", event });
    expect(parsed.attendees.map((a) => [a.email, a.displayName, a.optional, a.resource])).toEqual([
      ["maybe@example.test", undefined, true, false],
      ["room@example.test", "Room 1", false, true],
    ]);
    const { attendees: _dropped, ...solo } = wireEvent();
    expect(parseOutlookEvent({ calendarId: "default", event: solo }).attendees).toEqual([]);
  });

  it("renders a series master's rule as one line", () => {
    const event = wireEvent({
      over: {
        recurrence: {
          pattern: { daysOfWeek: ["monday", "wednesday"], interval: 1, type: "weekly" },
          range: { endDate: "2001-03-01", startDate: "2001-01-08", type: "endDate" },
        },
        type: "seriesMaster",
      },
    });
    expect(parseOutlookEvent({ calendarId: "default", event }).recurrence).toEqual([
      "weekly every 1 on monday,wednesday from 2001-01-08 until 2001-03-01",
    ]);
  });

  it("counts a numbered series and names an occurrence's master", () => {
    const master = wireEvent({
      over: {
        recurrence: {
          pattern: { interval: 2, type: "daily" },
          range: { numberOfOccurrences: 5, startDate: "2001-01-08", type: "numbered" },
        },
      },
    });
    expect(parseOutlookEvent({ calendarId: "default", event: master }).recurrence).toEqual([
      "daily every 2 from 2001-01-08 for 5 occurrences",
    ]);
    const occurrence = wireEvent({ over: { seriesMasterId: "master-1", type: "occurrence" } });
    expect(parseOutlookEvent({ calendarId: "default", event: occurrence }).recurringEventId).toBe("master-1");
  });
});
