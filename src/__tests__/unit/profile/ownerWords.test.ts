/**
 * The owner's own words as `profile words` answers them: three records turned into one list, filtered by window, how and
 * phrase, newest first, with every record it could not take whole said rather than dropped.
 */
import { describe, expect, it } from "vitest";

import {
  isConsoleTypedLine,
  isVoiceRelayLine,
  type OwnerUtterance,
  queryOwnerWords,
  utteranceFromRaw,
  utterancesFromCalls,
  utterancesFromConsoleTurns,
  utterancesFromSupervisorTurns,
} from "../../../profile/ownerWords.js";
import { minuteOf, ownerWordsLines, utteranceHead } from "../../../profile/ownerWordsLines.js";
import type { OwnerTurn } from "../../../supervisor/intake.js";
import { CALL_TEXT_CHARS, type CallRecord, type CallSegment } from "../../../talk/callRecord.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";
import { chairWakeLine } from "../../../talk/chairWake.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

const CALL = "c0ffee00-1111-4222-8333-444455556666";
const TURN = "a0000017-0000-4000-8000-000000000019";
const SESSION = "a0000013-0000-4000-8000-000000000014";

/** One stretch of a call. */
function segment(over: Partial<CallSegment>): CallSegment {
  return {
    atIso: "2026-10-04T12:31:43.000Z",
    beganIso: "2026-10-04T12:31:43.000Z",
    final: true,
    id: "s1",
    open: undefined,
    text: "",
    who: "owner",
    ...over,
  };
}

/** One call holding the stretches given. */
function call({ segments, skipped = 0 }: { segments: readonly CallSegment[]; skipped?: number }): CallRecord {
  return {
    callId: CALL,
    ended: undefined,
    lastIso: "2026-10-04T12:40:00.000Z",
    notes: [],
    offers: [],
    openedIso: "2026-10-04T12:30:00.000Z",
    origin: undefined,
    reconnects: [],
    segments,
    sessionId: undefined,
    skipped,
    surface: "voice",
    usages: [],
    voice: undefined,
    written: [],
  };
}

/** One relay turn; `heardTruncated` is left off unless given, as an older record leaves it. */
function relay(over: Partial<TurnRecord>): TurnRecord {
  return {
    about: "",
    anchor: `talk:${TURN}`,
    delivery: null,
    digest: "d",
    heard: "",
    picture: { kind: "none", reason: "screen-not-shared" },
    readsAfter: [],
    registeredAtIso: null,
    slug: "talk-a00000170000",
    stagedAtIso: "2026-10-04T12:32:00.000Z",
    state: "registered",
    turnId: TURN,
    typed: false,
    words: "the voice's paraphrase",
    wordsAlone: false,
    ...over,
  };
}

/** One turn the owner typed into a chair. */
function chairTurn(over: Partial<OwnerTurn> & { turnUuid: string }): OwnerTurn {
  return {
    lineNumber: 1,
    pointer: `transcript:${SESSION}#${over.turnUuid}`,
    sessionId: SESSION,
    source: "typed",
    text: "",
    timestamp: "2026-10-04T13:00:00.000Z",
    ...over,
  };
}

/** One utterance, for the query and the lines; its length is measured off whatever text it ends up with. */
function said(over: Partial<OwnerUtterance>): OwnerUtterance {
  const one = {
    anchor: `talk:${TURN}`,
    atIso: "2026-10-04T12:00:00.000Z",
    cut: "none" as const,
    how: "written" as const,
    text: "ship it",
    where: "console-typed" as const,
    ...over,
  };
  return { ...one, chars: one.text.length };
}

const WINDOW = {
  how: undefined,
  limit: 20,
  phrase: undefined,
  sinceIso: "2026-10-04T00:00:00.000Z",
  untilIso: "2026-10-05T00:00:00.000Z",
};

