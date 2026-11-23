/*
 * The page's meeting watch over plain fake seams: which answer of the route means what, what it shows and logs, how
 * soon it asks again, and that it stops when the call is no longer the page's. Nothing is mocked: the timer is a list
 * the test runs by hand and the route a queue of answers.
 */
import { describe, expect, it } from "vitest";

import type { MeetingNotice, MeetingSkip } from "../../lib/meetingDue";
import {
  MEETING_POLL_MS,
  MEETING_RETRY_MS,
  type MeetingPost,
  meetingPostOf,
  meetingShownDetail,
  watchMeetings,
} from "../../lib/meetingDueWatch";

const RETRO: MeetingNotice = {
  briefingSlug: null,
  calendarId: "primary",
  endIso: "2026-10-09T05:00:00.000Z",
  eventId: "evtfixture01_20261009T043000Z",
  joinUrl: "https://meet.google.com/aaa-bbbb-ccc",
  noticeId: "evtfixture01@google.com@2026-10-09T04:30:00.000Z",
  startIso: "2026-10-09T04:30:00.000Z",
  title: "Fixture team retro",
};

const RETRO_BRIEFED: MeetingNotice = { ...RETRO, briefingSlug: "retro-brief" };

const NONE: MeetingPost = { kind: "none", refreshed: [] };

describe("meetingPostOf", () => {
  it("reads a meeting the route said", () => {
    const body = { already: false, meeting: RETRO, ok: true, refreshed: [], unspoken: null };
    expect(meetingPostOf({ body, status: 200, why: "unused" })).toEqual({
      already: false,
      kind: "due",
      meeting: RETRO,
      refreshed: [],
      unspoken: undefined,
    });
  });

  it("carries why the voice did not say a meeting it still shows", () => {
    const body = { already: false, meeting: RETRO, ok: true, refreshed: [], unspoken: "no session" };
    expect(meetingPostOf({ body, status: 200, why: "unused" })).toEqual({
      already: false,
      kind: "due",
      meeting: RETRO,
      refreshed: [],
      unspoken: "no session",
    });
  });

  it("reads no meeting due as none", () => {
    const body = { already: false, meeting: null, ok: true, refreshed: [], unspoken: null };
    expect(meetingPostOf({ body, status: 200, why: "unused" })).toEqual(NONE);
  });

  // A pill already up follows the route's fresh read of it.
  it("carries the fresh read of meetings already shown, dropping one it cannot read rather than the answer", () => {
    const refreshed = [RETRO_BRIEFED, { ...RETRO, joinUrl: "javascript:x" }];
    const body = { already: false, meeting: null, ok: true, refreshed, unspoken: null };
    expect(meetingPostOf({ body, status: 200, why: "unused" })).toEqual({ kind: "none", refreshed: [RETRO_BRIEFED] });
  });

  it("reads a route with no fresh read as no read, never as a read naming nothing", () => {
    const body = { already: false, meeting: null, ok: true, refreshed: null, unspoken: null };
    expect(meetingPostOf({ body, status: 200, why: "unused" })).toEqual({ kind: "none", refreshed: null });
  });

  it("retries a taken floor and a lost response", () => {
    expect([
      meetingPostOf({ body: { ok: false }, status: 409, why: "someone is talking" }),
      meetingPostOf({ body: undefined, status: undefined, why: "the meeting check did not answer" }),
    ]).toEqual([
      { kind: "retry", refreshed: null, why: "someone is talking" },
      { kind: "retry", refreshed: null, why: "the meeting check did not answer" },
    ]);
  });

  // A floor held for minutes must not hold a stale briefing up with it.
  it("carries the read a taken floor's answer still made", () => {
    const body = { ok: false, refreshed: [RETRO], refused: "someone is talking" };
    expect(meetingPostOf({ body, status: 409, why: "someone is talking" })).toEqual({
      kind: "retry",
      refreshed: [RETRO],
      why: "someone is talking",
    });
  });

  it("drops any other refusal, a body that is no JSON, and a meeting the page cannot read", () => {
    expect([
      meetingPostOf({ body: { ok: false }, status: 502, why: "talk meeting-due did not print JSON" }),
      meetingPostOf({ body: undefined, status: 200, why: "unused" }),
      meetingPostOf({ body: { meeting: { ...RETRO, joinUrl: "javascript:x" } }, status: 200, why: "unused" }),
    ]).toEqual([
      { kind: "dropped", refreshed: null, why: "talk meeting-due did not print JSON" },
      { kind: "dropped", refreshed: null, why: "the meeting-due route answered no JSON" },
      { kind: "dropped", refreshed: null, why: "the meeting-due route answered a meeting this page cannot read" },
    ]);
  });
});

