/**
 * Unit: the pure bronze projection of an Outlook event. Pinned are the properties a later reader cannot recover
 * if they are wrong: the record is private, keyed by calendar AND event, placed at its start; a series master
 * keeps its rule; an all-day event still sits on the timeline; and an event with no usable start is counted
 * rather than dropped in silence.
 */
import { describe, expect, it } from "vitest";

import {
  projectOutlookCalendarEvent,
  projectOutlookCalendarEvents,
} from "../../../../corpus/outlookCalendar/project.js";
import type { GraphEvent } from "../../../../live/outlookCalendar/wire.js";
import { calendarSummary, timedEvent } from "./fakeOutlookCalendarApi.js";

const MAIN = calendarSummary({ id: "main" });
const SHARED = calendarSummary({ id: "shared", isDefault: false });

/** A fuller wire event than the crawl fixture, as a full read selects it. */
function fullEvent(over: Partial<GraphEvent> = {}): GraphEvent {
  return {
    ...timedEvent({ id: "evt-1", modifiedIso: "2001-01-05T00:00:00Z" }),
    categories: ["Planning"],
    isOrganizer: false,
    organizer: { emailAddress: { address: "boss@example.test", name: "Boss Person" } },
    originalStartTimeZone: "AUS Eastern Standard Time",
    responseStatus: { response: "accepted", time: null },
    showAs: "busy",
    type: "singleInstance",
    webLink: "https://outlook.live.com/calendar/item/FIXTURE",
    ...over,
  };
}

describe("projectOutlookCalendarEvent", () => {
  it("projects a timed event into a private, calendar-keyed record placed at its start", () => {
    const record = projectOutlookCalendarEvent({ calendar: MAIN, event: fullEvent() })!;
    expect(record.source).toBe("outlook-calendar");
    expect(record.kind).toBe("event");
    expect(record.visibility).toBe("private");
    expect(record.container).toBe("main");
    expect(record.sourceId).toBe("main/evt-1");
    expect(record.tsIso).toBe("2001-01-08T07:00:00.000Z");
    expect(record.title).toBe("Event evt-1");
    expect(record.url).toBe("https://outlook.live.com/calendar/item/FIXTURE");
    expect(record.author).toBe("Boss Person");
  });

  it("carries the facts only Outlook reports, and the calendar it sits on", () => {
    const record = projectOutlookCalendarEvent({ calendar: MAIN, event: fullEvent() })!;
    expect(record.attrs).toEqual({
      allDay: false,
      attendeeCount: 0,
      calendarId: "main",
      calendarName: "Calendar main",
      categories: ["Planning"],
      endsAt: "2001-01-08T08:00:00Z",
      eventType: "singleInstance",
      isOrganizer: false,
      myResponse: "accepted",
      primaryCalendar: true,
      recurring: false,
      showAs: "busy",
      status: "confirmed",
      timeZone: "AUS Eastern Standard Time",
      transparency: "opaque",
      updatedIso: "2001-01-05T00:00:00Z",
    });
  });

  it("keys the same event on two calendars apart, so neither dedups the other away", () => {
    const mine = projectOutlookCalendarEvent({ calendar: MAIN, event: fullEvent() })!;
    const shared = projectOutlookCalendarEvent({ calendar: SHARED, event: fullEvent() })!;
    expect([mine.sourceId, shared.sourceId]).toEqual(["main/evt-1", "shared/evt-1"]);
    expect(shared.attrs!["primaryCalendar"]).toBe(false);
  });

  it("keeps a series master's rule rather than expanding it", () => {
    const master = fullEvent({
      recurrence: {
        pattern: { daysOfWeek: ["monday"], interval: 1, type: "weekly" },
        range: { startDate: "2001-01-08", type: "noEnd" },
      },
      type: "seriesMaster",
    });
    const record = projectOutlookCalendarEvent({ calendar: MAIN, event: master })!;
    expect(record.attrs!["recurring"]).toBe(true);
    expect(record.attrs!["eventType"]).toBe("seriesMaster");
    expect(record.attrs!["recurrence"]).toEqual(["weekly every 1 on monday from 2001-01-08"]);
  });

  it("places an all-day event on its date and says it is all-day", () => {
    const allDay = fullEvent({
      end: { dateTime: "2001-01-09T00:00:00.0000000", timeZone: "UTC" },
      isAllDay: true,
      start: { dateTime: "2001-01-08T00:00:00.0000000", timeZone: "UTC" },
    });
    const record = projectOutlookCalendarEvent({ calendar: MAIN, event: allDay })!;
    expect(record.attrs!["allDay"]).toBe(true);
    expect(record.attrs!["endsAt"]).toBe("2001-01-09");
    expect(record.tsIso).toBe("2001-01-08T00:00:00.000Z");
  });

  it("falls back to the item view by id when Graph sent no web link", () => {
    const record = projectOutlookCalendarEvent({ calendar: MAIN, event: fullEvent({ webLink: null }) })!;
    expect(record.url).toBe("https://outlook.live.com/calendar/item/evt-1");
  });

  it("answers undefined for an event with no usable start", () => {
    const zoned = fullEvent({ start: { dateTime: "2001-01-08T07:00:00", timeZone: "Pacific Standard Time" } });
    expect(projectOutlookCalendarEvent({ calendar: MAIN, event: zoned })).toBeUndefined();
  });
});

describe("projectOutlookCalendarEvents", () => {
  it("projects every placeable event and counts the rest in a warning", () => {
    const undated = fullEvent({ id: "evt-2", start: null });
    const projection = projectOutlookCalendarEvents({
      events: [
        { calendar: MAIN, event: fullEvent() },
        { calendar: MAIN, event: undated },
      ],
    });
    expect(projection.records.map((record) => record.sourceId)).toEqual(["main/evt-1"]);
    expect(projection.warnings).toEqual([
      "1 Outlook event(s) carried no usable start time and were not stored — a timed event not answered in UTC, or one with no start, has nowhere to sit on a timeline",
    ]);
  });

  it("warns about nothing when every event placed", () => {
    expect(projectOutlookCalendarEvents({ events: [{ calendar: MAIN, event: fullEvent() }] }).warnings).toEqual([]);
  });
});
