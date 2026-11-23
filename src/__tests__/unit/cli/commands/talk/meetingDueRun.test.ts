/**
 * `talk meeting-due`'s shell over plain fakes: the window it reads, what it prints, that a read it could not
 * finish is a failure rather than "no meeting", and that a tagged page's briefing is the store's answer, asked once.
 */
import { describe, expect, it } from "vitest";

import { TALK_MEETING_DUE_USAGE } from "../../../../../cli/commands/talk/knowUsage.js";
import { type MeetingDueDeps, runMeetingDue } from "../../../../../cli/commands/talk/meetingDueRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { ParsedCalendarEvent } from "../../../../../live/calendar/parse.js";
import type { CalendarListing } from "../../../../../live/calendar/read.js";
import { type MeetingTag, type MeetingTagError, MeetingTagErrors } from "../../../../../pages/meetingTag.js";
import type { MeetingTagRead } from "../../../../../pages/meetingTagStore.js";
import {
  type PublishedPagesReadError,
  PublishedPagesReadErrors,
} from "../../../../../store/publishedPages/readErrors.js";

const NOW_MS = Date.parse("2026-10-08T23:02:00.000Z");
const ACCOUNT = "owner@acme.com";

/* The late-evening stand-up, with a Meet link and the owner on it. */
const STANDUP: ParsedCalendarEvent = {
  attendees: [
    {
      displayName: undefined,
      email: ACCOUNT,
      optional: false,
      resource: false,
      responseStatus: "accepted",
      self: true,
    },
  ],
  calendarId: "primary",
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  createdIso: undefined,
  creatorEmail: undefined,
  description: undefined,
  end: { dateTime: "2026-10-08T23:30:00Z", kind: "timed", timeZone: undefined },
  htmlLink: undefined,
  iCalUID: "standup@google.com",
  id: "standup_1",
  location: undefined,
  organizerEmail: undefined,
  recurrence: [],
  recurringEventId: undefined,
  start: { dateTime: "2026-10-08T23:00:00Z", kind: "timed", timeZone: undefined },
  status: "confirmed",
  summary: "Platform stand-up",
  transparency: "opaque",
  updatedIso: undefined,
  visibility: undefined,
};

/* A listing of `events`, complete unless said otherwise. */
function listing({
  events,
  complete = true,
}: {
  events: readonly ParsedCalendarEvent[];
  complete?: boolean;
}): CalendarListing {
  return {
    account: ACCOUNT,
    calendarIds: ["primary"],
    complete,
    events,
    timeMaxIso: "",
    timeMinIso: "",
  };
}

/* The page tagged to the stand-up. */
const STANDUP_TAG: MeetingTag = {
  calendarId: "primary",
  eventId: "standup_1",
  schemaVersion: 1,
  slug: "standup-brief",
  startIso: "2026-10-08T23:00:00.000Z",
  startWall: "10:00",
  summary: "Platform stand-up",
  taggedIso: "2026-10-08T20:00:00.000Z",
};

/* The page tagged to a meeting nobody is joining now. */
const RETRO_TAG: MeetingTag = { ...STANDUP_TAG, eventId: "retro_1", slug: "retro-brief", summary: "Retro" };

/*
 * Fakes that record every window asked for, every home the ledger was read under, every store ask, and every line
 * written; the clock reads `instants` in turn, then its last. The ledger holds no tag and the store publishes every
 * page it is asked about unless said.
 */
