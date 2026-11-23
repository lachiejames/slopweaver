import { describe, expect, it } from "vitest";

import type { CallRecord, CallSegment } from "../../../talk/callRecord.js";
import { cutInOf } from "../../../talk/progressLine.js";
import { scriptedCutIns } from "../../../talk/scriptedCutIns.js";

/** A segment the owner reported, verbatim from a call file. */
const REPORTED =
  " Yes, that's it — merge the fix, then send Rosa a short note on what moved and why, so she can push back. Next card is Sorry, this one's slow. I'm writing some of it up. Park this one until its full wording's available?";

const segment = (over: Partial<CallSegment>): CallSegment => ({
  atIso: "2026-10-06T11:41:44.809Z",
  beganIso: "2026-10-06T11:41:44.809Z",
  final: true,
  id: "turn_000000000000000000012",
  open: undefined,
  text: REPORTED,
  who: "voice",
  ...over,
});

/** A Codex turn's start or end line, as the call file writes it. */
const turnLine = ({
  atIso,
  detail,
  refused = false,
}: {
  atIso: string;
  detail: string;
  refused?: boolean;
}): CallRecord["notes"][number] => ({
  answer: undefined,
  atIso,
  detail,
  kind: "tool",
  name: "codex",
  opened: undefined,
  refused,
});

/** The reported call's delegated turn: started 11:41:00.019Z, completed 0.87s after its 30s line was due. */
const REPORTED_TURN = [
  turnLine({ atIso: "2026-10-06T11:41:00.019Z", detail: "turn a0000002-0000-4000-8000-000000000002 started" }),
  turnLine({ atIso: "2026-10-06T11:41:30.887Z", detail: "turn a0000002-0000-4000-8000-000000000002 completed" }),
];

const call = ({
  callId,
  segments,
  notes = REPORTED_TURN,
}: {
  callId: string;
  segments: readonly CallSegment[];
  notes?: CallRecord["notes"];
}): CallRecord => ({
  callId,
  ended: undefined,
  lastIso: "2026-10-06T12:00:00.000Z",
  notes,
  offers: [],
  openedIso: "2026-10-06T10:46:45.547Z",
  origin: undefined,
  reconnects: [],
  segments,
  sessionId: undefined,
  skipped: 0,
  surface: "voice",
  usages: [],
  voice: "spruce",
  written: [],
});

