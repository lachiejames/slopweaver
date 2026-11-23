/**
 * What the opener says about the owner's last spoken call: their unrelayed words on it, or that there is no record of
 * one. The opener these feed is pinned whole in `continuityCalls.test.ts`; this file pins each line on its own.
 */
import { describe, expect, it } from "vitest";

import { type CallRecord, type CallSegment } from "../../../talk/callRecord.js";
import type { ContinuitySteer, TalkContinuity } from "../../../talk/continuity.js";
import { callsSince } from "../../../talk/continuityCalls.js";
import { callRecordLines, unrelayedLine, unrelayedQuote } from "../../../talk/continuityLastCall.js";
import { resumeLines } from "../../../talk/mintOpener.js";

const SINCE = "2026-09-22T02:30:00.000Z";
const UNREAD_CALLS = [{ section: "calls", why: "1 newer call file could not be read" }] as const;

/** One segment, overridable. */
const segment = (over: Partial<CallSegment> = {}): CallSegment => ({
  atIso: "2026-09-25T02:25:00.000Z",
  beganIso: "2026-09-25T02:25:00.000Z",
  final: true,
  id: "s-1",
  open: undefined,
  text: "look at the staging pool",
  who: "owner",
  ...over,
});

/** One dropped call: the owner's words either side of the relay at 02:26. */
const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  callId: "a0000041-0000-4000-8000-000000000044",
  ended: undefined,
  lastIso: "2026-09-25T02:29:40.000Z",
  notes: [],
  offers: [],
  openedIso: "2026-09-25T02:20:00.000Z",
  origin: undefined,
  reconnects: [],
  segments: [
    segment(),
    segment({ atIso: "2026-09-25T02:29:10.000Z", id: "s-2", text: "and merge the ISO PR once CI is green" }),
    segment({ atIso: "2026-09-25T02:29:40.000Z", id: "s-3", text: "then ping Ari" }),
  ],
  sessionId: "sess_1",
  skipped: 0,
  surface: "voice",
  usages: [],
  voice: "marin",
  written: [],
  ...over,
});

/** The steer relaying the owner's first words. */
const steer = ({ atIso }: { atIso: string }): ContinuitySteer => ({
  atIso,
  delivery: { detail: "typed", kind: "typed" },
  heard: "look at the staging pool",
  outcome: { lastAction: undefined, marks: [], rowPresent: true, settlement: undefined },
  reachedChat: true,
  slug: "talk-9b2f",
  turnId: "a0000075-0000-4000-8000-000000000082",
  typed: false,
  words: "Look at the staging pool.",
});

/** A read holding the calls given and the 02:26 steer. */
const continuity = (over: Partial<TalkContinuity> = {}): TalkContinuity => ({
  builtIso: "2026-09-25T02:40:00.000Z",
  calls: callsSince({ calls: [call()], sinceIso: SINCE }),
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [steer({ atIso: "2026-09-25T02:26:00.000Z" })],
  typed: [],
  unread: [],
  ...over,
});

const CALL_SAID =
  "opened 2026-09-25T02:20:00.000Z, no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z";

describe("callRecordLines", () => {
  it("says nothing when a spoken call is on record", () => {
    expect(callRecordLines({ continuity: continuity() })).toEqual([]);
  });

  it("says there is no record when no call in the window has a line", () => {
    const empty = call({ segments: [] });
    expect(
      callRecordLines({ continuity: continuity({ calls: callsSince({ calls: [empty], sinceIso: SINCE }) }) }),
    ).toEqual([
      `No earlier call of yours with the owner is written down since ${SINCE}: if they ask where you were, say you have no record of it — never guess or invent what it was about.`,
    ]);
  });

  // A newer call whose only speech line tore may hold the owner's newest words, so the older call is not their last.
  it("says the last call could not be read when its every line tore, and quotes no older call as where the owner left off", () => {
    const torn = call({ callId: "torn", lastIso: "2026-09-25T02:35:00.000Z", segments: [], skipped: 1 });
    const read = continuity({ calls: callsSince({ calls: [call(), torn], sinceIso: SINCE }) });
    expect(callRecordLines({ continuity: read })).toEqual([
      "The owner's last call with you (no end recorded — it dropped or the page went away; last heard 2026-09-25T02:35:00.000Z) has no line that could be read: if they ask where you were, say you could not read it — never guess.",
    ]);
    expect(unrelayedLine({ continuity: read })).toBe(undefined);
    expect(resumeLines({ continuity: read })).toEqual([]);
  });

  it("says the calls could not be read rather than that there were none", () => {
    expect(callRecordLines({ continuity: continuity({ calls: [], unread: [...UNREAD_CALLS] }) })).toEqual([
      "The owner's earlier calls could not be read: if they ask where you were, say you could not read them — never guess.",
    ]);
  });
});

