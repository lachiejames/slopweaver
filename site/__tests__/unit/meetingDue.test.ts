/*
 * The console's strict read of `talk meeting-due --json`: a meeting it cannot read refuses the whole answer, and the
 * pill's life and the cut-in's edge are judged off the meeting's own instants.
 */
import { describe, expect, it } from "vitest";

import {
  MEETING_DUE_BODY_MAX,
  MEETING_SKIP_HORIZON_MS,
  MEETING_SKIPS_MAX,
  type MeetingNotice,
  type MeetingSkip,
  meetingBriefingHref,
  meetingDueAnswerOf,
  meetingNoticeOf,
  meetingPillLive,
  meetingStarted,
  meetingToTell,
  NOTICE_ID_MAX_CHARS,
  nextMeetingNotice,
  pillAfterSkips,
  refreshedNoticesOf,
  refreshedPill,
  SHOWN_MAX,
  shownAfter,
  shownNoticeIdsOf,
  skippedMeetingsOf,
  unskippedNotices,
  withoutBriefing,
} from "../../lib/meetingDue";

const RETRO = {
  briefingSlug: null,
  calendarId: "primary",
  endIso: "2026-10-09T05:00:00.000Z",
  eventId: "evtfixture01_20261009T043000Z",
  joinUrl: "https://meet.google.com/aaa-bbbb-ccc",
  noticeId: "evtfixture01@google.com@2026-10-09T04:30:00.000Z",
  startIso: "2026-10-09T04:30:00.000Z",
  title: "Fixture team retro",
} as const;

const STANDUP = {
  ...RETRO,
  endIso: "2026-10-09T04:45:00.000Z",
  eventId: "standup_20261009T043100Z",
  noticeId: "standup@google.com@2026-10-09T04:31:00.000Z",
  startIso: "2026-10-09T04:31:00.000Z",
  title: "Standup",
} as const;

describe("meetingNoticeOf", () => {
  it("reads a meeting the verb prints, collapsing whitespace in its title", () => {
    expect(meetingNoticeOf({ value: { ...RETRO, title: "  Fixture \n team   retro " } })).toEqual(RETRO);
  });

  it.each([
    ["a javascript: link", { ...RETRO, joinUrl: "javascript:alert(1)" }],
    ["a link that is no URL", { ...RETRO, joinUrl: "meet.google.com/abc" }],
    ["an unparseable start", { ...RETRO, startIso: "half past four" }],
    ["an unparseable end", { ...RETRO, endIso: "later" }],
    // The verb names no meeting without a timed end.
    ["no end", { ...RETRO, endIso: undefined }],
    ["a bare year for an end", { ...RETRO, endIso: "9999" }],
    ["a date with no time for an end", { ...RETRO, endIso: "2026-10-09" }],
    ["an end not in UTC", { ...RETRO, endIso: "2026-10-09T16:00:00+11:00" }],
    ["a start not in the verb's form", { ...RETRO, startIso: "2026-10-09T04:30:00Z" }],
    ["a blank title", { ...RETRO, title: "   " }],
    ["a title past the cap", { ...RETRO, title: "x".repeat(201) }],
    ["an empty notice id", { ...RETRO, noticeId: "" }],
    ["a notice id past the cap", { ...RETRO, noticeId: "x".repeat(1_025) }],
    ["no calendar id", { ...RETRO, calendarId: undefined }],
    ["an empty event id", { ...RETRO, eventId: "" }],
    ["an event id past the cap", { ...RETRO, eventId: "x".repeat(1_025) }],
    ["no object at all", "Fixture team retro"],
  ])("refuses %s", (_label, value) => {
    expect(meetingNoticeOf({ value })).toBeUndefined();
  });

  // A briefing the console cannot trust must not take the join link down with it.
  it.each([
    ["an empty briefing slug", ""],
    ["a briefing slug with a separator", "a/b"],
    ["a briefing slug stepping up", ".."],
    ["a briefing slug carrying a query", "brief?x=1"],
    ["a briefing slug past the cap", "x".repeat(129)],
    ["a briefing that is not text", 7],
  ])("keeps the meeting, with no briefing, for %s", (_label, briefingSlug) => {
    expect(meetingNoticeOf({ value: { ...RETRO, briefingSlug } })).toEqual(RETRO);
  });

  it("keeps the whole answer when one meeting's briefing is unreadable", () => {
    const answer = { meetings: [RETRO, { ...STANDUP, briefingSlug: "a/b" }] };
    expect(meetingDueAnswerOf({ value: answer })).toEqual([RETRO, STANDUP]);
  });

  it("reads a briefing the verb attached", () => {
    expect(meetingNoticeOf({ value: { ...RETRO, briefingSlug: "retro-brief" } })).toEqual({
      ...RETRO,
      briefingSlug: "retro-brief",
    });
  });

  // An installed CLI older than the field prints none; the meeting is still one to join.
  it("reads a missing briefing as none", () => {
    const { briefingSlug: _dropped, ...older } = RETRO;
    expect(meetingNoticeOf({ value: older })).toEqual(RETRO);
  });
});