describe("meetingShownDetail", () => {
  it("says whether the voice said it, said it earlier, or would not", () => {
    const due = { already: false, kind: "due", meeting: RETRO, refreshed: [], unspoken: undefined } as const;
    expect([
      meetingShownDetail({ post: due }),
      meetingShownDetail({ post: { ...due, already: true } }),
      meetingShownDetail({ post: { ...due, unspoken: "no session" } }),
    ]).toEqual([
      "Fixture team retro: said, join link shown",
      "Fixture team retro: said earlier on this call, join link shown",
      "Fixture team retro: not said (no session), join link shown",
    ]);
  });
});

/** Resolve the microtasks a post's answer runs on. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

/**
 * The watch over fake seams: `answers` are the route's answers in order, `timers` the asks scheduled.
 *
 * @param answers what each post answers, in order
 * @returns the harness
 */
function harness({ answers }: { answers: MeetingPost[] }): {
  timers: { ms: number; run: () => void; cancelled: boolean }[];
  posts: (readonly string[])[];
  postedSkips: (readonly MeetingSkip[])[];
  shown: MeetingNotice[];
  refreshes: (readonly MeetingNotice[] | null)[];
  notes: { detail: string; refused: boolean }[];
  setLive: (input: { live: boolean }) => void;
  setSkipped: (input: { skips: readonly MeetingSkip[] }) => void;
  stop: () => void;
} {
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const posts: (readonly string[])[] = [];
  const postedSkips: (readonly MeetingSkip[])[] = [];
  const shown: MeetingNotice[] = [];
  const refreshes: (readonly MeetingNotice[] | null)[] = [];
  const notes: { detail: string; refused: boolean }[] = [];
  let live = true;
  let skipped: readonly MeetingSkip[] = [];
  const stop = watchMeetings({
    seams: {
      after: ({ ms, run }) => {
        const timer = { cancelled: false, ms, run };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      live: () => live,
      note: (line) => {
        notes.push(line);
      },
      post: async ({ shown: ids, skipped: skips }) => {
        posts.push(ids);
        postedSkips.push(skips);
        return answers.shift()!;
      },
      refresh: ({ notices }) => {
        refreshes.push(notices);
      },
      show: ({ meeting }) => {
        shown.push(meeting);
      },
      shown: () => shown.map((meeting) => meeting.noticeId),
      skipped: () => skipped,
    },
  });
  return {
    notes,
    postedSkips,
    posts,
    refreshes,
    setLive: ({ live: next }) => {
      live = next;
    },
    setSkipped: ({ skips }) => {
      skipped = skips;
    },
    shown,
    stop,
    timers,
  };
}

describe("watchMeetings", () => {
  it("asks at once, shows the meeting the route said, logs it, and asks again on the cadence with it shown", async () => {
    const due: MeetingPost = { already: false, kind: "due", meeting: RETRO, refreshed: [], unspoken: undefined };
    const h = harness({ answers: [due, NONE] });
    await settle();
    expect(h.shown).toEqual([RETRO]);
    expect(h.notes).toEqual([{ detail: "Fixture team retro: said, join link shown", refused: false }]);
    expect(h.timers.map((timer) => timer.ms)).toEqual([MEETING_POLL_MS]);
    h.timers.at(0)!.run();
    await settle();
    expect(h.posts).toEqual([[], [RETRO.noticeId]]);
  });

  // A poll with nothing new to say still carries the shown pill's fresh read.
  it("hands every answer's fresh read to the pill, a quiet poll's too", async () => {
    const due: MeetingPost = { already: false, kind: "due", meeting: RETRO, refreshed: [], unspoken: undefined };
    const h = harness({ answers: [due, { kind: "none", refreshed: [RETRO_BRIEFED] }] });
    await settle();
    h.timers.at(0)!.run();
    await settle();
    expect(h.refreshes).toEqual([[], [RETRO_BRIEFED]]);
  });

  it("asks again soon when the floor was taken, handing the pill the read the answer still made", async () => {
    const h = harness({ answers: [{ kind: "retry", refreshed: [RETRO], why: "someone is talking" }] });
    await settle();
    expect(h.timers.map((timer) => timer.ms)).toEqual([MEETING_RETRY_MS]);
    expect([h.notes, h.refreshes]).toEqual([[], [[RETRO]]]);
  });

  it("logs a dropped check once per reason, not every poll", async () => {
    const dropped: MeetingPost = { kind: "dropped", refreshed: null, why: "no calendar connected" };
    const h = harness({
      answers: [dropped, dropped, { kind: "dropped", refreshed: null, why: "the read timed out" }],
    });
    await settle();
    h.timers.at(0)!.run();
    await settle();
    h.timers.at(1)!.run();
    await settle();
    expect(h.notes).toEqual([
      { detail: "no meeting check: no calendar connected", refused: true },
      { detail: "no meeting check: the read timed out", refused: true },
    ]);
    expect(h.timers.map((timer) => timer.ms)).toEqual([MEETING_POLL_MS, MEETING_POLL_MS, MEETING_POLL_MS]);
  });

  // A failed read vouches for no briefing, so the pill up loses its link until one does.
  it("hands the pill no read when a check is dropped", async () => {
    const h = harness({ answers: [{ kind: "dropped", refreshed: null, why: "the read timed out" }] });
    await settle();
    expect(h.refreshes).toEqual([null]);
  });

  it("shows nothing and schedules nothing once the call stopped being the page's mid-ask", async () => {
    const due: MeetingPost = { already: false, kind: "due", meeting: RETRO, refreshed: [RETRO], unspoken: undefined };
    const h = harness({ answers: [due] });
    h.setLive({ live: false });
    await settle();
    expect([h.shown, h.refreshes, h.timers]).toEqual([[], [], []]);
  });

  it("posts the meetings the owner said they are skipping with every ask", async () => {
    const skip: MeetingSkip = {
      calendarId: "primary",
      eventId: RETRO.eventId,
      saidAtMs: Date.parse("2026-10-09T04:00:00.000Z"),
      title: RETRO.title,
    };
    const h = harness({ answers: [NONE, NONE] });
    await settle();
    h.setSkipped({ skips: [skip] });
    h.timers.at(0)!.run();
    await settle();
    expect(h.postedSkips).toEqual([[], [skip]]);
  });

  // A skip said while the ask was out still binds, so the route's answer judged without it never puts the pill up.
  it("never shows a meeting the owner said they are skipping while the ask was out, and logs why", async () => {
    const due: MeetingPost = { already: false, kind: "due", meeting: RETRO, refreshed: [], unspoken: undefined };
    const skip: MeetingSkip = {
      calendarId: "primary",
      eventId: RETRO.eventId,
      saidAtMs: Date.parse("2026-10-09T04:00:00.000Z"),
      title: RETRO.title,
    };
    const h = harness({ answers: [due] });
    h.setSkipped({ skips: [skip] });
    await settle();
    expect([h.shown, h.notes, h.timers.map((timer) => timer.ms)]).toEqual([
      [],
      [{ detail: "Fixture team retro: skipped on the owner's word, no join link", refused: false }],
      [MEETING_POLL_MS],
    ]);
  });

  it("still shows a meeting when the owner's skip names another instance", async () => {
    const due: MeetingPost = { already: false, kind: "due", meeting: RETRO, refreshed: [], unspoken: undefined };
    const skip: MeetingSkip = {
      calendarId: "primary",
      eventId: "retro_20261002T043000Z",
      saidAtMs: Date.parse("2026-10-09T04:00:00.000Z"),
      title: RETRO.title,
    };
    const h = harness({ answers: [due] });
    h.setSkipped({ skips: [skip] });
    await settle();
    expect(h.shown).toEqual([RETRO]);
  });

  it("cancels the next ask when stopped", async () => {
    const h = harness({ answers: [NONE] });
    await settle();
    h.stop();
    expect(h.timers.map((timer) => timer.cancelled)).toEqual([true]);
  });
});