function fakes({
  answer,
  instants = [NOW_MS],
  tags = ok({ tags: [], unparsed: [] }),
  published,
}: {
  answer: Result<CalendarListing>;
  instants?: readonly number[];
  tags?: Result<MeetingTagRead, MeetingTagError>;
  published?: Result<ReadonlySet<string>, PublishedPagesReadError>;
}): {
  deps: MeetingDueDeps;
  windows: { home: string | undefined; timeMinIso: string; timeMaxIso: string }[];
  tagHomes: (string | undefined)[];
  asked: { home: string | undefined; slugs: readonly string[] }[];
  out: string[];
  diagnostics: string[];
} {
  const windows: { home: string | undefined; timeMinIso: string; timeMaxIso: string }[] = [];
  const tagHomes: (string | undefined)[] = [];
  const asked: { home: string | undefined; slugs: readonly string[] }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  let reads = 0;
  const deps: MeetingDueDeps = {
    list: async (input) => {
      windows.push(input);
      return answer;
    },
    publishedAmong: async (input) => {
      asked.push(input);
      if (published === undefined) {
        return ok(new Set(input.slugs));
      }
      return published;
    },
    readTags: ({ home }) => {
      tagHomes.push(home);
      return tags;
    },
    nowMs: () => {
      const instant = instants[Math.min(reads, instants.length - 1)]!;
      reads += 1;
      return instant;
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { asked, deps, diagnostics, out, tagHomes, windows };
}

describe("runMeetingDue", () => {
  it("reads the window around now and prints the meeting as one JSON document", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--json"] })).toBe(EXIT_OK);
    expect(run.windows).toEqual([
      { home: undefined, timeMaxIso: "2026-10-08T23:04:00.001Z", timeMinIso: "2026-10-08T23:02:00.000Z" },
    ]);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      meetings: [
        {
          briefingSlug: null,
          calendarId: "primary",
          endIso: "2026-10-08T23:30:00.000Z",
          eventId: "standup_1",
          joinUrl: "https://meet.google.com/abc-defg-hij",
          noticeId: "standup@google.com@2026-10-08T23:00:00.000Z",
          startIso: "2026-10-08T23:00:00.000Z",
          title: "Platform stand-up",
        },
      ],
      readAtIso: "2026-10-08T23:02:00.000Z",
    });
  });

  // A meeting that ends while the calendar is being read is not named.
  it("opens the window before the read and judges when it finished", async () => {
    const endMs = Date.parse("2026-10-08T23:30:00.000Z");
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })), instants: [endMs - 1, endMs] });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.windows.map((window) => window.timeMinIso)).toEqual(["2026-10-08T23:29:59.999Z"]);
    expect(run.out).toEqual(["no meeting to join at 2026-10-08T23:30:00.000Z"]);
  });

  it("judges at --now and passes --home through", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })) });
    const rest = ["--now", "2026-10-08T23:20:00Z", "--home", "/tmp/a-home"];
    expect(await runMeetingDue({ deps: run.deps, rest })).toBe(EXIT_OK);
    expect(run.windows.map((window) => [window.home, window.timeMinIso])).toEqual([
      ["/tmp/a-home", "2026-10-08T23:20:00.000Z"],
    ]);
    expect(run.out).toEqual(["no meeting to join at 2026-10-08T23:20:00.000Z"]);
  });

  it("prints one line a person reads per meeting without --json", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
  });

  it("carries the published page tagged to the meeting, reading the ledger and the store under --home", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })), tags: ok({ tags: [STANDUP_TAG], unparsed: [] }) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--json", "--home", "/tmp/a-home"] })).toBe(EXIT_OK);
    const printed = JSON.parse(run.out.join("\n")) as { meetings: { briefingSlug: string | null }[] };
    expect(printed.meetings.map((meeting) => meeting.briefingSlug)).toEqual(["standup-brief"]);
    expect(run.tagHomes).toEqual(["/tmp/a-home"]);
    expect(run.asked).toEqual([{ home: "/tmp/a-home", slugs: ["standup-brief"] }]);
    expect(run.diagnostics).toEqual([]);
  });

  it("asks the store once, about only the pages tagged to a meeting starting now", async () => {
    const run = fakes({
      answer: ok(listing({ events: [STANDUP] })),
      tags: ok({ tags: [RETRO_TAG, STANDUP_TAG], unparsed: [] }),
    });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.asked).toEqual([{ home: undefined, slugs: ["standup-brief"] }]);
    expect(run.out).toEqual([
      "2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij  briefing standup-brief",
    ]);
  });

  it("asks the store nothing when no tag names a meeting starting now", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })), tags: ok({ tags: [RETRO_TAG], unparsed: [] }) });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.asked).toEqual([]);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
    expect(run.diagnostics).toEqual([]);
  });

  it("keeps the join link and says so when the store cannot say whether the page is published", async () => {
    const stopped = PublishedPagesReadErrors.unavailable({
      cause: new Error("connect ECONNREFUSED"),
      doing: "connect",
    });
    const run = fakes({
      answer: ok(listing({ events: [STANDUP] })),
      published: err(stopped),
      tags: ok({ tags: [STANDUP_TAG], unparsed: [] }),
    });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
    expect(run.diagnostics).toEqual([
      "talk meeting-due: no briefing links, the join links still stand: " +
        "the published-page store did not connect: connect ECONNREFUSED",
    ]);
  });

  it("names the briefing on the line a person reads", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })), tags: ok({ tags: [STANDUP_TAG], unparsed: [] }) });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual([
      "2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij  briefing standup-brief",
    ]);
  });

  it("carries no briefing for a tagged page that is not published", async () => {
    const run = fakes({
      answer: ok(listing({ events: [STANDUP] })),
      published: ok(new Set()),
      tags: ok({ tags: [STANDUP_TAG], unparsed: [] }),
    });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
    expect(run.diagnostics).toEqual([]);
  });

  it("keeps the join link and says so when the tag ledger cannot be read", async () => {
    const unreadable = MeetingTagErrors.ledgerUnreadable({ cause: "EACCES", path: "/h/page-meetings.jsonl" });
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })), tags: err(unreadable) });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
    expect(run.diagnostics).toEqual([
      "talk meeting-due: no briefing links, the join links still stand: could not read /h/page-meetings.jsonl: EACCES",
    ]);
  });

  // The bad line may be a slug's latest re-tag, so the older tag it would leave is not current.
  it("gives no briefing when any ledger line is not a tag, says which, and keeps the join link", async () => {
    const run = fakes({
      answer: ok(listing({ events: [STANDUP] })),
      tags: ok({ tags: [STANDUP_TAG], unparsed: ["line 2: a tag line is not JSON"] }),
    });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.out).toEqual(["2026-10-08T23:00:00.000Z  Platform stand-up  https://meet.google.com/abc-defg-hij"]);
    expect(run.diagnostics).toEqual([
      "talk meeting-due: no briefing links, the join links still stand: the tag ledger's line 2: a tag line is not JSON",
    ]);
  });

  it("reads no ledger when no meeting is due", async () => {
    const run = fakes({ answer: ok(listing({ events: [] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.tagHomes).toEqual([]);
  });

  it("fails on a listing that did not reach every event, never answering no meeting", async () => {
    const run = fakes({ answer: ok(listing({ complete: false, events: [] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--json"] })).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diagnostics).toEqual([
      "talk meeting-due: the calendar read did not reach every event in the window, so no answer is given",
    ]);
  });

  it("fails with the read's own reason when the calendar cannot be read", async () => {
    const run = fakes({ answer: err(["no calendar grant carries events"]) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--json"] })).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual(["talk meeting-due: no calendar grant carries events"]);
  });

  it("refuses a malformed --now before any read", async () => {
    const run = fakes({ answer: ok(listing({ events: [STANDUP] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--now", "yesterday"] })).toBe(EXIT_USAGE);
    expect(run.windows).toEqual([]);
    expect(run.diagnostics).toEqual([
      "talk meeting-due --now yesterday is not an ISO instant, such as 2026-10-08T23:00:00Z",
      TALK_MEETING_DUE_USAGE,
    ]);
  });

  it("prints its usage for --help and reads nothing", async () => {
    const run = fakes({ answer: ok(listing({ events: [] })) });
    expect(await runMeetingDue({ deps: run.deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(run.out).toEqual([TALK_MEETING_DUE_USAGE]);
    expect(run.windows).toEqual([]);
    expect(run.tagHomes).toEqual([]);
  });
});
