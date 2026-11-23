/**
 * Which upcoming meetings are owed a brief: the owner's standing ruling (a brief for an external session, a one-on-one, a
 * stand-up; none for a town hall) over a calendar of the same shape, where the external session went unbriefed.
 */
import { describe, expect, it } from "vitest";

import type { EventAttendee, ParsedCalendarEvent } from "../../../../live/calendar/parse.js";
import {
  prepAsk,
  prepRowSlug,
  prepVerdict,
  SMALL_MEETING_MAX_PEOPLE,
  selectPrepDue,
} from "../../../../live/calendar/prepDue.js";

const ACCOUNT = "owner@acme.com";
const NOW_MS = Date.parse("2026-10-08T00:00:00.000Z");
const FOUR_HOURS = 4 * 3_600_000;

/* One attendee, a colleague who has not replied unless overridden. */
function person(over: Partial<EventAttendee> = {}): EventAttendee {
  return {
    displayName: undefined,
    email: "colleague@acme.com",
    optional: false,
    resource: false,
    responseStatus: "needsAction",
    self: false,
    ...over,
  };
}

/* The owner, as an attendee on their own calendar. */
const ME = person({ email: ACCOUNT, self: true });

/* `count` colleagues from the owner's own domain. */
function colleagues({ count }: { count: number }): EventAttendee[] {
  return Array.from({ length: count }, (_, index) => person({ email: `c${String(index)}@acme.com` }));
}

/* One event as `calendar list` parses it: a timed 10:15 Brisbane meeting on the 8th unless overridden. */
function event(over: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    attendees: [ME, person()],
    calendarId: "primary",
    conferenceUrl: undefined,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: undefined,
    htmlLink: undefined,
    iCalUID: undefined,
    id: "evt_example_0001",
    location: undefined,
    organizerEmail: undefined,
    recurrence: [],
    recurringEventId: "evt_example_series",
    start: { dateTime: "2026-10-08T10:15:00+10:00", kind: "timed", timeZone: "Australia/Brisbane" },
    status: "confirmed",
    summary: "External audit session",
    transparency: undefined,
    updatedIso: undefined,
    visibility: undefined,
    ...over,
  };
}

const AUDITCO = event({
  attendees: [
    ME,
    person({ displayName: "Ada Auditor", email: "auditor.one@example.com" }),
    person({ displayName: "Tobias Auditor", email: "auditor.two@example.com" }),
    person(),
  ],
});

describe("prepVerdict", () => {
  it("briefs a meeting with anyone from outside the owner's domain, whatever its size", () => {
    expect(prepVerdict({ account: ACCOUNT, event: AUDITCO })).toEqual({
      kind: "brief",
      others: AUDITCO.attendees.slice(1),
      reason: "external",
    });
  });

  it("briefs a one-on-one with a colleague", () => {
    expect(prepVerdict({ account: ACCOUNT, event: event() })).toEqual({
      kind: "brief",
      others: [person()],
      reason: "one-on-one",
    });
  });

  it("briefs the seven-person platform stand-up, and the largest meeting the size bar allows", () => {
    const standup = event({ attendees: [ME, ...colleagues({ count: 6 })] });
    const largest = event({ attendees: [ME, ...colleagues({ count: SMALL_MEETING_MAX_PEOPLE - 1 })] });
    expect(prepVerdict({ account: ACCOUNT, event: standup }).kind).toBe("brief");
    expect(prepVerdict({ account: ACCOUNT, event: largest }).kind).toBe("brief");
  });

  it("skips the 120-person town hall and anything one past the size bar", () => {
    const townHall = event({ attendees: [ME, ...colleagues({ count: 119 })] });
    const justOver = event({ attendees: [ME, ...colleagues({ count: SMALL_MEETING_MAX_PEOPLE })] });
    expect(prepVerdict({ account: ACCOUNT, event: townHall })).toEqual({
      kind: "skip",
      why: "120 people, all from the owner's own domain — a meeting that size is one the owner attends, not one they talk in",
    });
    expect(prepVerdict({ account: ACCOUNT, event: justOver }).kind).toBe("skip");
  });

  it("skips a 60-person meeting even with outside attendees: the size bar binds every reason", () => {
    const webinar = event({ attendees: [ME, person({ email: "host@example.com" }), ...colleagues({ count: 58 })] });
    expect(prepVerdict({ account: ACCOUNT, event: webinar })).toEqual({
      kind: "skip",
      why: "60 people, some from outside the owner's domain — a meeting that size is one the owner attends, not one they talk in",
    });
  });

  it("recognises the owner by their address when the self marker is missing, for a decline and for the head count", () => {
    const declined = event({
      attendees: [person({ email: "Owner@Acme.com", responseStatus: "declined" }), person()],
    });
    const unmarked = event({ attendees: [person({ email: ACCOUNT }), person()] });
    expect(prepVerdict({ account: ACCOUNT, event: declined })).toEqual({
      kind: "skip",
      why: "the owner declined it",
    });
    expect(prepVerdict({ account: ACCOUNT, event: unmarked })).toEqual({
      kind: "brief",
      others: [person()],
      reason: "one-on-one",
    });
  });

  it("skips a meeting the owner declined, a cancelled one, an all-day one and one with nobody else on it", () => {
    const declined = event({
      attendees: [person({ email: ACCOUNT, responseStatus: "declined", self: true }), person()],
    });
    expect(prepVerdict({ account: ACCOUNT, event: declined })).toEqual({
      kind: "skip",
      why: "the owner declined it",
    });
    expect(prepVerdict({ account: ACCOUNT, event: event({ status: "cancelled" }) })).toEqual({
      kind: "skip",
      why: "cancelled",
    });
    expect(prepVerdict({ account: ACCOUNT, event: event({ start: { date: "2026-10-08", kind: "all-day" } }) })).toEqual(
      {
        kind: "skip",
        why: "all-day, so no start a brief could be due before",
      },
    );
    expect(prepVerdict({ account: ACCOUNT, event: event({ attendees: [ME] }) })).toEqual({
      kind: "skip",
      why: "nobody else is on it",
    });
  });

  it("does not count a meeting room as a person", () => {
    const room = person({ email: "level3@resource.calendar.google.com", resource: true });
    expect(prepVerdict({ account: ACCOUNT, event: event({ attendees: [ME, room] }) })).toEqual({
      kind: "skip",
      why: "nobody else is on it",
    });
  });
});