describe("meetingBriefingHref", () => {
  it("is the console's route to the tagged page", () => {
    expect(meetingBriefingHref({ notice: { ...RETRO, briefingSlug: "retro-brief" } })).toBe(
      "/api/page/retro-brief/index.html",
    );
  });

  it("is nothing for a meeting with no briefing", () => {
    expect(meetingBriefingHref({ notice: RETRO })).toBeUndefined();
  });
});

describe("refreshedNoticesOf", () => {
  it("reads every meeting it can, dropping one it cannot rather than the list", () => {
    expect(refreshedNoticesOf({ value: [RETRO, { ...STANDUP, joinUrl: "ftp://x" }] })).toEqual([RETRO]);
  });

  it("reads an empty list as a read naming nothing", () => {
    expect(refreshedNoticesOf({ value: [] })).toEqual([]);
  });

  it("reads anything not a list as no read at all", () => {
    expect([refreshedNoticesOf({ value: null }), refreshedNoticesOf({ value: RETRO })]).toEqual([null, null]);
  });
});

describe("withoutBriefing", () => {
  it("drops the briefing and keeps everything else", () => {
    expect(withoutBriefing({ notice: { ...RETRO, briefingSlug: "retro-brief" } })).toEqual(RETRO);
  });

  it("is the very same meeting when it has no briefing", () => {
    expect(withoutBriefing({ notice: RETRO })).toBe(RETRO);
  });
});

// A pill already up takes the briefing of the latest read, not of the read that first showed it.
describe("refreshedPill", () => {
  const briefed: MeetingNotice = { ...RETRO, briefingSlug: "retro-brief" };

  it("takes the fresh read's briefing when the page was re-tagged away", () => {
    expect(refreshedPill({ pill: briefed, refreshed: [RETRO] })).toEqual(RETRO);
  });

  it("takes a briefing tagged after the pill went up", () => {
    expect(refreshedPill({ pill: RETRO, refreshed: [STANDUP, briefed] })).toEqual(briefed);
  });

  it("keeps the very same pill when the read changed nothing, so the page does not re-render", () => {
    expect(refreshedPill({ pill: briefed, refreshed: [{ ...briefed }] })).toBe(briefed);
  });

  // Past the verb's late edge no read vouches for the briefing, which may since be re-tagged.
  it("keeps the Join link but drops the briefing once a read no longer names its meeting", () => {
    expect(refreshedPill({ pill: briefed, refreshed: [STANDUP] })).toEqual(RETRO);
  });

  it("keeps the Join link but drops the briefing when the read failed", () => {
    expect(refreshedPill({ pill: briefed, refreshed: null })).toEqual(RETRO);
  });

  it("keeps the very same briefless pill when the read failed", () => {
    expect(refreshedPill({ pill: RETRO, refreshed: null })).toBe(RETRO);
  });

  it("never raises a pill that is not up", () => {
    expect(refreshedPill({ pill: undefined, refreshed: [RETRO] })).toBeUndefined();
  });
});