describe("utterancesFromCalls", () => {
  it("keeps the owner's stretches only, anchored to the segment, and marks one the call dropped or capped", () => {
    const read = utterancesFromCalls({
      read: {
        calls: [
          call({
            segments: [
              segment({ id: "s1", text: "I'm a data source" }),
              segment({ id: "s2", text: "noted", who: "voice" }),
              segment({ final: false, id: "s3", text: "and when I" }),
              segment({ id: "s4", text: "x".repeat(CALL_TEXT_CHARS) }),
              segment({ id: "s5", text: "   " }),
            ],
            skipped: 2,
          }),
        ],
        passedOver: 0,
        unreadable: ["call-x.jsonl: EACCES"],
      },
    });

    expect(read.utterances.map((one) => [one.anchor, one.how, one.where, one.cut])).toEqual([
      [`talk-call:${CALL}#s1`, "spoken", "console-call", "none"],
      [`talk-call:${CALL}#s3`, "spoken", "console-call", "end"],
      [`talk-call:${CALL}#s4`, "spoken", "console-call", "end"],
    ]);
    expect(read.gaps).toEqual([
      { source: "console-calls", why: "call-x.jsonl: EACCES" },
      { source: "console-calls", why: `2 line(s) of call ${CALL} do not parse` },
    ]);
  });
});

describe("utterancesFromConsoleTurns", () => {
  it("reads a typed steer as written, a voiced one as spoken, and the owner's words rather than the voice's", () => {
    const read = utterancesFromConsoleTurns({
      turns: [
        relay({ heard: "hold the merge", heardTruncated: false, typed: true }),
        relay({ heard: "…the tail of what I said", heardTruncated: true }),
        relay({ heard: "an older relay" }),
      ],
      unreadable: [],
    });

    expect(read.utterances.map((one) => [one.text, one.how, one.where, one.cut])).toEqual([
      ["hold the merge", "written", "console-typed", "none"],
      ["…the tail of what I said", "spoken", "console-relay", "start"],
      ["an older relay", "spoken", "console-relay", "unknown"],
    ]);
    expect(read.gaps).toEqual([]);
  });

  // A relay made mid-stretch was listed as whole.
  it("marks a voice relay made mid-sentence as cut at the end, and one that never said as unknown", () => {
    const read = utterancesFromConsoleTurns({
      turns: [
        relay({ heard: "yes send it but", heardTailCut: true, heardTruncated: false }),
        relay({ heard: "yes send it", heardTailCut: false, heardTruncated: false }),
        relay({ heard: "before the flag", heardTruncated: false }),
      ],
      unreadable: [],
    });

    expect(read.utterances.map((one) => [one.text, one.cut])).toEqual([
      ["yes send it but", "end"],
      ["yes send it", "none"],
      ["before the flag", "unknown"],
    ]);
  });

  it("counts a relay carrying none of the owner's words as a gap, never quoting the voice's paraphrase", () => {
    const read = utterancesFromConsoleTurns({ turns: [relay({ heard: "" })], unreadable: ["x.json: torn"] });

    expect(read.utterances).toEqual([]);
    expect(read.gaps).toEqual([
      { source: "console-relays", why: "x.json: torn" },
      {
        source: "console-relays",
        why: `1 relay(s) recorded the voice's words but none of the owner's (first: talk:${TURN})`,
      },
    ]);
  });
});

describe("utterancesFromSupervisorTurns", () => {
  it("leaves out the console's relay and wake lines and an accepted suggestion, and marks a turn whose tail was cut", () => {
    const read = utterancesFromSupervisorTurns({
      problems: [],
      turns: [
        chairTurn({ text: "why is staging red", turnUuid: "a0000006-0000-4000-8000-000000000007" }),
        chairTurn({ text: "[voice relay talk-3f2a] hold it", turnUuid: "a0000008-0000-4000-8000-000000000009" }),
        chairTurn({ source: "suggestion-accepted", text: "run it", turnUuid: "a0000011-0000-4000-8000-000000000012" }),
        chairTurn({ tailCut: true, text: "and then", turnUuid: "44444444-4444-4444-8444-444444444444" }),
        chairTurn({ text: chairWakeLine({ callId: CALL }), turnUuid: "66666666-6666-4666-8666-666666666666" }),
      ],
    });

    expect(read.utterances.map((one) => [one.text, one.how, one.where, one.cut])).toEqual([
      ["why is staging red", "written", "supervisor", "none"],
      ["and then", "written", "supervisor", "end"],
    ]);
    expect(read.gaps).toEqual([]);
  });

  it("turns a spliced turn and every chain problem into gaps", () => {
    const spliced = chairTurn({ spliced: true, text: "a b", turnUuid: "55555555-5555-4555-8555-555555555555" });
    const read = utterancesFromSupervisorTurns({ problems: ["chair X would not read: gone"], turns: [spliced] });

    expect(read.utterances).toEqual([]);
    expect(read.gaps).toEqual([
      { source: "supervisor", why: "chair X would not read: gone" },
      {
        source: "supervisor",
        why: `1 turn(s) had a wrapper cut from between the owner's words, so none quotes verbatim (first: ${spliced.pointer})`,
      },
    ]);
  });
});