describe("selectPrepDue", () => {
  it("selects the meeting inside the look-ahead, naming its external domains and its own wall clock", () => {
    const selection = selectPrepDue({
      account: ACCOUNT,
      briefed: () => false,
      events: [AUDITCO],
      horizonMs: FOUR_HOURS,
      nowMs: NOW_MS,
    });
    expect(selection.skipped).toEqual([]);
    expect(
      selection.due.map((meeting) => [meeting.event.id, meeting.reason, meeting.startIso, meeting.startWall]),
    ).toEqual([["evt_example_0001", "external", "2026-10-08T00:15:00.000Z", "2026-10-08 10:15"]]);
    expect(selection.due[0]!.externalDomains).toEqual(["example.com"]);
  });

  it("skips a meeting already started, one past the look-ahead, and one already briefed", () => {
    const started = event({
      id: "started",
      start: { dateTime: "2026-10-07T23:30:00Z", kind: "timed", timeZone: undefined },
    });
    const later = event({
      id: "later",
      start: { dateTime: "2026-10-08T04:00:01Z", kind: "timed", timeZone: undefined },
    });
    const briefed = event({ id: "briefed" });
    const selection = selectPrepDue({
      account: ACCOUNT,
      briefed: ({ eventId }) => eventId === "briefed",
      events: [started, later, briefed],
      horizonMs: FOUR_HOURS,
      nowMs: NOW_MS,
    });
    expect(selection.due).toEqual([]);
    expect(selection.skipped.map((skip) => [skip.event.id, skip.why])).toEqual([
      ["started", "already started"],
      ["later", "starts beyond the look-ahead"],
      ["briefed", "a brief is already registered or tagged"],
    ]);
  });

  it("selects a meeting starting exactly at the edge of the look-ahead, soonest first", () => {
    const edge = event({ id: "edge", start: { dateTime: "2026-10-08T04:00:00Z", kind: "timed", timeZone: undefined } });
    const selection = selectPrepDue({
      account: ACCOUNT,
      briefed: () => false,
      events: [edge, AUDITCO],
      horizonMs: FOUR_HOURS,
      nowMs: NOW_MS,
    });
    expect(selection.due.map((meeting) => meeting.event.id)).toEqual([AUDITCO.id, "edge"]);
  });
});

describe("prepRowSlug and prepAsk", () => {
  it("keys the row on the event instance, lower-cased, so a re-run names the same slug", () => {
    expect(prepRowSlug({ eventId: "EVT_EXAMPLE_0001" })).toBe("meeting-brief-evt_example_0001");
    expect(prepRowSlug({ eventId: "a/b c" })).toBe("meeting-brief-a-b-c");
  });

  it("asks the seat to read, brief, publish and tag the exact instance, citing the owner's ruling", () => {
    const meeting = selectPrepDue({
      account: ACCOUNT,
      briefed: () => false,
      events: [AUDITCO],
      horizonMs: FOUR_HOURS,
      nowMs: NOW_MS,
    }).due[0]!;
    const ask = prepAsk({ meeting });
    expect(ask).toContain('"External audit session" at 2026-10-08 10:15');
    expect(ask).toContain("4 people, from outside: example.com");
    expect(ask).toContain("The owner's standing rule: a brief for every meeting the owner will talk in");
    expect(ask).toContain("`slopweaver calendar read evt_example_0001 --calendar primary`");
    expect(ask).toContain("`slopweaver page tag <page-slug> --meeting evt_example_0001 --calendar primary`");
    expect(ask).not.toContain("\n");
  });
});
