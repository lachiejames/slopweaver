/**
 * The call-level claim reading (`src/talk/callFidelity.ts`) on the messenger: a typed reply is read against the tool
 * answers ITS OWN turn read (a tool line names its turn), once whether or not it left a `wrote` line,
 * and anchored where the owner read it. Then the text `talk fidelity` prints for it (`fidelityClaimsLines.ts`).
 */
import { describe, expect, it } from "vitest";

import { claimTextLines, shownClaimPairs } from "../../../cli/commands/talk/fidelityClaimsLines.js";
import { callFidelityReport } from "../../../talk/callFidelity.js";
import { callEntryOf, foldCall } from "../../../talk/callRecord.js";

const CALL = "33333333-2222-4333-8444-555555555555";

/** A typed call: another turn's read lands first, then this turn's, its reply, and a reply that left no `wrote` line. */
const LINES = [
  { atIso: "2026-11-01T05:00:00.000Z", kind: "open", model: "m", sessionId: "s-3", surface: "typed", voice: "v" },
  {
    atIso: "2026-11-01T05:00:10.000Z",
    beganIso: "2026-11-01T05:00:10.000Z",
    final: true,
    id: "owner-1",
    kind: "segment",
    text: "check the pool for ABC-1",
    who: "owner",
  },
  {
    answer: JSON.stringify({ text: "The ABC-1 pool holds 99 connections." }),
    atIso: "2026-11-01T05:00:20.000Z",
    detail: "read the card",
    kind: "tool",
    name: "read_card",
    refused: false,
    turnId: "turn-b",
  },
  {
    answer: JSON.stringify({ text: "The ABC-1 pool holds 14 connections." }),
    atIso: "2026-11-01T05:00:21.000Z",
    detail: "read the card",
    kind: "tool",
    name: "read_card",
    refused: false,
    turnId: "turn-a",
  },
  {
    atIso: "2026-11-01T05:00:30.000Z",
    itemId: "msg-a",
    kind: "wrote",
    text: "The ABC-1 pool holds 13 connections.",
    turnId: "turn-a",
  },
  {
    atIso: "2026-11-01T05:00:30.000Z",
    beganIso: "2026-11-01T05:00:30.000Z",
    final: true,
    id: "typed-msg-a",
    kind: "segment",
    text: "The ABC-1 pool holds 13 connections.",
    who: "voice",
  },
  {
    atIso: "2026-11-01T05:00:40.000Z",
    beganIso: "2026-11-01T05:00:40.000Z",
    final: true,
    id: "typed-msg-b",
    kind: "segment",
    text: "Done.",
    who: "voice",
  },
];

/** The typed call, folded as `talk fidelity` reads it. */
function typedCall(): ReturnType<typeof callFidelityReport> {
  const entries = LINES.map((value) => callEntryOf({ value })!);
  const call = foldCall({ callId: CALL, entries, skipped: 0 })!;
  return callFidelityReport({
    calls: [call],
    sinceIso: "2026-11-01T00:00:00.000Z",
    untilIso: "2026-11-02T00:00:00.000Z",
  });
}

describe("callFidelityReport on a typed call", () => {
  it("reads each reply once, against its own turn's answer, anchored where the owner read it", () => {
    const report = typedCall();
    expect(
      report.pairs.map((pair) => [
        pair.anchor,
        pair.hop,
        pair.surface,
        pair.toolAnswers,
        pair.findings.map((one) => [one.kind, one.detail]),
      ]),
    ).toEqual([
      [`talk-call:${CALL}#msg-a`, "source-to-answer", "typed", 1, [["swapped-detail", "14 → 13"]]],
      [`talk-call:${CALL}#typed-msg-b`, "source-to-answer", "typed", 0, []],
    ]);
    expect([report.unsourced, report.ambiguous, report.calls]).toEqual([1, 0, 1]);
  });
});