describe("meetingDueAnswerOf", () => {
  it("reads every meeting in the verb's order", () => {
    const answer = { meetings: [RETRO, STANDUP], readAtIso: "2026-10-09T04:30:10.000Z" };
    expect(meetingDueAnswerOf({ value: answer })).toEqual([RETRO, STANDUP]);
  });

  it("reads an answer with no meeting due as an empty list", () => {
    expect(meetingDueAnswerOf({ value: { meetings: [], readAtIso: "2026-10-09T04:30:10.000Z" } })).toEqual([]);
  });

  it("refuses the whole answer when one meeting in it is unreadable", () => {
    const answer = { meetings: [RETRO, { ...STANDUP, joinUrl: "ftp://x" }] };
    expect(meetingDueAnswerOf({ value: answer })).toBeUndefined();
  });

  it("refuses an answer with no meetings list", () => {
    expect(meetingDueAnswerOf({ value: { readAtIso: "2026-10-09T04:30:10.000Z" } })).toBeUndefined();
  });
});

describe("shownNoticeIdsOf", () => {
  it("reads a short list of ids", () => {
    expect(shownNoticeIdsOf({ value: [RETRO.noticeId] })).toEqual([RETRO.noticeId]);
  });

  it.each([
    ["no list", "retro"],
    ["a non-string id", [RETRO.noticeId, 4]],
    ["an empty id", [""]],
    ["more ids than a call sees", Array.from({ length: SHOWN_MAX + 1 }, (_, index) => `id-${String(index)}`)],
  ])("refuses %s", (_label, value) => {
    expect(shownNoticeIdsOf({ value })).toBeUndefined();
  });
});

describe("nextMeetingNotice", () => {
  const notices: readonly MeetingNotice[] = [RETRO, STANDUP];

  it("picks the soonest meeting the page has not shown", () => {
    expect(nextMeetingNotice({ notices, shown: [RETRO.noticeId] })).toEqual(STANDUP);
  });

  it("picks none once every meeting is shown", () => {
    expect(nextMeetingNotice({ notices, shown: [RETRO.noticeId, STANDUP.noticeId] })).toBeUndefined();
  });
});

describe("meetingToTell", () => {
  const nowMs = Date.parse("2026-10-09T04:40:30.000Z");

  // A response lost at the window's edge leaves a spoken meeting with no link, and a fresh meeting ranked first would
  // hold it past its end.
  it("picks a meeting already said that the page never showed before a fresh one", () => {
    expect(meetingToTell({ claimed: [RETRO], due: [STANDUP], nowMs, shown: [] })).toEqual(RETRO);
    expect(meetingToTell({ claimed: [RETRO], due: [STANDUP], nowMs, shown: [RETRO.noticeId] })).toEqual(STANDUP);
  });

  it("picks a meeting already said that the page never showed, though the verb no longer names it", () => {
    expect(meetingToTell({ claimed: [STANDUP], due: [], nowMs, shown: [] })).toEqual(STANDUP);
    expect(meetingToTell({ claimed: [STANDUP], due: [], nowMs, shown: [STANDUP.noticeId] })).toBeUndefined();
  });

  // Judged again at the route's own instant.
  it("never names a meeting that has ended by now, fresh or already said", () => {
    const ended = Date.parse(RETRO.endIso);
    expect(meetingToTell({ claimed: [RETRO], due: [RETRO], nowMs: ended, shown: [] })).toBeUndefined();
    expect(meetingToTell({ claimed: [RETRO], due: [RETRO], nowMs: ended - 1, shown: [] })).toEqual(RETRO);
  });
});