describe("cutInOf", () => {
  it("finds the progress line the owner heard cut into an answer, and the words it landed after", () => {
    expect(cutInOf({ text: REPORTED })).toEqual({
      before:
        "Yes, that's it — merge the fix, then send Rosa a short note on what moved and why, so she can push back. Next card is",
      line: "Sorry, this one's slow. I'm writing some of it up.",
    });
  });

  it("does not count a segment that opens on the line, which is the line said in a silence as designed", () => {
    expect(cutInOf({ text: " Sorry, this one's slow. I'm still looking into it." })).toBeUndefined();
    expect(
      cutInOf({ text: "This one's slow. I'm still thinking it through. The note says a PDF was uploaded." }),
    ).toBeUndefined();
    expect(
      cutInOf({ text: "This one's slow. I'm still working on it. Still with you. I'm still thinking it through." }),
    ).toBeUndefined();
  });

  // The first line opening the segment must not hide a later one after the voice's own words.
  it("finds a cut-in later in a segment that opened on the line", () => {
    expect(
      cutInOf({
        text: "This one's slow. I'm still working on it. Here is the answer. Still with you. I'm still thinking it through.",
      }),
    ).toEqual({
      before: "This one's slow. I'm still working on it. Here is the answer.",
      line: "Still with you. I'm still thinking it through.",
    });
  });

  it("reads an en or em dash between the opener and the clause, spaced or not", () => {
    expect(cutInOf({ text: "My answer. Still with you–I'm still thinking it through." })!.line).toBe(
      "Still with you–I'm still thinking it through.",
    );
    expect(cutInOf({ text: "My answer. Still with you — I'm still thinking it through." })!.line).toBe(
      "Still with you — I'm still thinking it through.",
    );
  });

  it("reads a 'Sorry' whose comma the transcript dropped as the line's own", () => {
    expect(cutInOf({ text: "Here it is. Sorry this one's slow. I'm writing some of it up." })!.line).toBe(
      "Sorry this one's slow. I'm writing some of it up.",
    );
  });

  it("reads a 'Sorry,' with no space after its comma as the line's own, so the line alone is no cut-in", () => {
    expect(cutInOf({ text: "Sorry,this one's slow. I'm writing some of it up." })).toBe(undefined);
  });

  it("reads any Unicode dash between the opener and the clause, a horizontal bar included", () => {
    expect(cutInOf({ text: "Answer. Still with you―I'm still thinking it through." })!.line).toBe(
      "Still with you―I'm still thinking it through.",
    );
  });

  it("reads a line after punctuation that is no letter or digit, an underscore included", () => {
    expect(cutInOf({ text: "Answer _Still with you. I'm still working on it." })!.line).toBe(
      "Still with you. I'm still working on it.",
    );
  });

  it("keeps words that are no line in the whole segment as the voice's own, even where a cut-off prefix ends on them", () => {
    expect(
      cutInOf({ text: "Still with you. I'm still working on it Still with you. I'm still working on it." }),
    ).toEqual({
      before: "Still with you. I'm still working on it",
      line: "Still with you. I'm still working on it.",
    });
  });

  it("reads a number the transcript renders as numerals as the voice's own words", () => {
    expect(cutInOf({ text: "42. Still with you. I'm still thinking it through." })).toEqual({
      before: "42.",
      line: "Still with you. I'm still thinking it through.",
    });
  });

  it("does not count an opener's words inside a longer word", () => {
    expect(cutInOf({ text: "OrdinaryNotStill with you. I'm still working on it." })).toBeUndefined();
    expect(cutInOf({ text: "Answer 2This one's slow. I'm still working on it." })).toBeUndefined();
    expect(cutInOf({ text: "Answer. Still with youI'm still working on it." })).toBeUndefined();
  });

  it("counts an answer once however many progress lines it holds, naming the first", () => {
    expect(
      cutInOf({
        text: "Answer one. Still with you. I'm still thinking it through. Answer two. This one's slow. I'm writing some of it up.",
      }),
    ).toEqual({ before: "Answer one.", line: "Still with you. I'm still thinking it through." });
  });

  it("reads curly apostrophes, a comma after the opener and a paraphrased clause", () => {
    expect(
      cutInOf({
        text: "I'd start with the discussion already in flight. Sorry, this one’s slow. I’m writing some of it up.",
      }),
    ).toEqual({
      before: "I'd start with the discussion already in flight.",
      line: "Sorry, this one's slow. I'm writing some of it up.",
    });
    expect(
      cutInOf({
        text: "Was moving those checks into one job something you were driving? Still with you, I'm writing some of that up , but yeah, the time a rerun takes is a useful measure.",
      }),
    ).toEqual({
      before: "Was moving those checks into one job something you were driving?",
      line: "Still with you, I'm writing some of that up",
    });
  });

  it("does not count an opener followed by an 'I'm' clause the console never says", () => {
    expect(
      cutInOf({ text: "I checked performance. This one's slow. I'm reluctant to optimise without data." }),
    ).toBeUndefined();
    expect(cutInOf({ text: "I checked it. Still with you. I'm still working on it with Kieran." })).toBeUndefined();
  });

  it("does not count an opener's words in ordinary speech with no progress clause after them", () => {
    expect(
      cutInOf({ text: "I'm still with you on the rollout, and the second card is the billing one." }),
    ).toBeUndefined();
  });

  it("does not count a hand-off line, which the voice's own tool call has the console say after its words", () => {
    expect(cutInOf({ text: "The draft tags Kieran. Okay, having a look." })).toBeUndefined();
    expect(cutInOf({ text: "Let me check. Finding it." })).toBeUndefined();
  });

  it("finds nothing in an answer with no progress line", () => {
    expect(cutInOf({ text: "Right, the transcript shows the symptom;" })).toBeUndefined();
  });
});

