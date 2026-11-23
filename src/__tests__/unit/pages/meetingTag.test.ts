/**
 * A page tagged to one meeting: which events can be tagged, how a tag reads back off the ledger, and which tagged
 * meeting is due — a one-on-one entered without its prep page is the worked case.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { ParsedCalendarEvent } from "../../../live/calendar/parse.js";
import {
  currentTags,
  dueMeetingTag,
  MEETING_PREP_LEAD_MS,
  type MeetingTag,
  MeetingTagErrors,
  meetingTagFromEvent,
  parseMeetingTagLine,
} from "../../../pages/meetingTag.js";
import { appendMeetingTag, readMeetingTags } from "../../../pages/meetingTagStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const TAGGED = "2026-10-01T05:40:00.000Z";

/* One event as `calendar read` parses it, a timed 15:00 Sydney one-on-one unless overridden. */
function event(over: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    attendees: [],
    calendarId: "primary",
    conferenceUrl: undefined,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: undefined,
    htmlLink: undefined,
    iCalUID: undefined,
    id: "6h1s9r0k4p2m8n3q_20261002T050000Z",
    location: undefined,
    organizerEmail: undefined,
    recurrence: [],
    recurringEventId: "6h1s9r0k4p2m8n3q",
    start: { dateTime: "2026-10-02T15:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" },
    status: "confirmed",
    summary: "Tobias / the owner 1:1",
    transparency: undefined,
    updatedIso: undefined,
    visibility: undefined,
    ...over,
  };
}

/* A tag for one slug starting at one instant. */
function tag({ slug, startIso }: { slug: string; startIso: string }): MeetingTag {
  return {
    calendarId: "primary",
    eventId: `e-${slug}`,
    schemaVersion: 1,
    slug,
    startIso,
    startWall: "15:00",
    summary: "a meeting",
    taggedIso: TAGGED,
  };
}

describe("meetingTagFromEvent", () => {
  it("records the instant in UTC and the wall clock the calendar wrote it in", () => {
    expect(unwrap(meetingTagFromEvent({ event: event(), slug: "tobias-one-on-one-2-oct", taggedIso: TAGGED }))).toEqual(
      {
        calendarId: "primary",
        eventId: "6h1s9r0k4p2m8n3q_20261002T050000Z",
        schemaVersion: 1,
        slug: "tobias-one-on-one-2-oct",
        startIso: "2026-10-02T05:00:00.000Z",
        startWall: "15:00",
        summary: "Tobias / the owner 1:1",
        taggedIso: TAGGED,
      },
    );
  });

  it("refuses a recurring series' master, whose start is its first occurrence and would never fire", () => {
    const master = event({ id: "6h1s9r0k4p2m8n3q", recurrence: ["RRULE:FREQ=WEEKLY"], recurringEventId: undefined });
    expect(unwrapErr(meetingTagFromEvent({ event: master, slug: "s", taggedIso: TAGGED }))).toEqual(
      MeetingTagErrors.recurringSeries({ eventId: "6h1s9r0k4p2m8n3q" }),
    );
  });

  it("refuses a cancelled, an all-day and a startless event, naming each", () => {
    const code = ({ over }: { over: Partial<ParsedCalendarEvent> }): string =>
      unwrapErr(meetingTagFromEvent({ event: event(over), slug: "s", taggedIso: TAGGED })).code;
    expect(code({ over: { status: "cancelled" } })).toBe("EVENT_CANCELLED");
    expect(code({ over: { start: { date: "2026-10-02", kind: "all-day" } } })).toBe("EVENT_ALL_DAY");
    expect(code({ over: { start: undefined } })).toBe("EVENT_START_UNREADABLE");
    expect(code({ over: { start: { dateTime: "tomorrow", kind: "timed", timeZone: undefined } } })).toBe(
      "EVENT_START_UNREADABLE",
    );
  });

  it("refuses a slug no page could be published under", () => {
    expect(unwrapErr(meetingTagFromEvent({ event: event(), slug: "../x", taggedIso: TAGGED })).code).toBe(
      "PAGE_SLUG_INVALID",
    );
  });
});