describe("unrelayedLine", () => {
  it("names the owner's words after the relay as where they left off", () => {
    expect(unrelayedQuote({ continuity: continuity() })).toEqual({
      call: CALL_SAID,
      quote: "and merge the ISO PR once CI is green … then ping Ari",
    });
    expect(unrelayedLine({ continuity: continuity() })).toEqual({
      leftOff: true,
      line: `Where you left off: on the owner's last call with you (${CALL_SAID}) they last said: "and merge the ISO PR once CI is green … then ping Ari".`,
    });
  });

  it("never calls them where the owner left off when a call file could not be read", () => {
    expect(unrelayedLine({ continuity: continuity({ unread: [...UNREAD_CALLS] }) })).toEqual({
      leftOff: false,
      line: `On a call with you that may not be the owner's last (${CALL_SAID}) they said: "and merge the ISO PR once CI is green … then ping Ari".`,
    });
  });

  it("keeps the owner's newest words when the quote runs past its bound, cutting from the start", () => {
    const long = `OLDEST ${"x".repeat(400)} NEWEST`;
    const segments = [segment({ atIso: "2026-09-25T02:29:10.000Z", id: "s-2", text: long })];
    const read = continuity({ calls: callsSince({ calls: [call({ segments })], sinceIso: SINCE }) });
    expect(unrelayedLine({ continuity: read })).toEqual({
      leftOff: true,
      line: `Where you left off: on the owner's last call with you (${CALL_SAID}) they last said: "…${"x".repeat(293)} NEWEST".`,
    });
  });

  // A torn last line may have held the owner's newest words, so the line says so rather than claiming them all.
  it("says when a line of that call could not be read, and says nothing of it when none was torn", () => {
    const torn = continuity({ calls: callsSince({ calls: [call({ skipped: 1 })], sinceIso: SINCE }) });
    expect(unrelayedLine({ continuity: torn })!.line).toBe(
      `Where you left off: on the owner's last call with you (${CALL_SAID}) they last said: "and merge the ISO PR once CI is green … then ping Ari". 1 line(s) of that call's file could not be read, so the owner's newest words may be missing; if they say otherwise, they are right.`,
    );
    expect(unrelayedLine({ continuity: continuity() })!.line).not.toContain("could not be read");
  });

  // Whitespace is flattened before either cut counts it.
  it("keeps every word when only whitespace ran past the bound", () => {
    const segments = [
      segment({ atIso: "2026-09-25T02:29:10.000Z", id: "s-2", text: `OLDEST${" ".repeat(700)}NEWEST` }),
    ];
    const read = continuity({ calls: callsSince({ calls: [call({ segments })], sinceIso: SINCE }) });
    expect(unrelayedLine({ continuity: read })!.line).toBe(
      `Where you left off: on the owner's last call with you (${CALL_SAID}) they last said: "OLDEST NEWEST".`,
    );
  });

  // A cut counted in UTF-16 units would split the emoji below into a lone surrogate.
  it("cuts by character, so an emoji at the bound survives whole", () => {
    const segments = [segment({ atIso: "2026-09-25T02:29:10.000Z", id: "s-2", text: `A😀${"x".repeat(299)}` })];
    const read = continuity({ calls: callsSince({ calls: [call({ segments })], sinceIso: SINCE }) });
    expect(unrelayedLine({ continuity: read })!.line).toBe(
      `Where you left off: on the owner's last call with you (${CALL_SAID}) they last said: "…😀${"x".repeat(299)}".`,
    );
  });

  it("says nothing when every word on the call was relayed", () => {
    const relayedAll = continuity({ steers: [steer({ atIso: "2026-09-25T02:35:00.000Z" })] });
    expect(unrelayedLine({ continuity: relayedAll })).toBe(undefined);
  });
});