describe("scriptedCutIns", () => {
  it("anchors each cut-in to its call turn, oldest first, and counts only the voice's final segments", () => {
    const later = call({
      callId: "a0000050-0000-4000-8000-000000000053",
      notes: [
        turnLine({ atIso: "2026-10-07T03:10:39.694Z", detail: "turn a0000003-0000-4000-8000-000000000003 started" }),
        turnLine({ atIso: "2026-10-07T03:11:10.206Z", detail: "turn a0000003-0000-4000-8000-000000000003 completed" }),
      ],
      segments: [
        segment({
          atIso: "2026-10-07T03:11:34.056Z",
          id: "turn_later",
          text: "The draft jumps to a fix. This one's slow. I'm still looking into it.",
        }),
      ],
    });
    const reported = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      segments: [
        segment({}),
        segment({ id: "turn_snapshot", final: false }),
        segment({ id: "turn_his", who: "owner" }),
      ],
    });
    expect(
      scriptedCutIns({ calls: [later, reported], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => [
        cut.anchor,
        cut.atIso,
        cut.likelyTurnId,
      ]),
    ).toEqual([
      [
        "talk-call:a0000030-0000-4000-8000-000000000033#turn_000000000000000000012",
        "2026-10-06T11:41:44.809Z",
        "a0000002-0000-4000-8000-000000000002",
      ],
      [
        "talk-call:a0000050-0000-4000-8000-000000000053#turn_later",
        "2026-10-07T03:11:34.056Z",
        "a0000003-0000-4000-8000-000000000003",
      ],
    ]);
  });

  it("leaves out a segment before the floor", () => {
    const reported = call({ callId: "a0000030-0000-4000-8000-000000000033", segments: [segment({})] });
    expect(scriptedCutIns({ calls: [reported], sinceIso: "2026-10-07T00:00:00.000Z" })).toEqual([]);
  });

  // An offset timestamp sorts before a later UTC floor as a string while its instant is after it.
  it("compares the floor as an instant, so an offset timestamp after it still counts", () => {
    const offset = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      segments: [segment({ atIso: "2026-10-05T23:41:44.809-12:00" })],
    });
    expect(scriptedCutIns({ calls: [offset], sinceIso: "2026-10-06T11:00:00.000Z" }).map((cut) => cut.atIso)).toEqual([
      "2026-10-05T23:41:44.809-12:00",
    ]);
  });

  it("does not count the line's words in a typed conversation, which never speaks a progress line", () => {
    const typed: CallRecord = {
      ...call({ callId: "a0000030-0000-4000-8000-000000000033", segments: [segment({})] }),
      surface: "typed",
    };
    expect(scriptedCutIns({ calls: [typed], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("does not count the line's words in a call with no delegated turn to have the console say them", () => {
    const spoken = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [],
      segments: [segment({ text: "I checked the trace. This one's slow. I'm still working on it." })],
    });
    expect(scriptedCutIns({ calls: [spoken], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("does not count one during a turn that ended before its progress line was due", () => {
    const quick = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.019Z", detail: "turn quick started" }),
        turnLine({ atIso: "2026-10-06T11:41:29.000Z", detail: "turn quick completed" }),
      ],
      segments: [segment({})],
    });
    expect(scriptedCutIns({ calls: [quick], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  // The first line moved from 30s to 15s, so a stretch from then on is due 15s in.
  it("times a stretch started from the move on by the 15s first line, and one before it by 30s", () => {
    const notes = [
      turnLine({ atIso: "2026-10-10T09:00:00.000Z", detail: "turn later started" }),
      turnLine({ atIso: "2026-10-10T09:00:17.000Z", detail: "turn later completed" }),
    ];
    const later = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes,
      segments: [
        segment({ atIso: "2026-10-10T09:00:14.000Z", id: "early" }),
        segment({ atIso: "2026-10-10T09:00:16.000Z", id: "due" }),
      ],
    });
    expect(scriptedCutIns({ calls: [later], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.anchor)).toEqual([
      "talk-call:a0000030-0000-4000-8000-000000000033#due",
    ]);
  });

  // The console stopped speaking the line and plays a sound, so a stretch from the
  // retirement on had no line to cut in, and the voice saying those words itself is never the console's.
  it("counts a stretch started just before the line was retired and none started at or after it", () => {
    const notes = [
      turnLine({ atIso: "2026-10-14T23:50:00.000Z", detail: "turn last started" }),
      turnLine({ atIso: "2026-10-14T23:50:40.000Z", detail: "turn last completed" }),
      turnLine({ atIso: "2026-10-15T00:00:00.000Z", detail: "turn retired started" }),
      turnLine({ atIso: "2026-10-15T00:00:40.000Z", detail: "turn retired completed" }),
    ];
    const bounded = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes,
      segments: [
        segment({ atIso: "2026-10-14T23:50:20.000Z", id: "before" }),
        segment({ atIso: "2026-10-15T00:00:20.000Z", id: "after" }),
      ],
    });
    expect(scriptedCutIns({ calls: [bounded], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.anchor)).toEqual(
      ["talk-call:a0000030-0000-4000-8000-000000000033#before"],
    );
  });

  it("does not count one finishing more than a minute after the turn ended", () => {
    const late = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      segments: [segment({ atIso: "2026-10-06T11:42:30.888Z" })],
    });
    expect(scriptedCutIns({ calls: [late], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("counts one during a turn the call recorded no end for, once its line was due", () => {
    const dropped = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [REPORTED_TURN[0]!],
      segments: [segment({ atIso: "2026-10-06T11:41:29.000Z", id: "early" }), segment({})],
    });
    expect(scriptedCutIns({ calls: [dropped], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.anchor)).toEqual(
      ["talk-call:a0000030-0000-4000-8000-000000000033#turn_000000000000000000012"],
    );
  });

  // The console keeps one progress timer for every running turn, armed by the first.
  it("times a line from the start of overlapping turns, naming the latest started by then", () => {
    const overlapping = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn first started" }),
        turnLine({ atIso: "2026-10-06T11:41:20.000Z", detail: "turn second started" }),
        turnLine({ atIso: "2026-10-06T11:41:25.000Z", detail: "turn first completed" }),
        turnLine({ atIso: "2026-10-06T11:41:45.000Z", detail: "turn second completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:31.000Z" })],
    });
    expect(
      scriptedCutIns({ calls: [overlapping], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.likelyTurnId),
    ).toEqual(["second"]);
  });

  it("reads an end and a start in the same millisecond in the order the file appended them", () => {
    const back = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn first started" }),
        turnLine({ atIso: "2026-10-06T11:41:10.000Z", detail: "turn first completed" }),
        turnLine({ atIso: "2026-10-06T11:41:10.000Z", detail: "turn second started" }),
        turnLine({ atIso: "2026-10-06T11:41:35.000Z", detail: "turn second completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:36.000Z" })],
    });
    expect(scriptedCutIns({ calls: [back], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("does not merge a turn that starts after the last one ended", () => {
    const apart = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn first started" }),
        turnLine({ atIso: "2026-10-06T11:41:10.000Z", detail: "turn first completed" }),
        turnLine({ atIso: "2026-10-06T11:41:20.000Z", detail: "turn second started" }),
        turnLine({ atIso: "2026-10-06T11:41:45.000Z", detail: "turn second completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:31.000Z" })],
    });
    expect(scriptedCutIns({ calls: [apart], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("replays a retried turn line the call file folded later at its own instant", () => {
    const retried = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn first started" }),
        turnLine({ atIso: "2026-10-06T11:41:20.000Z", detail: "turn second started" }),
        turnLine({ atIso: "2026-10-06T11:41:10.000Z", detail: "turn first completed" }),
        turnLine({ atIso: "2026-10-06T11:41:45.000Z", detail: "turn second completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:31.000Z" })],
    });
    expect(scriptedCutIns({ calls: [retried], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("reads a turn id holding a space, and a failed turn's failure after its status", () => {
    const spaced = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn alpha beta started" }),
        turnLine({ atIso: "2026-10-06T11:41:40.000Z", detail: "turn alpha beta failed — stream closed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:31.000Z" })],
    });
    expect(
      scriptedCutIns({ calls: [spaced], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.likelyTurnId),
    ).toEqual(["alpha beta"]);
  });

  it("reads an end against the turn running, however much of the line its id takes", () => {
    const statusInId = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn x completed — y started" }),
        turnLine({ atIso: "2026-10-06T11:41:31.000Z", detail: "turn x completed — y completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:42:31.001Z" })],
    });
    expect(scriptedCutIns({ calls: [statusInId], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("reads a failure ending in 'started' as the end it is, never a start", () => {
    const failedStart = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn t started" }),
        turnLine({ atIso: "2026-10-06T11:41:31.000Z", detail: "turn t failed — never started" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:43:00.000Z" })],
    });
    expect(scriptedCutIns({ calls: [failedStart], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("never reads a failed turn's line as a start, even for a turn not running", () => {
    const ghost = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn ghost failed — never started", refused: true }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:41:31.000Z" })],
    });
    expect(scriptedCutIns({ calls: [ghost], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("reads the end of a failed turn whose failure runs over more than one line", () => {
    const multiline = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn t started" }),
        turnLine({ atIso: "2026-10-06T11:41:31.000Z", detail: "turn t failed — first line\nsecond line" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:43:00.000Z" })],
    });
    expect(scriptedCutIns({ calls: [multiline], sinceIso: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });

  it("opens a fresh stretch for a turn id started again after it completed", () => {
    const again = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [
        turnLine({ atIso: "2026-10-06T11:41:00.000Z", detail: "turn same started" }),
        turnLine({ atIso: "2026-10-06T11:41:10.000Z", detail: "turn same completed" }),
        turnLine({ atIso: "2026-10-06T11:42:00.000Z", detail: "turn same started" }),
        turnLine({ atIso: "2026-10-06T11:42:35.000Z", detail: "turn same completed" }),
      ],
      segments: [segment({ atIso: "2026-10-06T11:42:31.000Z" })],
    });
    expect(
      scriptedCutIns({ calls: [again], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.likelyTurnId),
    ).toEqual(["same"]);
  });

  // A turn with no recorded end must not stay open for a match hours later.
  it("holds a turn with no recorded end to the call's lifetime from its start", () => {
    const dropped = call({
      callId: "a0000030-0000-4000-8000-000000000033",
      notes: [REPORTED_TURN[0]!],
      segments: [
        segment({ atIso: "2026-10-06T13:11:00.019Z", id: "at-lifetime" }),
        segment({ atIso: "2026-10-06T13:11:00.020Z", id: "past-lifetime" }),
      ],
    });
    expect(scriptedCutIns({ calls: [dropped], sinceIso: "2026-10-01T00:00:00.000Z" }).map((cut) => cut.anchor)).toEqual(
      ["talk-call:a0000030-0000-4000-8000-000000000033#at-lifetime"],
    );
  });
});
