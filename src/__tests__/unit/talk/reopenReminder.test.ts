/*
 * Whether a call the owner starts is a reopen of the one they just hung up on, and the reminder it is minted with. A
 * call reopened a minute later reminds the owner where they left off, after three seconds of their silence. The minute
 * is pinned here; the three seconds in `site/__tests__/unit/talkPlanCall/`.
 */
import { describe, expect, it } from "vitest";

import type { CallRecord, CallSegment } from "../../../talk/callRecord.js";
import type { TalkContinuity } from "../../../talk/continuity.js";
import { callsSince, newestSpokenOf, testCallsSince } from "../../../talk/continuityCalls.js";
import { REOPEN_REMINDER_WINDOW_MS, reopenReminderFrom, reopenReminderOf } from "../../../talk/reopenReminder.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const SINCE = "2026-09-22T02:30:00.000Z";
const ENDED = "2026-09-25T02:30:00.000Z";

/** One segment, overridable. */
const segment = (over: Partial<CallSegment> = {}): CallSegment => ({
  atIso: "2026-09-25T02:29:00.000Z",
  beganIso: "2026-09-25T02:29:00.000Z",
  final: true,
  id: "s-1",
  open: undefined,
  text: "look at the staging pool",
  who: "owner",
  ...over,
});

/** One call the owner hung up on at {@link ENDED}. */
const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  callId: CALL,
  ended: { atIso: ENDED, why: null },
  lastIso: "2026-09-25T02:29:30.000Z",
  notes: [],
  offers: [],
  openedIso: "2026-09-25T02:20:00.000Z",
  origin: undefined,
  reconnects: [],
  segments: [segment(), segment({ atIso: "2026-09-25T02:29:30.000Z", id: "s-2", text: "on it", who: "voice" })],
  sessionId: "sess_1",
  skipped: 0,
  surface: "voice",
  usages: [],
  voice: "marin",
  written: [],
  ...over,
});

/** A read taken the given milliseconds after the call ended. */
const readAfter = ({ ms, over = {} }: { ms: number; over?: Partial<TalkContinuity> }): TalkContinuity => ({
  builtIso: new Date(Date.parse(ENDED) + ms).toISOString(),
  calls: callsSince({ calls: [call()], sinceIso: SINCE }),
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [],
  typed: [],
  unread: [],
  ...over,
});

describe("reopenReminderOf", () => {
  it("is a minute, the meaning of 'a minute later'", () => {
    expect(REOPEN_REMINDER_WINDOW_MS).toBe(60_000);
  });

  it("reminds a fresh call minted inside the minute, quoting the exchange it recaps", () => {
    const reminder = reopenReminderOf({ continuity: readAfter({ ms: 20_000 }), mode: "fresh" })!;
    expect(reminder.previousCallId).toBe(CALL);
    expect(reminder.previousEndedIso).toBe(ENDED);
    expect(reminder.text.split("\n")).toEqual([
      "The owner reopened the call a moment after hanging up, and has said nothing for the first few seconds of this one.",
      "Remind them where you left off, in one short sentence of your own, from the exchange quoted below, the way a",
      "colleague picks a conversation back up ('So, where we were: …'). No greeting, never say a call ended or that",
      "you are back, and add nothing after it but at most a short 'want to carry on?'. If they start talking, stop and",
      "answer them instead.",
      "The call the owner just hung up on (the owner hung up at 2026-09-25T02:30:00.000Z) ended on this exchange, oldest first:",
      '- the owner: "look at the staging pool"',
      '- you: "on it"',
    ]);
  });

  it("is inside the window at sixty seconds and out of it one millisecond later", () => {
    expect(reopenReminderOf({ continuity: readAfter({ ms: 59_999 }), mode: "fresh" })!.previousCallId).toBe(CALL);
    expect(reopenReminderOf({ continuity: readAfter({ ms: 60_000 }), mode: "fresh" })!.previousCallId).toBe(CALL);
    expect(reopenReminderOf({ continuity: readAfter({ ms: 60_001 }), mode: "fresh" })).toBe(null);
  });

  it("is no reopen when the end is stamped at or after the read, or the read is no date", () => {
    expect(reopenReminderOf({ continuity: readAfter({ ms: 0 }), mode: "fresh" })).toBe(null);
    expect(reopenReminderOf({ continuity: readAfter({ ms: -1 }), mode: "fresh" })).toBe(null);
    const undated = readAfter({ ms: 0, over: { builtIso: "not a date" } });
    expect(reopenReminderOf({ continuity: undated, mode: "fresh" })).toBe(null);
  });

  it("leaves a reconnect and a rollover silent, each by its own opener", () => {
    expect(reopenReminderOf({ continuity: readAfter({ ms: 5_000 }), mode: "reconnect" })).toBe(null);
    expect(reopenReminderOf({ continuity: readAfter({ ms: 5_000 }), mode: "rollover" })).toBe(null);
  });

  it("judges the minute from the recorded end, so a dropped call with none is no reopen", () => {
    const dropped = callsSince({ calls: [call({ ended: undefined })], sinceIso: SINCE });
    expect(reopenReminderOf({ continuity: readAfter({ ms: 5_000, over: { calls: dropped } }), mode: "fresh" })).toBe(
      null,
    );
  });

  it("recaps nothing when the last call had no line, or a call file could not be read", () => {
    const silent = callsSince({ calls: [call({ segments: [] })], sinceIso: SINCE });
    expect(reopenReminderOf({ continuity: readAfter({ ms: 5_000, over: { calls: silent } }), mode: "fresh" })).toBe(
      null,
    );
    const unread = [{ section: "calls", why: "1 newer call file could not be read" }] as const;
    expect(
      reopenReminderOf({ continuity: readAfter({ ms: 5_000, over: { unread: [...unread] } }), mode: "fresh" }),
    ).toBe(null);
  });
});