describe("utteranceFromRaw", () => {
  const raw = {
    atIso: "2026-10-04T12:31:43.000Z",
    context: { kind: "transcript" } as const,
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost: false,
    text: "whole",
  };

  it("places each record an anchor names, and says which end it lost or that it does not say", () => {
    const placed = [
      utteranceFromRaw({ anchor: "talk:a", raw: { ...raw, headKnown: false, where: "console-voice" } }),
      utteranceFromRaw({ anchor: "talk:b", raw: { ...raw, headLost: true, where: "console-typed" } }),
      utteranceFromRaw({ anchor: "talk-call:c#s1", raw: { ...raw, tailLost: true, where: "call" } }),
      utteranceFromRaw({ anchor: "call:c#s1", raw: { ...raw, where: "call-landing" } }),
      utteranceFromRaw({ anchor: `transcript:${SESSION}#t`, raw: { ...raw, where: "session" } }),
    ];

    expect(placed.map((one) => [one.how, one.where, one.cut, one.chars])).toEqual([
      ["spoken", "console-relay", "unknown", 5],
      ["written", "console-typed", "start", 5],
      ["spoken", "console-call", "end", 5],
      ["spoken", "call-landing", "none", 5],
      ["written", "claude-session", "none", 5],
    ]);
  });

  it("knows the console's relay line in a chair for what it is", () => {
    expect([
      isVoiceRelayLine({ text: "  [voice relay talk-3f2a] hold it" }),
      isVoiceRelayLine({ text: '<pasted_content id="0b8f"> [voice relay talk-1f49] the owner said: "hold it"' }),
      isVoiceRelayLine({ text: "hold [voice relay" }),
      isVoiceRelayLine({ text: '[Image #58] <pasted_content id="3236"> [voice relay talk-1f49] the owner said' }),
      isVoiceRelayLine({ text: '<pasted_content data-note="x>y">[voice relay talk-1] the relay</pasted_content>' }),
      isVoiceRelayLine({ text: "<pasted_content data-note='x>y'>[voice relay talk-1] the relay" }),
      isVoiceRelayLine({ text: '<pasted_content data-note="x>y">hold it, [voice relay talk-1]' }),
    ]).toEqual([true, true, false, false, true, true, false]);
  });

  it("knows a chair wake and a quiet batch as console-typed lines too, and not a turn that only opens like one", () => {
    const batch = chairBatchLine({ anchors: [{ kind: "stretch", pointer: `talk-call:${CALL}#s1` }] });
    expect([
      isConsoleTypedLine({ text: chairWakeLine({ callId: CALL }) }),
      isConsoleTypedLine({ text: batch }),
      isConsoleTypedLine({ text: "[voice relay talk-3f2a] hold it" }),
      isConsoleTypedLine({ text: `[voice call ${CALL}] hold it` }),
      isConsoleTypedLine({ text: `${batch} hold it` }),
      isConsoleTypedLine({ text: "hold it" }),
    ]).toEqual([true, true, true, false, false, false]);
  });
});