// The owner is presumed to attend every meeting unless they have said otherwise.
describe("skippedMeetingsOf", () => {
  const SKIP = {
    calendarId: "primary",
    eventId: RETRO.eventId,
    saidAtMs: Date.parse("2026-10-09T04:20:00.000Z"),
    title: "Fixture team retro",
  };

  it("reads a short list of skips, collapsing whitespace in the title it keeps", () => {
    expect(skippedMeetingsOf({ value: [{ ...SKIP, title: "  Fixture \n team retro " }] })).toEqual([SKIP]);
  });

  it("reads an empty list, or no field at all from a page older than skips, as no skip", () => {
    expect([skippedMeetingsOf({ value: [] }), skippedMeetingsOf({ value: undefined })]).toEqual([[], []]);
  });

  it("reads null as no skip, and still refuses a field that is there but not a list", () => {
    expect([skippedMeetingsOf({ value: null }), skippedMeetingsOf({ value: "retro" })]).toEqual([[], undefined]);
  });

  it.each([
    ["no list", SKIP],
    ["a skip with no event id", [{ ...SKIP, eventId: undefined }]],
    ["a skip with an empty calendar id", [{ ...SKIP, calendarId: "" }]],
    ["a skip with an event id past the cap", [{ ...SKIP, eventId: "x".repeat(1_025) }]],
    ["a skip with a blank title", [{ ...SKIP, title: "  " }]],
    ["a skip with a title past the cap", [{ ...SKIP, title: "x".repeat(201) }]],
    ["a skip said at no instant", [{ ...SKIP, saidAtMs: "now" }]],
    ["a skip said at a fraction of a millisecond", [{ ...SKIP, saidAtMs: 1.5 }]],
    ["a skip said before the epoch", [{ ...SKIP, saidAtMs: -1 }]],
    ["one good skip beside one unreadable", [SKIP, { ...SKIP, eventId: 7 }]],
    ["more skips than a day holds", Array.from({ length: MEETING_SKIPS_MAX + 1 }, () => SKIP)],
  ])("refuses %s", (_label, value) => {
    expect(skippedMeetingsOf({ value })).toBeUndefined();
  });

  it("reads exactly as many skips as a page may hold", () => {
    expect(skippedMeetingsOf({ value: Array.from({ length: MEETING_SKIPS_MAX }, () => SKIP) })!.length).toBe(
      MEETING_SKIPS_MAX,
    );
  });
});

describe("unskippedNotices", () => {
  const retroStartMs = Date.parse(RETRO.startIso);
  const skipOf = ({ notice, saidAtMs }: { notice: MeetingNotice; saidAtMs: number }): MeetingSkip => ({
    calendarId: notice.calendarId,
    eventId: notice.eventId,
    saidAtMs,
    title: notice.title,
  });

  it("keeps every meeting when the owner has ruled none out", () => {
    expect(unskippedNotices({ notices: [RETRO, STANDUP], skips: [] })).toEqual([RETRO, STANDUP]);
  });

  it("drops the one meeting the owner said they already had, keeping the rest in order", () => {
    const skips = [skipOf({ notice: RETRO, saidAtMs: retroStartMs - 3 * 60_000 })];
    expect(unskippedNotices({ notices: [RETRO, STANDUP], skips })).toEqual([STANDUP]);
  });

  // An early kickoff the owner skipped and a later kickoff of the same title they did attend are two instances.
  it("keeps a meeting with the same title that is another instance", () => {
    const other: MeetingNotice = {
      ...RETRO,
      eventId: "evtfixture01_20261009T090000Z",
      noticeId: "evtfixture01@google.com@later",
    };
    const skips = [skipOf({ notice: RETRO, saidAtMs: retroStartMs })];
    expect(unskippedNotices({ notices: [RETRO, other], skips })).toEqual([other]);
  });

  it("keeps the same event id on another calendar", () => {
    const skips = [
      { ...skipOf({ notice: RETRO, saidAtMs: retroStartMs }), calendarId: "team@group.calendar.google.com" },
    ];
    expect(unskippedNotices({ notices: [RETRO], skips })).toEqual([RETRO]);
  });

  it("drops by the instance, never the title", () => {
    const skips = [{ ...skipOf({ notice: RETRO, saidAtMs: retroStartMs }), title: "Something else entirely" }];
    expect(unskippedNotices({ notices: [RETRO], skips })).toEqual([]);
  });

  it("reaches twelve hours either side of the owner's word, edges included, and no further", () => {
    const reach = ({ saidAtMs }: { saidAtMs: number }): number =>
      unskippedNotices({ notices: [RETRO], skips: [skipOf({ notice: RETRO, saidAtMs })] }).length;
    expect([
      reach({ saidAtMs: retroStartMs - MEETING_SKIP_HORIZON_MS - 1 }),
      reach({ saidAtMs: retroStartMs - MEETING_SKIP_HORIZON_MS }),
      reach({ saidAtMs: retroStartMs + MEETING_SKIP_HORIZON_MS }),
      reach({ saidAtMs: retroStartMs + MEETING_SKIP_HORIZON_MS + 1 }),
    ]).toEqual([1, 0, 0, 1]);
  });

  it("leaves the list it was given as it was", () => {
    const notices = [RETRO, STANDUP];
    unskippedNotices({ notices, skips: [skipOf({ notice: RETRO, saidAtMs: retroStartMs })] });
    expect(notices).toEqual([RETRO, STANDUP]);
  });
});

