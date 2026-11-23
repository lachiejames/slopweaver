/**
 * The unread-voice gate: a tick is refused while any finished word of the owner's is unread once their two-minute quiet floor has
 * passed — old, or stamped far ahead — or any unread line did not parse, or the cursor has never been marked. Inside
 * the floor every unread word is named and refuses nothing; past it, a stretch still being spoken, grown past a read of
 * it within a minute of the tick, is too.
 */
import { describe, expect, it } from "vitest";

import { judgeVoiceUnread, STILL_SPEAKING_MS } from "../../../supervisor/voiceUnreadGate.js";
import { QUIET_BEFORE_DELIVERY_MS } from "../../../talk/chairWake.js";
import type { UnreadWord } from "../../../talk/unreadWords.js";

const TICK = "2026-09-26T06:00:00.000Z";

const word = ({
  atIso,
  final,
  growingSinceRead = false,
  segmentId = "s",
}: {
  atIso: string;
  final: boolean;
  growingSinceRead?: boolean;
  segmentId?: string;
}): UnreadWord => ({
  atIso,
  callId: "a0000035-0000-4000-8000-000000000038",
  cut: false,
  final,
  growingSinceRead,
  latestAtIso: atIso,
  nextRelay: undefined,
  pointer: `talk-call:a0000035-0000-4000-8000-000000000038#${segmentId}`,
  revisions: [],
  segmentId,
  text: "merge it",
});

/** An instant `ms` from the tick. */
const fromTick = ({ ms }: { ms: number }): string => new Date(Date.parse(TICK) + ms).toISOString();

describe("judgeVoiceUnread", () => {
  it("is clean with nothing unread", () => {
    expect(
      judgeVoiceUnread({ nowIso: TICK, read: { kind: "read", neverMarked: false, unparseable: [], words: [] } }),
    ).toEqual({ kind: "clean", stillSpoken: [] });
  });

  it.each([
    [
      "a finished word exactly two minutes before the tick",
      word({ atIso: fromTick({ ms: -QUIET_BEFORE_DELIVERY_MS }), final: true }),
    ],
    [
      "a stretch nobody has read the start of, past the floor",
      word({ atIso: fromTick({ ms: -QUIET_BEFORE_DELIVERY_MS - 1000 }), final: false }),
    ],
    ["a stretch cut off an hour before the tick", word({ atIso: "2026-09-26T05:00:00.000Z", final: false })],
    ["a word stamped an hour ahead of the tick", word({ atIso: "2026-09-26T07:00:00.000Z", final: true })],
    [
      "a stretch grown since read that stopped growing, past the floor",
      word({ atIso: fromTick({ ms: -QUIET_BEFORE_DELIVERY_MS }), final: false, growingSinceRead: true }),
    ],
    [
      "a stretch grown since read stamped past the bound ahead of the tick",
      word({ atIso: fromTick({ ms: STILL_SPEAKING_MS + 1 }), final: false, growingSinceRead: true }),
    ],
  ])("refuses %s, naming it", (_label, unread) => {
    const read = { kind: "read", neverMarked: false, unparseable: [], words: [unread] } as const;

    expect(judgeVoiceUnread({ nowIso: TICK, read })).toEqual({
      kind: "refused",
      neverMarked: false,
      stillSpoken: [],
      unparseable: [],
      words: [unread],
    });
  });

  it("passes every unread word, finished ones included, while their newest is one millisecond inside the floor", () => {
    const older = word({ atIso: fromTick({ ms: -10 * 60_000 }), final: true, segmentId: "older" });
    const newest = word({ atIso: fromTick({ ms: -QUIET_BEFORE_DELIVERY_MS + 1 }), final: true, segmentId: "newest" });
    const read = { kind: "read", neverMarked: false, unparseable: [], words: [older, newest] } as const;

    expect(judgeVoiceUnread({ nowIso: TICK, read })).toEqual({ kind: "clean", stillSpoken: [older, newest] });
  });

  it("refuses every finished word once their newest is exactly two minutes old", () => {
    const older = word({ atIso: fromTick({ ms: -10 * 60_000 }), final: true, segmentId: "older" });
    const newest = word({ atIso: fromTick({ ms: -QUIET_BEFORE_DELIVERY_MS }), final: true, segmentId: "newest" });
    const read = { kind: "read", neverMarked: false, unparseable: [], words: [older, newest] } as const;

    expect(judgeVoiceUnread({ nowIso: TICK, read })).toEqual({
      kind: "refused",
      neverMarked: false,
      stillSpoken: [],
      unparseable: [],
      words: [older, newest],
    });
  });

  it("opens the floor for a word stamped up to the bound ahead of the tick, and not one millisecond past it", () => {
    const atBound = word({ atIso: fromTick({ ms: STILL_SPEAKING_MS }), final: true });
    const pastBound = word({ atIso: fromTick({ ms: STILL_SPEAKING_MS + 1 }), final: true });

    expect(
      judgeVoiceUnread({ nowIso: TICK, read: { kind: "read", neverMarked: false, unparseable: [], words: [atBound] } }),
    ).toEqual({ kind: "clean", stillSpoken: [atBound] });
    expect(
      judgeVoiceUnread({
        nowIso: TICK,
        read: { kind: "read", neverMarked: false, unparseable: [], words: [pastBound] },
      }),
    ).toEqual({ kind: "refused", neverMarked: false, stillSpoken: [], unparseable: [], words: [pastBound] });
  });

  it("passes a growing turn as still being spoken, at the bound on either side, and names it", () => {
    const growing = word({ atIso: fromTick({ ms: -4000 }), final: false, growingSinceRead: true });
    const atBound = word({
      atIso: fromTick({ ms: -STILL_SPEAKING_MS }),
      final: false,
      growingSinceRead: true,
      segmentId: "bound",
    });
    const ahead = word({
      atIso: fromTick({ ms: STILL_SPEAKING_MS }),
      final: false,
      growingSinceRead: true,
      segmentId: "ahead",
    });
    const read = { kind: "read", neverMarked: false, unparseable: [], words: [growing, atBound, ahead] } as const;

    expect(judgeVoiceUnread({ nowIso: TICK, read })).toEqual({
      kind: "clean",
      stillSpoken: [growing, atBound, ahead],
    });
  });

  it("refuses for an unparseable line inside the floor, which may be the owner's words", () => {
    const line = { byteOffset: 0, callId: "a0000035-0000-4000-8000-000000000038", text: "{" };
    const young = word({ atIso: fromTick({ ms: -1000 }), final: true });
    expect(
      judgeVoiceUnread({
        nowIso: TICK,
        read: { kind: "read", neverMarked: false, unparseable: [line], words: [young] },
      }),
    ).toEqual({ kind: "refused", neverMarked: false, stillSpoken: [young], unparseable: [line], words: [] });
  });

  it("refuses a cursor that has never been marked, even with nothing in the first-read window", () => {
    expect(
      judgeVoiceUnread({ nowIso: TICK, read: { kind: "read", neverMarked: true, unparseable: [], words: [] } }),
    ).toEqual({ kind: "refused", neverMarked: true, stillSpoken: [], unparseable: [], words: [] });
  });

  it("passes an unreadable read through as unreadable", () => {
    expect(judgeVoiceUnread({ nowIso: TICK, read: { kind: "unreadable", why: "cursor malformed" } })).toEqual({
      kind: "unreadable",
      why: "cursor malformed",
    });
  });
});