describe("queryOwnerWords", () => {
  const utterances = [
    said({ anchor: "talk:a", atIso: "2026-10-03T23:59:59.000Z", text: "before the floor" }),
    said({ anchor: "talk:b", atIso: "2026-10-04T00:00:00.000Z", text: "the JumpCloud atlas, at the floor" }),
    said({ anchor: "talk-call:c#s1", atIso: "2026-10-04T12:00:00.000Z", how: "spoken", text: "jumpcloud atlases" }),
    said({ anchor: "talk:d", atIso: "2026-10-05T00:00:00.000Z", text: "at the ceiling" }),
    said({ anchor: "talk:e", atIso: "", text: "no instant" }),
  ];

  it("keeps the floor and not the ceiling, newest first, and says an undated record is a gap", () => {
    const report = queryOwnerWords({ gaps: [], query: WINDOW, utterances });

    expect(report.shown.map((one) => one.anchor)).toEqual(["talk-call:c#s1", "talk:b"]);
    expect([report.matched, report.spoken, report.written, report.omitted]).toEqual([2, 1, 1, 0]);
    expect(report.gaps).toEqual([
      { source: "console-relays", why: "1 record(s) carry no instant, so no window can hold them (first: talk:e)" },
    ]);
  });

  it("matches every word of the phrase in any case, a plural included", () => {
    const report = queryOwnerWords({ gaps: [], query: { ...WINDOW, phrase: "the jumpcloud atlas" }, utterances });

    expect(report.phraseWords).toEqual(["jumpcloud", "atlas"]);
    expect(report.shown.map((one) => one.anchor)).toEqual(["talk-call:c#s1", "talk:b"]);
  });

  it("filters by how, and counts every match before the limit cuts the list", () => {
    const spoken = queryOwnerWords({ gaps: [], query: { ...WINDOW, how: "spoken" }, utterances });
    const limited = queryOwnerWords({ gaps: [], query: { ...WINDOW, limit: 1 }, utterances });

    expect(spoken.shown.map((one) => one.anchor)).toEqual(["talk-call:c#s1"]);
    expect([limited.matched, limited.shown.length, limited.omitted]).toEqual([2, 1, 1]);
  });

  it("orders two utterances at one instant by anchor", () => {
    const same = [said({ anchor: "talk:z" }), said({ anchor: "talk:m" })];

    expect(queryOwnerWords({ gaps: [], query: WINDOW, utterances: same }).shown.map((one) => one.anchor)).toEqual([
      "talk:m",
      "talk:z",
    ]);
  });
});

describe("the lines", () => {
  it("prints an instant to the minute in UTC, and text that is not one as stored", () => {
    expect(minuteOf({ iso: "2026-10-04T12:31:43.000Z" })).toBe("2026-10-04 12:31Z");
    expect(minuteOf({ iso: "" })).toBe("");
  });

  it("names when, how, where, length, cut and anchor on one head line", () => {
    const one = said({ atIso: "2026-10-04T12:31:43.000Z", cut: "unknown", how: "spoken", where: "console-relay" });

    expect(utteranceHead({ one })).toBe(
      `2026-10-04 12:31Z · spoken · relayed from the console voice · 7 chars · the record does not say whether it kept all of it · talk:${TURN}`,
    );
  });

  it("previews each turn on one line, then says how to read one whole and what was not read", () => {
    const long = `${"word ".repeat(40)}\nsecond line`;
    const report = queryOwnerWords({
      gaps: [{ source: "supervisor", why: "chair X would not read: gone" }],
      query: { ...WINDOW, limit: 1 },
      utterances: [
        said({ anchor: "talk:a", text: long }),
        said({ anchor: "talk:b", atIso: "2026-10-04T11:00:00.000Z" }),
      ],
    });

    expect(ownerWordsLines({ full: false, report })).toEqual([
      "profile words: 2 turn(s) of the owner's from 2026-10-04 00:00Z to 2026-10-05 00:00Z — 0 spoken, 2 written",
      `  2026-10-04 12:00Z · written · typed on the console · ${String(long.length)} chars · talk:a`,
      `      ${"word ".repeat(28)}…`,
      "  1 older — raise --limit, or narrow with --phrase, --since or --how",
      "  one whole: slopweaver profile words <anchor>",
      "  not read — supervisor: chair X would not read: gone",
    ]);
  });

  it("prints each turn whole under --full, line by line", () => {
    const report = queryOwnerWords({ gaps: [], query: WINDOW, utterances: [said({ text: "one\ntwo" })] });

    expect(ownerWordsLines({ full: true, report }).slice(1)).toEqual([
      `  2026-10-04 12:00Z · written · typed on the console · 7 chars · talk:${TURN}`,
      "      one",
      "      two",
    ]);
  });
});
