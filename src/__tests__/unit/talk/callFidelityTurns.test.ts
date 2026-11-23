/**
 * Which turn a completed message answered (`src/talk/callFidelityTurns.ts`): where its window opens, and which tool
 * answers count as its own turn's — a reply two running turns could have written is ambiguous, never guessed.
 */
import { describe, expect, it } from "vitest";

import { type Completed, turnStartMs, turnToolsOf } from "../../../talk/callFidelityTurns.js";
import { type CallRecord, callEntryOf, foldCall } from "../../../talk/callRecord.js";

const CALL = "44444444-2222-4333-8444-555555555555";

/** A codex lifecycle line, as the console writes one. */
function codex({ atIso, detail }: { atIso: string; detail: string }): Record<string, unknown> {
  return { atIso, detail, kind: "tool", name: "codex", refused: false };
}

/** A read that handed the model an answer, naming the turn that called it when `turnId` is given. */
function read({ atIso, text, turnId }: { atIso: string; text: string; turnId?: string }): Record<string, unknown> {
  const line = { answer: JSON.stringify({ text }), atIso, detail: "read the card", kind: "tool", name: "read_card" };
  if (turnId === undefined) {
    return { ...line, refused: false };
  }
  return { ...line, refused: false, turnId };
}

/** A call folded from its lines, as `talk fidelity` reads it. */
function callOf({ lines }: { lines: readonly Record<string, unknown>[] }): CallRecord {
  const open = {
    atIso: "2026-11-01T05:00:00.000Z",
    kind: "open",
    model: "m",
    sessionId: "s",
    surface: "typed",
    voice: "v",
  };
  const entries = [open, ...lines].map((value) => callEntryOf({ value })!);
  return foldCall({ callId: CALL, entries, skipped: 0 })!;
}

/** A typed message completed at `atIso`, naming `turnId` when it left a `wrote` line. */
function message({ atIso, id, turnId }: { atIso: string; id: string; turnId: string | undefined }): Completed {
  return { anchor: undefined, atIso, id, surface: "typed", text: "the pool holds 14", turnId };
}

/** Every answered tool line on a call. */
function toolsOf({ call }: { call: CallRecord }): readonly Extract<CallRecord["notes"][number], { kind: "tool" }>[] {
  return call.notes.flatMap((note) => (note.kind === "tool" && note.answer !== undefined ? [note] : []));
}

describe("turnStartMs", () => {
  it("opens a message's window at its own turn's start line", () => {
    const call = callOf({ lines: [codex({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" })] });
    const one = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-a", turnId: "turn-a" });
    expect(turnStartMs({ call, earlier: [], one })).toBe(Date.parse("2026-11-01T05:00:05.000Z"));
  });

  it("opens at the call's open when no start line and no earlier message bound it", () => {
    const call = callOf({ lines: [] });
    const one = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-a", turnId: undefined });
    expect(turnStartMs({ call, earlier: [], one })).toBe(Date.parse("2026-11-01T05:00:00.000Z"));
  });

  it("opens just after another turn's earlier message, and reaches back over its own turn's earlier one", () => {
    const call = callOf({ lines: [] });
    const other = message({ atIso: "2026-11-01T05:00:10.000Z", id: "m-x", turnId: "turn-x" });
    const first = message({ atIso: "2026-11-01T05:00:20.000Z", id: "m-a1", turnId: "turn-a" });
    const second = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-a2", turnId: "turn-a" });
    expect(turnStartMs({ call, earlier: [other, first], one: second })).toBe(
      Date.parse("2026-11-01T05:00:10.000Z") + 1,
    );
  });
});

describe("turnToolsOf", () => {
  it("counts only its own turn's reads that had landed by the message", () => {
    const call = callOf({
      lines: [
        read({ atIso: "2026-11-01T05:00:10.000Z", text: "other turn", turnId: "turn-b" }),
        read({ atIso: "2026-11-01T05:00:20.000Z", text: "own turn", turnId: "turn-a" }),
        read({ atIso: "2026-11-01T05:00:40.000Z", text: "own turn, later", turnId: "turn-a" }),
      ],
    });
    const one = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-a", turnId: "turn-a" });
    const toMs = Date.parse(one.atIso);
    const result = turnToolsOf({ call, claimed: new Set(["turn-a"]), fromMs: 0, one, toMs, tools: toolsOf({ call }) });
    expect(result.ambiguous).toBe(false);
    expect(result.turnTools.map((tool) => tool.answer)).toEqual([JSON.stringify({ text: "own turn" })]);
  });

  it("calls an untagged reply ambiguous, and counts nothing, when two turns were running as it landed", () => {
    const call = callOf({
      lines: [
        codex({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        codex({ atIso: "2026-11-01T05:00:06.000Z", detail: "turn turn-b started" }),
        read({ atIso: "2026-11-01T05:00:20.000Z", text: "unnamed read" }),
      ],
    });
    const one = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-?", turnId: undefined });
    const toMs = Date.parse(one.atIso);
    const result = turnToolsOf({ call, claimed: new Set(), fromMs: 0, one, toMs, tools: toolsOf({ call }) });
    expect(result).toEqual({ ambiguous: true, turnTools: [] });
  });

  it("gives an untagged reply the one turn still running as it landed", () => {
    const call = callOf({
      lines: [
        codex({ atIso: "2026-11-01T05:00:05.000Z", detail: "turn turn-a started" }),
        read({ atIso: "2026-11-01T05:00:20.000Z", text: "unnamed read" }),
      ],
    });
    const one = message({ atIso: "2026-11-01T05:00:30.000Z", id: "m-a", turnId: undefined });
    const toMs = Date.parse(one.atIso);
    const result = turnToolsOf({ call, claimed: new Set(), fromMs: 0, one, toMs, tools: toolsOf({ call }) });
    expect(result.ambiguous).toBe(false);
    expect(result.turnTools.map((tool) => tool.answer)).toEqual([JSON.stringify({ text: "unnamed read" })]);
  });
});
