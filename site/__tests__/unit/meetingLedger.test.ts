/*
 * The process-wide record of meetings the voice was told to say: a claim is seen by every later ask, and a claim is
 * forgotten only once its meeting has ended, when it can never come due again.
 */
import { describe, expect, it } from "vitest";

import type { MeetingNotice } from "../../lib/meetingDue";
import { MeetingLedger, processMeetingLedger } from "../../lib/meetingLedger";

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
const STANDUP: MeetingNotice = {
  ...RETRO,
  noticeId: "standup@google.com@2026-10-09T04:30:00.001Z",
  startIso: "2026-10-09T04:30:00.001Z",
};
const START_MS = Date.parse(RETRO.startIso);

describe("MeetingLedger", () => {
  it("knows a meeting once it is claimed, and no other", () => {
    const ledger = new MeetingLedger();
    expect(ledger.has({ noticeId: RETRO.noticeId })).toBe(false);
    ledger.claim({ notice: RETRO, nowMs: START_MS });
    expect([ledger.has({ noticeId: RETRO.noticeId }), ledger.has({ noticeId: STANDUP.noticeId })]).toEqual([
      true,
      false,
    ]);
    expect(ledger.notices()).toEqual([RETRO]);
  });

  // A claim kept by the start's age would be forgotten while a long meeting still ran.
  it("keeps a claim while its meeting runs, however long, and forgets it on the first claim once it has ended", () => {
    const ledger = new MeetingLedger();
    const endMs = Date.parse(RETRO.endIso);
    const later = { ...STANDUP, endIso: "2026-10-09T06:00:00.000Z" };
    ledger.claim({ notice: RETRO, nowMs: START_MS });
    ledger.claim({ notice: later, nowMs: endMs - 1 });
    expect(ledger.notices()).toEqual([RETRO, later]);
    ledger.claim({ notice: later, nowMs: endMs });
    expect(ledger.notices()).toEqual([later]);
  });

  // A short meeting extended after it was read keeps its notice id, so its read end is not proof.
  it("keeps a claim whose read end has passed while the verb could still name it", () => {
    const ledger = new MeetingLedger();
    const short = { ...RETRO, endIso: "2026-10-09T04:35:00.000Z" };
    ledger.claim({ notice: short, nowMs: START_MS });
    ledger.claim({ notice: STANDUP, nowMs: START_MS + 10 * 60_000 });
    expect(ledger.has({ noticeId: short.noticeId })).toBe(true);
    ledger.claim({ notice: STANDUP, nowMs: START_MS + 10 * 60_000 + 1 });
    expect(ledger.has({ noticeId: short.noticeId })).toBe(false);
  });

  // A claim that kept its first read's end would lose an extended meeting's link once the verb's window had passed it.
  it("takes a later read of a claimed meeting, and leaves a meeting never claimed unclaimed", () => {
    const ledger = new MeetingLedger();
    const extended = { ...RETRO, endIso: "2026-10-09T06:00:00.000Z" };
    ledger.claim({ notice: RETRO, nowMs: START_MS });
    ledger.refresh({ notices: [extended, STANDUP] });
    expect(ledger.notices()).toEqual([extended]);
  });

  it("is one ledger for the whole process, however often it is asked for", () => {
    expect(processMeetingLedger()).toBe(processMeetingLedger());
  });
});
