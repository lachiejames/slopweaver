/**
 * Which meeting of the owner's the voice tells them to join: any they have not declined that has a join link and starts
 * within two minutes or started within ten, since the owner can be two minutes late while talking to the voice.
 */
import { describe, expect, it } from "vitest";

import type { EventAttendee, ParsedCalendarEvent } from "../../../live/calendar/parse.js";
import type { MeetingTag } from "../../../pages/meetingTag.js";
import {
  briefingCandidates,
  type JoinableMeeting,
  joinableMeetings,
  MEETING_EARLY_MS,
  MEETING_LATE_MS,
  MEETING_TITLE_MAX_CHARS,
  meetingDueWindow,
  spokenTitle,
  UNTITLED_MEETING,
  withBriefings,
} from "../../../talk/meetingDue.js";

const ACCOUNT = "owner@acme.com";
const START_ISO = "2026-10-08T23:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const MEET = "https://meet.google.com/abc-defg-hij";

/* The owner, as an attendee on their own calendar, accepted unless overridden. */
function me(over: Partial<EventAttendee> = {}): EventAttendee {
  return {
    displayName: undefined,
    email: ACCOUNT,
    optional: false,
    resource: false,
    responseStatus: "accepted",
    self: true,
    ...over,
  };
}

/* One event as `calendar list` parses it: a half-hour Meet with the owner alone on it unless overridden. */
function event(over: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    attendees: [me()],
    calendarId: "primary",
    conferenceUrl: MEET,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: { dateTime: "2026-10-09T10:30:00+11:00", kind: "timed", timeZone: "Australia/Melbourne" },
    htmlLink: undefined,
    iCalUID: "standup@google.com",
    id: "standup_20261008T230000Z",
    location: undefined,
    organizerEmail: undefined,
    recurrence: [],
    recurringEventId: undefined,
    start: { dateTime: "2026-10-09T10:00:00+11:00", kind: "timed", timeZone: "Australia/Melbourne" },
    status: "confirmed",
    summary: "Platform stand-up",
    transparency: "opaque",
    updatedIso: undefined,
    visibility: undefined,
    ...over,
  };
}

/* The notice ids picked at `nowMs` from `events`. */
function picked({ events, nowMs }: { events: readonly ParsedCalendarEvent[]; nowMs: number }): readonly string[] {
  return joinableMeetings({ account: ACCOUNT, events, nowMs }).map((meeting) => meeting.noticeId);
}