/** The desktop test instance's mark on a call record. */
const E2E_ORIGIN: NonNullable<CallRecord["origin"]> = {
  checkoutRoot: "/checkouts/acme",
  defaultPort: 3000,
  instance: "e2e",
  mainWorktree: true,
  port: 3000,
};
const TEST_CALL = "4c3b2a1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";

describe("the desktop test instance's reopen (testCallsSince, newestSpokenOf, reopenReminderFrom)", () => {
  const own = call({ ended: { atIso: "2026-09-25T02:30:10.000Z", why: null }, lastIso: "2026-09-25T02:30:05.000Z" });
  const walk = call({ callId: TEST_CALL, origin: E2E_ORIGIN });

  it("keeps only the test instance's calls, and the owner's continuity keeps only theirs", () => {
    expect(testCallsSince({ calls: [own, walk], sinceIso: SINCE }).map((c) => c.callId)).toEqual([TEST_CALL]);
    expect(callsSince({ calls: [own, walk], sinceIso: SINCE }).map((c) => c.callId)).toEqual([CALL]);
  });

  it("reminds a test call of the walk's own last call, never the owner's newer one", () => {
    const reminder = reopenReminderFrom({
      builtIso: "2026-09-25T02:30:20.000Z",
      callsUnread: false,
      last: newestSpokenOf({ calls: testCallsSince({ calls: [own, walk], sinceIso: SINCE }) }),
      mode: "fresh",
    })!;
    expect(reminder.previousCallId).toBe(TEST_CALL);
    expect(reminder.previousEndedIso).toBe(ENDED);
  });

  it("is no reopen with no test call spoken, or with a call file unread", () => {
    expect(
      reopenReminderFrom({ builtIso: "2026-09-25T02:30:20.000Z", callsUnread: false, last: undefined, mode: "fresh" }),
    ).toBe(null);
    const last = newestSpokenOf({ calls: testCallsSince({ calls: [walk], sinceIso: SINCE }) });
    expect(reopenReminderFrom({ builtIso: "2026-09-25T02:30:20.000Z", callsUnread: true, last, mode: "fresh" })).toBe(
      null,
    );
  });

  it("passes over a newer test call with no line, as the owner's own read does", () => {
    const empty = call({
      callId: "a0000093-0000-4000-8000-000000000100",
      lastIso: "2026-09-25T02:30:15.000Z",
      origin: E2E_ORIGIN,
      segments: [],
    });
    expect(newestSpokenOf({ calls: testCallsSince({ calls: [walk, empty], sinceIso: SINCE }) })!.callId).toBe(
      TEST_CALL,
    );
  });
});
