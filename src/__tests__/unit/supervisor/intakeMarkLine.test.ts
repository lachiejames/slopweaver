import { describe, expect, it } from "vitest";

import type { IntakeMark } from "../../../supervisor/intake.js";
import { buildIntakeMark, parseIntakeMarkJournal, parseIntakeMarkLine } from "../../../supervisor/intakeMarkLine.js";

const SESSION = "a0000013-0000-4000-8000-000000000014";
const NOW = "2026-09-02T17:00:00.000Z";
/** The Claude Code session writing a mark. */
const CLAUDE_WRITER = { host: "claude-code", id: SESSION } as const;
/** A Codex thread, and a rollout pointer at one of its owner turns. */
const THREAD = "a0000013-0000-4000-8000-0000000000c1";
const ROLLOUT_POINTER = `codex-rollout:${THREAD}#rollout-2026-09-02T09-00-00-${THREAD}.jsonl@120`;
const U1 = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";

const mark = (over: Partial<IntakeMark> & { pointer: string }): IntakeMark => ({
  byClaudeSessionId: SESSION,
  kind: "card",
  markedAtIso: NOW,
  witness: "Merge #403 tonight?",
  ...over,
});

describe("intake marks", () => {
  it("round-trips a mark through the journal", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "  they said brief me  ",
    });

    expect("mark" in built).toBe(true);
    const written = (built as { readonly mark: IntakeMark }).mark;
    expect(written.witness).toBe("they said brief me");
    expect(parseIntakeMarkJournal({ text: `${JSON.stringify(written)}\n\nnot json\n` })).toEqual([written]);
  });

  it("reads a hand-written spelling of a turn back in the form the writer stores, and leaves a non-pointer as written", () => {
    const relay = "talk:a0000046-0000-4000-8000-000000000049";
    const lines = [
      { byClaudeSessionId: SESSION, kind: "answered", markedAtIso: NOW, pointer: relay.toUpperCase(), witness: " w " },
      { byClaudeSessionId: SESSION, kind: "answered", markedAtIso: NOW, pointer: "not-a-pointer", witness: "w" },
    ];

    expect(
      parseIntakeMarkJournal({ text: lines.map((line) => JSON.stringify(line)).join("\n") }).map((m) => [
        m.pointer,
        m.witness,
      ]),
    ).toEqual([
      [relay, "w"],
      ["not-a-pointer", "w"],
    ]);
  });

  it("refuses a pointer that is not a turn pointer, and a witness that says nothing", () => {
    const badPointer = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "card",
      markedAtIso: NOW,
      pointer: "https://github.com/o/r/pull/1",
      witness: "x",
    });
    const blank = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "card",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "   ",
    });

    expect("refusal" in badPointer).toBe(true);
    expect((badPointer as { readonly refusal: string }).refusal).toContain("not a turn pointer");
    expect("refusal" in blank).toBe(true);
    expect((blank as { readonly refusal: string }).refusal).toContain("--witness is required");
  });

  it("marks a voice relay by its talk: anchor, lower-cased — the pointer the sweep names an undelivered one by", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "answered",
      markedAtIso: NOW,
      pointer: " TALK:A0000017-0000-4000-8000-000000000020 ",
      witness: "talk-a00000170000",
    });

    expect((built as { readonly mark: IntakeMark }).mark.pointer).toBe("talk:a0000017-0000-4000-8000-000000000020");
  });

  it("refuses a talk: pointer whose turn id is not a v4 uuid", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "answered",
      markedAtIso: NOW,
      pointer: "talk:not-a-turn",
      witness: "x",
    });

    expect((built as { readonly refusal: string }).refusal).toBe(
      "talk:not-a-turn is not a turn pointer — the form is transcript:<sessionId>#<turnUuid>, codex-rollout:<thread>#<rollout>@<offset>, talk:<turnId> or talk-call:<callId>#<segmentId>",
    );
  });

  it("stamps a Claude writer under both fields, so a reader of either names the same session", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "w",
    });
    const written = (built as { readonly mark: IntakeMark }).mark;

    expect([written.byClaudeSessionId, written.bySession]).toEqual([SESSION, CLAUDE_WRITER]);
  });

  it("marks a Codex chair's owner turn by its rollout pointer, stamped with the thread and no Claude id", () => {
    const built = buildIntakeMark({
      bySession: { host: "codex", id: THREAD },
      kind: "answered",
      markedAtIso: NOW,
      pointer: ` ${ROLLOUT_POINTER} `,
      witness: "w",
    });
    const written = (built as { readonly mark: IntakeMark }).mark;

    expect([written.pointer, written.byClaudeSessionId, written.bySession]).toEqual([
      ROLLOUT_POINTER,
      "",
      { host: "codex", id: THREAD },
    ]);
    expect(parseIntakeMarkLine({ line: JSON.stringify(written) })).toEqual(written);
  });

  it("writes a mark from no visible session with neither writer field filled", () => {
    const built = buildIntakeMark({
      bySession: undefined,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "w",
    });
    const written = (built as { readonly mark: IntakeMark }).mark;

    expect([written.byClaudeSessionId, "bySession" in written]).toEqual(["", false]);
  });

  it("refuses a line whose two writer fields name different sessions, rather than picking one", () => {
    const base = mark({ pointer: `transcript:${SESSION}#${U1}` });
    const otherClaude = JSON.stringify({ ...base, bySession: { host: "claude-code", id: "other" } });
    const codexBesideClaude = JSON.stringify({ ...base, bySession: { host: "codex", id: THREAD } });
    const malformed = JSON.stringify({ ...base, bySession: { host: "codex", id: "../x" } });
    const codexAlone = JSON.stringify({ ...base, byClaudeSessionId: "", bySession: { host: "codex", id: THREAD } });

    expect(
      [otherClaude, codexBesideClaude, malformed, codexAlone].map((line) => parseIntakeMarkLine({ line })?.bySession),
    ).toEqual([undefined, undefined, undefined, { host: "codex", id: THREAD }]);
    expect(parseIntakeMarkLine({ line: otherClaude })).toBeUndefined();
  });

  it("marks a stretch of the owner's call speech by its talk-call: pointer — what talk unread prints, relayed or not", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: ` talk-call:${"a0000035-0000-4000-8000-000000000038".toUpperCase()}#segment_0_163 `,
      witness: "small talk, no steer",
    });

    expect((built as { readonly mark: IntakeMark }).mark.pointer).toBe(
      "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
    );
  });

  it("refuses a talk-call: pointer with no segment", () => {
    const built = buildIntakeMark({
      bySession: CLAUDE_WRITER,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: "talk-call:a0000035-0000-4000-8000-000000000038#",
      witness: "x",
    });

    expect((built as { readonly refusal: string }).refusal).toContain("is not a turn pointer");
  });

  it("drops a line whose kind is not one this ledger knows, rather than reading it as something", () => {
    const line = JSON.stringify({ ...mark({ pointer: `transcript:${SESSION}#${U1}` }), kind: "done" });

    expect(parseIntakeMarkLine({ line })).toBeUndefined();
    expect(parseIntakeMarkLine({ line: "" })).toBeUndefined();
    expect(parseIntakeMarkLine({ line: "[]" })).toBeUndefined();
  });
});