describe("joinableMeetings", () => {
  it("picks a meeting that just started, with its join link, its instants in UTC and one notice id", () => {
    expect(joinableMeetings({ account: ACCOUNT, events: [event()], nowMs: START_MS + 120_000 })).toEqual([
      {
        briefingSlug: null,
        calendarId: "primary",
        endIso: "2026-10-08T23:30:00.000Z",
        eventId: "standup_20261008T230000Z",
        joinUrl: MEET,
        noticeId: `standup@google.com@${START_ISO}`,
        startIso: START_ISO,
        title: "Platform stand-up",
      },
    ]);
  });

  it("holds both edges of the window inclusively, and nothing a millisecond past either", () => {
    expect(picked({ events: [event()], nowMs: START_MS - MEETING_EARLY_MS })).toHaveLength(1);
    expect(picked({ events: [event()], nowMs: START_MS - MEETING_EARLY_MS - 1 })).toEqual([]);
    expect(picked({ events: [event()], nowMs: START_MS + MEETING_LATE_MS })).toHaveLength(1);
    expect(picked({ events: [event()], nowMs: START_MS + MEETING_LATE_MS + 1 })).toEqual([]);
  });

  it("picks a large or a free-time meeting too: joinable is the criterion, never size", () => {
    const crowd: EventAttendee[] = Array.from({ length: 140 }, (_, index) =>
      me({ email: `p${String(index)}@acme.com`, self: false }),
    );
    const townHall = event({
      attendees: [me(), ...crowd],
      iCalUID: "town-hall@google.com",
      transparency: "transparent",
    });
    expect(picked({ events: [townHall], nowMs: START_MS })).toEqual([`town-hall@google.com@${START_ISO}`]);
  });

  it("skips a cancelled, declined, all-day, linkless, non-web-link or already-ended meeting", () => {
    const skipped = [
      event({ status: "cancelled" }),
      event({ attendees: [me({ responseStatus: "declined" })] }),
      event({ attendees: [me({ responseStatus: "declined", self: false })] }),
      event({ end: { date: "2026-10-10", kind: "all-day" }, start: { date: "2026-10-09", kind: "all-day" } }),
      event({ conferenceUrl: undefined }),
      event({ conferenceUrl: "tel:+61-2-5555-0100" }),
      event({ conferenceUrl: "not a link" }),
      event({ end: { dateTime: "2026-10-08T23:05:00Z", kind: "timed", timeZone: undefined } }),
      event({ start: { dateTime: "not-a-time", kind: "timed", timeZone: undefined } }),
      // A timed start beside a missing, all-day or unreadable end cannot say it is still on.
      event({ end: undefined }),
      event({ end: { date: "2026-10-08", kind: "all-day" } }),
      event({ end: { dateTime: "not-a-time", kind: "timed", timeZone: undefined } }),
      // `Date.parse` reads a bare date as UTC midnight, an end the event never named.
      event({ end: { dateTime: "2026-10-09", kind: "timed", timeZone: undefined } }),
    ];
    expect(picked({ events: skipped, nowMs: START_MS + 6 * 60_000 })).toEqual([]);
  });

  it("names the same invite on two calendars once, and two instances of a series apart", () => {
    const copy = event({ calendarId: "team@group.calendar.google.com" });
    const nextWeek = event({
      id: "standup_20261015T230000Z",
      start: { dateTime: "2026-10-08T23:01:00Z", kind: "timed", timeZone: undefined },
    });
    expect(picked({ events: [event(), copy, nextWeek], nowMs: START_MS + 60_000 })).toEqual([
      `standup@google.com@${START_ISO}`,
      "standup@google.com@2026-10-08T23:01:00.000Z",
    ]);
  });

  it("keys an event Google gave no iCalUID by its calendar and id", () => {
    expect(picked({ events: [event({ iCalUID: undefined })], nowMs: START_MS })).toEqual([
      `primary/standup_20261008T230000Z@${START_ISO}`,
    ]);
  });

  it("orders the soonest start first", () => {
    const later = event({
      iCalUID: "later@google.com",
      start: { dateTime: "2026-10-08T23:01:00Z", kind: "timed", timeZone: undefined },
    });
    const earlier = event({ iCalUID: "earlier@google.com" });
    expect(picked({ events: [later, earlier], nowMs: START_MS + 60_000 })).toEqual([
      `earlier@google.com@${START_ISO}`,
      "later@google.com@2026-10-08T23:01:00.000Z",
    ]);
  });
});

describe("spokenTitle", () => {
  it("collapses the title to one line", () => {
    expect(spokenTitle({ summary: "  Auditco\n  working   session " })).toBe("Auditco working session");
  });

  it("names an untitled or blank meeting plainly", () => {
    expect(spokenTitle({ summary: undefined })).toBe(UNTITLED_MEETING);
    expect(spokenTitle({ summary: " \n " })).toBe(UNTITLED_MEETING);
  });

  it("caps a long title with an ellipsis inside the limit", () => {
    const title = spokenTitle({ summary: "x".repeat(200) });
    expect(title).toBe(`${"x".repeat(MEETING_TITLE_MAX_CHARS - 1)}…`);
    expect(title).toHaveLength(MEETING_TITLE_MAX_CHARS);
  });
});

/* The stand-up as `joinableMeetings` names it, with no briefing yet. */
const DUE: JoinableMeeting = {
  briefingSlug: null,
  calendarId: "primary",
  endIso: "2026-10-08T23:30:00.000Z",
  eventId: "standup_20261008T230000Z",
  joinUrl: MEET,
  noticeId: `standup@google.com@${START_ISO}`,
  startIso: START_ISO,
  title: "Platform stand-up",
};

/* A tag on the stand-up for `slug`, taken at `taggedIso`, unless overridden. */
function tag(over: Partial<MeetingTag> & { slug: string }): MeetingTag {
  return {
    calendarId: "primary",
    eventId: "standup_20261008T230000Z",
    schemaVersion: 1,
    startIso: START_ISO,
    startWall: "10:00",
    summary: "Platform stand-up",
    taggedIso: "2026-10-08T20:00:00.000Z",
    ...over,
  };
}

/* The briefing slug each meeting carries once `tags` are attached, every page published unless `unpublished`. */
function briefings({
  tags,
  unpublished = [],
}: {
  tags: readonly MeetingTag[];
  unpublished?: readonly string[];
}): readonly (string | null)[] {
  return withBriefings({
    meetings: [DUE],
    published: ({ slug }) => !unpublished.includes(slug),
    tags,
  }).map((meeting) => meeting.briefingSlug);
}