describe("callFidelityReport within one turn", () => {
  it("never reads a message against its turn's tool answer that landed after it", () => {
    const lines = [
      LINES[0]!,
      { atIso: "2026-11-01T05:00:10.000Z", itemId: "m1", kind: "wrote", text: "Reading the card now.", turnId: "t" },
      { ...LINES[3]!, atIso: "2026-11-01T05:00:20.000Z", turnId: "t" },
      {
        atIso: "2026-11-01T05:00:30.000Z",
        itemId: "m2",
        kind: "wrote",
        text: "The ABC-1 pool holds 14 connections.",
        turnId: "t",
      },
    ];
    const call = foldCall({ callId: CALL, entries: lines.map((value) => callEntryOf({ value })!), skipped: 0 })!;
    const report = callFidelityReport({
      calls: [call],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(report.pairs.map((pair) => [pair.anchor, pair.toolAnswers])).toEqual([
      [`talk-call:${CALL}#m1`, 0],
      [`talk-call:${CALL}#m2`, 1],
    ]);
  });
});

describe("callFidelityReport on a typed reply whose wrote line never landed", () => {
  it("reads its turn's named tool answer by window, since the reply carries no turn id", () => {
    const lines = [LINES[0]!, LINES[1]!, LINES[3]!, LINES[5]!];
    const call = foldCall({ callId: CALL, entries: lines.map((value) => callEntryOf({ value })!), skipped: 0 })!;
    const report = callFidelityReport({
      calls: [call],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(
      report.pairs.map((pair) => [pair.anchor, pair.toolAnswers, pair.findings.map((one) => [one.kind, one.detail])]),
    ).toEqual([[`talk-call:${CALL}#typed-msg-a`, 1, [["swapped-detail", "14 → 13"]]]]);
  });
});

/** A typed reply with no `wrote` line at 05:00:30, after `lines`; the report over the whole call. */
function untaggedReply({ lines }: { lines: readonly object[] }): ReturnType<typeof callFidelityReport> {
  const all = [LINES[0]!, ...lines, LINES[5]!];
  const call = foldCall({ callId: CALL, entries: all.map((value) => callEntryOf({ value })!), skipped: 0 })!;
  return callFidelityReport({
    calls: [call],
    sinceIso: "2026-11-01T00:00:00.000Z",
    untilIso: "2026-11-02T00:00:00.000Z",
  });
}

describe("callFidelityReport never gives an untagged reply another turn's named tool", () => {
  it("skips a named tool in its window whose turn another message claims", () => {
    const report = untaggedReply({
      lines: [
        { atIso: "2026-11-01T05:00:15.000Z", itemId: "msg-b", kind: "wrote", text: "Reading it.", turnId: "turn-b" },
        { ...LINES[2]!, atIso: "2026-11-01T05:00:20.000Z" },
      ],
    });
    expect(report.pairs.map((pair) => [pair.anchor, pair.toolAnswers])).toEqual([
      [`talk-call:${CALL}#msg-b`, 0],
      [`talk-call:${CALL}#typed-msg-a`, 0],
    ]);
  });

  it("counts no named tool, and one ambiguous message, when two unclaimed turns share its window", () => {
    const report = untaggedReply({ lines: [LINES[2]!, LINES[3]!] });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });

  it("counts none, its untagged answer included, when two unclaimed turns started in its window", () => {
    const start = ({ atIso, turn }: { atIso: string; turn: string }): object => ({
      atIso,
      detail: `turn ${turn} started`,
      kind: "tool",
      name: "codex",
      refused: false,
    });
    const report = untaggedReply({
      lines: [
        start({ atIso: "2026-11-01T05:00:10.000Z", turn: "turn-a" }),
        start({ atIso: "2026-11-01T05:00:20.000Z", turn: "turn-b" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:25.000Z", turnId: undefined },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });

  it("counts none when a second unclaimed turn only started in its window, leaving no answer", () => {
    const start = ({ atIso, turn }: { atIso: string; turn: string }): object => ({
      atIso,
      detail: `turn ${turn} started`,
      kind: "tool",
      name: "codex",
      refused: false,
    });
    const report = untaggedReply({
      lines: [
        start({ atIso: "2026-11-01T05:00:15.000Z", turn: "turn-a" }),
        LINES[3]!,
        start({ atIso: "2026-11-01T05:00:25.000Z", turn: "turn-c" }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });
});

/** A Codex turn line as the console writes it: `turn <id> started`, or `turn <id> completed`. */
function codexLine({ atIso, detail }: { atIso: string; detail: string }): object {
  return { atIso, detail, kind: "tool", name: "codex", refused: false };
}

/** A typed reply with no `wrote` line. */
function typedReply({ id, atIso, text }: { id: string; atIso: string; text: string }): object {
  return { atIso, beganIso: atIso, final: true, id, kind: "segment", text, who: "voice" };
}

/** The report over one call of these lines, after its open line. */
function reportOf({ lines }: { lines: readonly object[] }): ReturnType<typeof callFidelityReport> {
  const all = [LINES[0]!, ...lines];
  const call = foldCall({ callId: CALL, entries: all.map((value) => callEntryOf({ value })!), skipped: 0 })!;
  return callFidelityReport({
    calls: [call],
    sinceIso: "2026-11-01T00:00:00.000Z",
    untilIso: "2026-11-02T00:00:00.000Z",
  });
}

/** An answered tool line naming no turn. */
const UNTAGGED_TOOL = { ...LINES[3]!, turnId: undefined };

describe("callFidelityReport on turns still running across a window", () => {
  it("counts no tool for an untagged reply when a turn started before its window is still running", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        { atIso: "2026-11-01T05:00:10.000Z", itemId: "msg-c", kind: "wrote", text: "Noted.", turnId: "turn-c" },
        codexLine({ atIso: "2026-11-01T05:00:20.000Z", detail: "turn turn-b started" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:25.000Z" },
        typedReply({
          atIso: "2026-11-01T05:00:30.000Z",
          id: "typed-now",
          text: "The ABC-1 pool holds 13 connections.",
        }),
      ],
    });
    expect([report.pairs.map((pair) => [pair.anchor, pair.toolAnswers]), report.ambiguous]).toEqual([
      [
        [`talk-call:${CALL}#msg-c`, 0],
        [`talk-call:${CALL}#typed-now`, 0],
      ],
      1,
    ]);
  });

  it("still reads the next reply's tool when the turn before ended after its own reply", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        typedReply({ atIso: "2026-11-01T05:00:10.000Z", id: "typed-a", text: "Looking." }),
        codexLine({ atIso: "2026-11-01T05:00:11.000Z", detail: "turn turn-a completed" }),
        codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b started" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-b", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0, 1], 0]);
  });

  it("gives an untagged reply its turn's named tool when the only other turn in its window ended before it", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a completed" }),
        codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b started" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:20.000Z", turnId: "turn-b" },
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-b", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("reads a turn's failure line, as the console writes it with its reason, as that turn's end", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a failed: backend error" }),
        codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b started" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-b", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("gives an answer naming no turn to neither tagged message when both turns were running as it landed", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-b started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
        { atIso: "2026-11-01T05:00:40.000Z", itemId: "msg-b", kind: "wrote", text: "Also done.", turnId: "turn-b" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0, 0], 2]);
  });

  it("keeps an answer naming no turn for a tagged message when the other turn had ended before it landed", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-b started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b completed" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("reads lines stamped in one millisecond in the order the call file wrote them", () => {
    const linesWith = ({ endFirst }: { endFirst: boolean }): readonly object[] => {
      const end = codexLine({ atIso: "2026-11-01T05:00:20.000Z", detail: "turn turn-b completed" });
      const tool = { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" };
      return [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-b started" }),
        ...(endFirst ? [end, tool] : [tool, end]),
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
      ];
    };
    const reports = [true, false].map((endFirst) => reportOf({ lines: linesWith({ endFirst }) }));
    expect(reports.map((report) => [report.pairs.map((pair) => pair.toolAnswers), report.ambiguous])).toEqual([
      [[1], 0],
      [[0], 1],
    ]);
  });

  it("never gives an untagged reply the named answer of a turn that ended before it", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:15.000Z", turnId: "turn-a" },
        codexLine({ atIso: "2026-11-01T05:00:20.000Z", detail: "turn turn-a completed" }),
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-r1", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 0]);
  });

  it("gives an untagged reply neither a running turn nor a named turn with no lifecycle lines when both could be its", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:15.000Z", turnId: "turn-a" },
        { ...LINES[3]!, atIso: "2026-11-01T05:00:20.000Z", turnId: "turn-b" },
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-r1", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });

  it("walks lifecycle lines in file order for an untagged reply, so an end written before a start never closes it", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a completed" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:20.000Z", turnId: "turn-a" },
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-r", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("never gives an untagged reply the named answer of a turn whose end line alone landed before it", () => {
    const report = reportOf({
      lines: [
        { ...LINES[3]!, atIso: "2026-11-01T05:00:10.000Z", turnId: "turn-a" },
        codexLine({ atIso: "2026-11-01T05:00:20.000Z", detail: "turn turn-a completed" }),
        typedReply({ atIso: "2026-11-01T05:00:30.000Z", id: "typed-r", text: "The ABC-1 pool holds 13 connections." }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 0]);
  });

  it("gives an untagged reply its sole named turn's answer when that turn's only lifecycle line is its later end", () => {
    const report = reportOf({
      lines: [
        { ...LINES[3]!, atIso: "2026-11-01T05:00:10.000Z", turnId: "turn-a" },
        typedReply({ atIso: "2026-11-01T05:00:20.000Z", id: "typed-r", text: "The ABC-1 pool holds 13 connections." }),
        codexLine({ atIso: "2026-11-01T05:00:30.000Z", detail: "turn turn-a completed" }),
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("keeps what a turn with no start line read before its earlier message for its later one", () => {
    const report = reportOf({
      lines: [
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:10.000Z" },
        { atIso: "2026-11-01T05:00:20.000Z", itemId: "m1", kind: "wrote", text: "Reading it.", turnId: "t" },
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "m2", kind: "wrote", text: "Done.", turnId: "t" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1, 1], 0]);
  });

  it("places an untagged typed reply at the instant it completed, so a source landing as it was written counts", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        { ...LINES[3]!, atIso: "2026-11-01T05:00:15.000Z", turnId: "turn-a" },
        {
          ...typedReply({ atIso: "2026-11-01T05:00:20.000Z", id: "typed-r", text: "The ABC-1 pool holds 13." }),
          beganIso: "2026-11-01T05:00:10.000Z",
        },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[1], 0]);
  });

  it("never reads another tool's detail that looks like a turn's end as that turn ending", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-b started" }),
        { ...codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b completed" }), name: "read_card" },
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });

  it("leaves out an answer naming no turn written just before its turn's start line in the same millisecond", () => {
    const report = reportOf({
      lines: [
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:10.000Z" },
        codexLine({ atIso: "2026-11-01T05:00:10.000Z", detail: "turn turn-a started" }),
        { atIso: "2026-11-01T05:00:20.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 0]);
  });

  it("drops an answer naming no turn from a tagged message's window that another turn started in", () => {
    const report = reportOf({
      lines: [
        codexLine({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codexLine({ atIso: "2026-11-01T05:00:15.000Z", detail: "turn turn-b started" }),
        { ...UNTAGGED_TOOL, atIso: "2026-11-01T05:00:20.000Z" },
        { atIso: "2026-11-01T05:00:30.000Z", itemId: "msg-a", kind: "wrote", text: "Done.", turnId: "turn-a" },
      ],
    });
    expect([report.pairs.map((pair) => pair.toolAnswers), report.ambiguous]).toEqual([[0], 1]);
  });
});

describe("callFidelityReport on a line stamped at the previous reply's instant", () => {
  it("gives it to that reply only, never the next one too", () => {
    const segment = ({ id, atIso, text }: { id: string; atIso: string; text: string }): object => ({
      atIso,
      beganIso: atIso,
      final: true,
      id,
      kind: "segment",
      text,
      who: "voice",
    });
    const lines = [
      LINES[0]!,
      { ...LINES[3]!, atIso: "2026-11-01T05:00:10.000Z", turnId: undefined },
      segment({ atIso: "2026-11-01T05:00:10.000Z", id: "typed-a", text: "The ABC-1 pool holds 14 connections." }),
      segment({ atIso: "2026-11-01T05:00:20.000Z", id: "typed-b", text: "The ABC-1 pool holds 13 connections." }),
    ];
    const call = foldCall({ callId: CALL, entries: lines.map((value) => callEntryOf({ value })!), skipped: 0 })!;
    const report = callFidelityReport({
      calls: [call],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(report.pairs.map((pair) => [pair.anchor, pair.toolAnswers])).toEqual([
      [`talk-call:${CALL}#typed-a`, 1],
      [`talk-call:${CALL}#typed-b`, 0],
    ]);
  });
});

describe("claimTextLines", () => {
  it("prints a typed call's finding anchored, says what read no source, and heads on zero spoken answers", () => {
    const report = typedCall();
    const lines = claimTextLines({ report, shown: shownClaimPairs({ limit: 5, report }), unreadable: [] });
    expect(lines[1]).toBe(
      "  0 of 0 spoken answer(s) dropped a handed claim or added a question (dropped-claim, added-question: the kinds " +
        "hand-graded real at least 80% of the time)",
    );
    expect(lines.slice(-3)).toEqual([
      "  1 source → answer message(s) read no tool answer on record (an answer is kept only when a model was handed one; shell, web and " +
        "sub-agent reads leave none), so a clean read there is unproven",
      `  2026-11-01T05:00:30.000Z  talk-call:${CALL}#msg-a  source-to-answer (typed)`,
      "    swapped-detail: 14 → 13 — The ABC-1 pool holds 13 connections.",
    ]);
  });
});
