/*
 * What the meeting-due route answers one ask with, over this read, the ledger's claims and the owner's skips. A meeting
 * the owner told the voice they already had, or are not going to, gets no heads-up — from this read or from a claim an
 * earlier lost answer left behind.
 */
import { describe, expect, it } from "vitest";

import type { MeetingNotice, MeetingSkip } from "../../lib/meetingDue";
import { meetingDueCandidates } from "../../lib/meetingDueCandidates";

const RETRO: MeetingNotice = {
  briefingSlug: "retro-brief",
  calendarId: "primary",
  endIso: "2026-10-09T05:00:00.000Z",
  eventId: "evtfixture01_20261009T043000Z",
  joinUrl: "https://meet.google.com/aaa-bbbb-ccc",
  noticeId: "evtfixture01@google.com@2026-10-09T04:30:00.000Z",
  startIso: "2026-10-09T04:30:00.000Z",
  title: "Fixture team retro",
};

const STANDUP: MeetingNotice = {
  ...RETRO,
  briefingSlug: null,
  eventId: "standup_20261009T043100Z",
  noticeId: "standup@google.com@2026-10-09T04:31:00.000Z",
  startIso: "2026-10-09T04:31:00.000Z",
  title: "Standup",
};

/** The owner said, half an hour before, that they already had the retro. */
const RETRO_SKIP: MeetingSkip = {
  calendarId: "primary",
  eventId: RETRO.eventId,
  saidAtMs: Date.parse("2026-10-09T04:00:00.000Z"),
  title: RETRO.title,
};

const NOW_MS = Date.parse("2026-10-09T04:29:00.000Z");

describe("meetingDueCandidates", () => {
  it("tells the owner a due meeting when they have ruled none out", () => {
    expect(meetingDueCandidates({ claimed: [], nowMs: NOW_MS, read: [RETRO], shown: [], skips: [] })).toEqual({
      notice: RETRO,
      refreshed: [],
    });
  });

  it("passes over a meeting the owner said they already had, to the next one due", () => {
    const answer = meetingDueCandidates({
      claimed: [],
      nowMs: NOW_MS,
      read: [RETRO, STANDUP],
      shown: [],
      skips: [RETRO_SKIP],
    });
    expect(answer).toEqual({ notice: STANDUP, refreshed: [] });
  });

  it("never revives a skipped meeting from a claim an earlier lost answer left in the ledger", () => {
    const answer = meetingDueCandidates({
      claimed: [RETRO],
      nowMs: NOW_MS,
      read: [RETRO],
      shown: [],
      skips: [RETRO_SKIP],
    });
    expect(answer).toEqual({ notice: undefined, refreshed: [] });
  });

  it("never revives a skipped claim when the calendar read failed either", () => {
    const answer = meetingDueCandidates({
      claimed: [RETRO],
      nowMs: NOW_MS,
      read: undefined,
      shown: [],
      skips: [RETRO_SKIP],
    });
    expect(answer).toEqual({ notice: undefined, refreshed: null });
  });

  it("still offers an unskipped claim on a failed read, its briefing dropped since nothing vouches for it", () => {
    const answer = meetingDueCandidates({ claimed: [RETRO], nowMs: NOW_MS, read: undefined, shown: [], skips: [] });
    expect(answer).toEqual({ notice: { ...RETRO, briefingSlug: null }, refreshed: null });
  });

  it("drops a skipped meeting from the fresh copy of the pills already up", () => {
    const answer = meetingDueCandidates({
      claimed: [],
      nowMs: NOW_MS,
      read: [RETRO, STANDUP],
      shown: [RETRO.noticeId, STANDUP.noticeId],
      skips: [RETRO_SKIP],
    });
    expect(answer).toEqual({ notice: undefined, refreshed: [STANDUP] });
  });
});