describe("parseMeetingTagLine", () => {
  it("reads back exactly the tag that was written, with or without a title", () => {
    const written = tag({ slug: "a", startIso: "2026-10-02T05:00:00.000Z" });
    expect(unwrap(parseMeetingTagLine({ line: JSON.stringify(written) }))).toEqual(written);
    const untitled = { ...written, summary: undefined };
    expect(unwrap(parseMeetingTagLine({ line: JSON.stringify(untitled) }))).toEqual(untitled);
  });

  it("reads a start in UTC to its minute, so the meeting stops being due when its minute-keyed card lapses", () => {
    const written = tag({ slug: "a", startIso: "2026-10-02T15:00:30+10:00" });
    const read = unwrap(parseMeetingTagLine({ line: JSON.stringify(written) }));
    expect(read.startIso).toBe("2026-10-02T05:00:00.000Z");
    const atTheMinute = Date.parse("2026-10-02T05:00:10.000Z");
    expect(dueMeetingTag({ leadMs: 3_600_000, nowMs: atTheMinute, tags: [read] })).toBeUndefined();
  });

  it("refuses a line that is not JSON, another schema, a missing field and an unparseable start", () => {
    const written = tag({ slug: "a", startIso: "2026-10-02T05:00:00.000Z" });
    const refused = ({ line }: { line: string }) => unwrapErr(parseMeetingTagLine({ line }));
    expect(refused({ line: "{" })).toEqual(MeetingTagErrors.lineInvalid({ why: "a tag line is not JSON" }));
    expect(refused({ line: JSON.stringify({ ...written, schemaVersion: 2 }) }).message).toBe(
      "a tag line is not a schema 1 meeting tag",
    );
    expect(refused({ line: JSON.stringify({ ...written, eventId: 7 }) }).message).toBe(
      "a tag line is missing its slug, calendar, event, start or tagged instant",
    );
    expect(refused({ line: JSON.stringify({ ...written, startIso: "soon" }) }).message).toBe(
      "the tag for a carries a slug or a start that does not parse",
    );
  });

  it("refuses a tagged instant that is not one, since it ranks two pages tagged to one meeting", () => {
    const written = tag({ slug: "a", startIso: "2026-10-02T05:00:00.000Z" });
    const refused = ({ taggedIso }: { taggedIso: string }) =>
      unwrapErr(parseMeetingTagLine({ line: JSON.stringify({ ...written, taggedIso }) })).message;
    expect(refused({ taggedIso: "yesterday" })).toBe("the tag for a carries a tagged instant that does not parse");
    expect(refused({ taggedIso: "2026-10-01" })).toBe("the tag for a carries a tagged instant that does not parse");
  });
});

describe("currentTags and dueMeetingTag", () => {
  const START = "2026-10-02T05:00:00.000Z";
  const startMs = Date.parse(START);

  it("keeps the last tag per slug — a re-tag replaces the earlier meeting", () => {
    const first = tag({ slug: "a", startIso: "2026-10-01T05:00:00.000Z" });
    const retag = tag({ slug: "a", startIso: START });
    const other = tag({ slug: "b", startIso: START });
    expect(currentTags({ tags: [first, other, retag] })).toEqual([retag, other]);
  });

  it("is due from exactly the hour before its start until the start itself", () => {
    const only = tag({ slug: "a", startIso: START });
    const due = ({ nowMs }: { nowMs: number }): MeetingTag | undefined =>
      dueMeetingTag({ leadMs: MEETING_PREP_LEAD_MS, nowMs, tags: [only] });
    expect(due({ nowMs: startMs - MEETING_PREP_LEAD_MS - 1 })).toBe(undefined);
    expect(due({ nowMs: startMs - MEETING_PREP_LEAD_MS })).toBe(only);
    expect(due({ nowMs: Date.parse("2026-10-02T04:43:00.000Z") })).toBe(only);
    expect(due({ nowMs: startMs - 1 })).toBe(only);
    expect(due({ nowMs: startMs })).toBe(undefined);
  });

  it("names the soonest of two meetings inside the same hour, and none when nothing is tagged", () => {
    const later = tag({ slug: "later", startIso: "2026-10-02T05:30:00.000Z" });
    const sooner = tag({ slug: "sooner", startIso: START });
    const nowMs = Date.parse("2026-10-02T04:45:00.000Z");
    expect(dueMeetingTag({ leadMs: MEETING_PREP_LEAD_MS, nowMs, tags: [later, sooner] })).toBe(sooner);
    expect(dueMeetingTag({ leadMs: MEETING_PREP_LEAD_MS, nowMs, tags: [] })).toBe(undefined);
  });
});

describe("the tag ledger", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "meeting-tags-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no tags from a ledger nothing ever wrote", () => {
    expect(unwrap(readMeetingTags({ home }))).toEqual({ tags: [], unparsed: [] });
  });

  it("round-trips appended tags in order, outside the pages tree the console serves", () => {
    const a = tag({ slug: "a", startIso: "2026-10-02T05:00:00.000Z" });
    const b = tag({ slug: "b", startIso: "2026-10-02T06:00:00.000Z" });
    expect(unwrap(appendMeetingTag({ home, tag: a }))).toBe(join(home, "page-meetings.jsonl"));
    unwrap(appendMeetingTag({ home, tag: b }));
    expect(unwrap(readMeetingTags({ home }))).toEqual({ tags: [a, b], unparsed: [] });
  });

  it("names a line that is not a tag by its number, keeping every tag around it", () => {
    const a = tag({ slug: "a", startIso: "2026-10-02T05:00:00.000Z" });
    writeFileSync(stateHomePaths({ home }).pageMeetings, `${JSON.stringify(a)}\nnot json\n\n`);
    expect(unwrap(readMeetingTags({ home }))).toEqual({ tags: [a], unparsed: ["line 2: a tag line is not JSON"] });
  });
});