describe("withBriefings", () => {
  it("attaches the published page tagged to the meeting, leaving every other field as it was", () => {
    expect(withBriefings({ meetings: [DUE], published: () => true, tags: [tag({ slug: "standup-brief" })] })).toEqual([
      { ...DUE, briefingSlug: "standup-brief" },
    ]);
  });

  it("leaves a meeting with no tag without a briefing", () => {
    expect(briefings({ tags: [] })).toEqual([null]);
  });

  it("skips a tagged page that is not published, so no link opens onto nothing", () => {
    expect(briefings({ tags: [tag({ slug: "deleted-brief" })], unpublished: ["deleted-brief"] })).toEqual([null]);
  });

  it("does not match the same event id on another calendar", () => {
    expect(briefings({ tags: [tag({ calendarId: "team@group.calendar.google.com", slug: "other" })] })).toEqual([null]);
  });

  it("does not match another meeting", () => {
    expect(briefings({ tags: [tag({ eventId: "retro_20261008T230000Z", slug: "retro-brief" })] })).toEqual([null]);
  });

  it("still matches a meeting moved after it was tagged", () => {
    expect(briefings({ tags: [tag({ slug: "standup-brief", startIso: "2026-10-08T22:00:00.000Z" })] })).toEqual([
      "standup-brief",
    ]);
  });

  it("opens the later-tagged of two pages tagged to one meeting, whatever the ledger order", () => {
    const later = tag({ slug: "b-later", taggedIso: "2026-10-08T21:00:00.000Z" });
    const earlier = tag({ slug: "a-earlier", taggedIso: "2026-10-08T20:00:00.000Z" });
    expect(briefings({ tags: [later, earlier] })).toEqual(["b-later"]);
    expect(briefings({ tags: [earlier, later] })).toEqual(["b-later"]);
  });

  it("falls to the older page when the later-tagged one is not published", () => {
    const later = tag({ slug: "b-later", taggedIso: "2026-10-08T21:00:00.000Z" });
    const earlier = tag({ slug: "a-earlier", taggedIso: "2026-10-08T20:00:00.000Z" });
    expect(briefings({ tags: [earlier, later], unpublished: ["b-later"] })).toEqual(["a-earlier"]);
  });

  it("does not open a page since re-tagged to another meeting", () => {
    const moved = tag({
      eventId: "retro_20261008T230000Z",
      slug: "standup-brief",
      taggedIso: "2026-10-08T21:00:00.000Z",
    });
    expect(briefings({ tags: [tag({ slug: "standup-brief" }), moved] })).toEqual([null]);
  });

  it("returns no meetings for none", () => {
    expect(withBriefings({ meetings: [], published: () => true, tags: [tag({ slug: "standup-brief" })] })).toEqual([]);
  });
});

describe("briefingCandidates", () => {
  it("names each page whose current tag is on a meeting starting now, once, in the order each first appears in the ledger", () => {
    const later = tag({ slug: "b-later", taggedIso: "2026-10-08T21:00:00.000Z" });
    const earlier = tag({ slug: "a-earlier" });
    expect(briefingCandidates({ meetings: [DUE], tags: [later, earlier, later] })).toEqual(["b-later", "a-earlier"]);
  });

  it("leaves out a page tagged to another meeting or another calendar", () => {
    const retro = tag({ eventId: "retro_20261008T230000Z", slug: "retro-brief" });
    const team = tag({ calendarId: "team@group.calendar.google.com", slug: "team-brief" });
    expect(briefingCandidates({ meetings: [DUE], tags: [retro, team] })).toEqual([]);
  });

  it("leaves out a page since re-tagged to another meeting", () => {
    const moved = tag({
      eventId: "retro_20261008T230000Z",
      slug: "standup-brief",
      taggedIso: "2026-10-08T21:00:00.000Z",
    });
    expect(briefingCandidates({ meetings: [DUE], tags: [tag({ slug: "standup-brief" }), moved] })).toEqual([]);
  });

  it("names every slug withBriefings asks about", () => {
    const tags = [tag({ slug: "a-earlier" }), tag({ slug: "b-later", taggedIso: "2026-10-08T21:00:00.000Z" })];
    const asked: string[] = [];
    withBriefings({
      meetings: [DUE],
      published: ({ slug }) => {
        asked.push(slug);
        return false;
      },
      tags,
    });
    expect(briefingCandidates({ meetings: [DUE], tags })).toEqual(asked);
  });
});

describe("meetingDueWindow", () => {
  it("opens at now and closes just past the early edge, so a meeting starting then is listed", () => {
    expect(meetingDueWindow({ nowMs: START_MS })).toEqual({
      timeMaxIso: "2026-10-08T23:02:00.001Z",
      timeMinIso: START_ISO,
    });
  });
});