describe("pillAfterSkips", () => {
  const skip: MeetingSkip = {
    calendarId: RETRO.calendarId,
    eventId: RETRO.eventId,
    saidAtMs: Date.parse(RETRO.startIso),
    title: RETRO.title,
  };

  it("takes the pill down at once when the owner's word covers its meeting", () => {
    expect(pillAfterSkips({ pill: RETRO, skips: [skip] })).toBeUndefined();
  });

  it("keeps a pill the owner's word does not cover, and has none to keep with none up", () => {
    expect([
      pillAfterSkips({ pill: STANDUP, skips: [skip] }),
      pillAfterSkips({ pill: undefined, skips: [skip] }),
    ]).toEqual([STANDUP, undefined]);
  });
});

describe("meetingStarted", () => {
  const startMs = Date.parse(RETRO.startIso);

  it("is false a moment before the start and true at it", () => {
    expect([
      meetingStarted({ notice: RETRO, nowMs: startMs - 1 }),
      meetingStarted({ notice: RETRO, nowMs: startMs }),
    ]).toEqual([false, true]);
  });
});

describe("meetingPillLive", () => {
  it("lives until the meeting's end", () => {
    const endMs = Date.parse(RETRO.endIso);
    expect([
      meetingPillLive({ notice: RETRO, nowMs: endMs - 1 }),
      meetingPillLive({ notice: RETRO, nowMs: endMs }),
    ]).toEqual([true, false]);
  });
});

describe("MEETING_DUE_BODY_MAX", () => {
  it("takes the widest post a page can make: every list full, every string at its cap, every character escaped", () => {
    const widest = ({ chars }: { chars: number }): string => "\u0000".repeat(chars);
    const body = JSON.stringify({
      shown: Array.from({ length: SHOWN_MAX }, () => widest({ chars: NOTICE_ID_MAX_CHARS })),
      skipped: Array.from({ length: MEETING_SKIPS_MAX }, () => ({
        calendarId: widest({ chars: NOTICE_ID_MAX_CHARS }),
        eventId: widest({ chars: NOTICE_ID_MAX_CHARS }),
        saidAtMs: Number.MAX_SAFE_INTEGER,
        title: widest({ chars: 200 }),
      })),
    });
    const parsed = JSON.parse(body) as { shown: unknown; skipped: unknown };
    expect([
      shownNoticeIdsOf({ value: parsed.shown })!.length,
      skippedMeetingsOf({ value: parsed.skipped })!.length,
      body.length <= MEETING_DUE_BODY_MAX,
      body.length > 80_000,
    ]).toEqual([SHOWN_MAX, MEETING_SKIPS_MAX, true, true]);
  });
});

describe("shownAfter", () => {
  it("adds a meeting once, keeping the order it was shown in", () => {
    expect([
      shownAfter({ noticeId: "b", shown: ["a"] }),
      shownAfter({ noticeId: "a", shown: ["a", "b"] }),
      shownAfter({ noticeId: "a", shown: [] }),
    ]).toEqual([["a", "b"], ["a", "b"], ["a"]]);
  });

  it("keeps the newest SHOWN_MAX, so the post after the 65th meeting is still one the route takes", () => {
    const full = Array.from({ length: SHOWN_MAX }, (_, index) => `notice-${String(index)}`);
    const after = shownAfter({ noticeId: "notice-64", shown: full });
    expect([after.length, after.at(0), after.at(-1), shownNoticeIdsOf({ value: after })!.length]).toEqual([
      SHOWN_MAX,
      "notice-1",
      "notice-64",
      SHOWN_MAX,
    ]);
  });
});
