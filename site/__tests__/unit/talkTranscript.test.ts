/*
 * The call transcript on its way to disk: how the page cuts its queue into batches, and what the route refuses
 * before it spends a spawn. A batch is ONE call's lines, bounded by count and by bytes, because the last one rides
 * a `keepalive` request the browser caps at 64 KiB.
 */

import { describe, expect, it } from "vitest";

import { callFileToolAnswerOf, functionCallOutputOf, TOOL_OUTPUT_MAX } from "../../components/live/talkSession";
import {
  type CallLine,
  nextTranscriptBatch,
  parseTalkTranscriptRequest,
  type QueuedLine,
  segmentLine,
  TRANSCRIPT_BATCH_BYTES,
  TRANSCRIPT_BATCH_MAX,
  TRANSCRIPT_BODY_MAX_BYTES,
  TRANSCRIPT_TEXT_MAX,
} from "../../lib/talkTranscript";

const CALL_A = "a0000041-0000-4000-8000-000000000044";
const CALL_B = "a0000076-0000-4000-8000-000000000083";
const AT = "2026-09-25T02:30:00.000Z";

const WRITE_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";

/** A queued final segment carrying `text`. */
const queued = ({ callId, text }: { callId: string; text: string }): QueuedLine => ({
  callId,
  line: {
    ...segmentLine({ atIso: AT, final: true, id: text, open: undefined, openBy: undefined, text, who: "owner" }),
    writeId: WRITE_ID,
  },
});

describe("nextTranscriptBatch", () => {
  it("answers nothing for an empty queue", () => {
    expect(nextTranscriptBatch({ maxBytes: 1024, queued: [] })).toBe(undefined);
  });

  it("takes only the oldest call's lines, stopping at the next call", () => {
    const batch = nextTranscriptBatch({
      maxBytes: 60 * 1024,
      queued: [
        queued({ callId: CALL_A, text: "one" }),
        queued({ callId: CALL_A, text: "two" }),
        queued({ callId: CALL_B, text: "three" }),
      ],
    })!;
    expect(batch.taken).toBe(2);
    expect(batch.wire.callId).toBe(CALL_A);
    expect(batch.wire.lines.map((line) => (line.kind === "segment" ? line.text : line.kind))).toEqual(["one", "two"]);
  });

  it("stops at the byte budget, and still sends one line over it alone", () => {
    const line = queued({ callId: CALL_A, text: "x".repeat(100) });
    const size = new TextEncoder().encode(JSON.stringify(line.line)).length + 1;
    expect(nextTranscriptBatch({ maxBytes: size * 2, queued: [line, line, line] })!.taken).toBe(2);
    expect(nextTranscriptBatch({ maxBytes: 10, queued: [line, line] })!.taken).toBe(1);
  });

  it("stops at the count bound", () => {
    const many = Array.from({ length: TRANSCRIPT_BATCH_MAX + 5 }, (_, index) =>
      queued({ callId: CALL_A, text: String(index) }),
    );
    expect(nextTranscriptBatch({ maxBytes: 10 * 1024 * 1024, queued: many })!.taken).toBe(TRANSCRIPT_BATCH_MAX);
  });
});

describe("segmentLine", () => {
  it("cuts the text at the verb's bound", () => {
    const line = segmentLine({
      atIso: AT,
      final: false,
      id: "s",
      open: undefined,
      openBy: undefined,
      text: "y".repeat(TRANSCRIPT_TEXT_MAX + 10),
      who: "owner",
    });
    expect(line).toEqual({
      atIso: AT,
      final: false,
      id: "s",
      kind: "segment",
      text: "y".repeat(TRANSCRIPT_TEXT_MAX),
      who: "owner",
    });
  });

  it("keeps one whole segment of three-byte characters under the body the route reads", () => {
    const line = segmentLine({
      atIso: AT,
      final: true,
      id: "s",
      open: undefined,
      openBy: undefined,
      text: "€".repeat(TRANSCRIPT_TEXT_MAX + 1),
      who: "owner",
    });
    const raw = JSON.stringify({ callId: CALL_A, lines: [line] });
    expect(new TextEncoder().encode(raw).length).toBeLessThan(TRANSCRIPT_BODY_MAX_BYTES);
    expect(parseTalkTranscriptRequest({ raw }).kind).toBe("ok");
  });

  it.each([
    ["a control character JSON escapes in six bytes", "\u0001"],
    ["a lone surrogate", "\uD801"],
  ])("stores %s as U+FFFD, so a whole segment of them still fits the batch the page sends", (_label, char) => {
    const line = segmentLine({
      atIso: AT,
      final: true,
      id: "s",
      open: undefined,
      openBy: undefined,
      text: char.repeat(TRANSCRIPT_TEXT_MAX),
      who: "owner",
    });
    const raw = JSON.stringify({ callId: CALL_A, lines: [line] });

    expect(line).toEqual({
      atIso: AT,
      final: true,
      id: "s",
      kind: "segment",
      text: "\uFFFD".repeat(TRANSCRIPT_TEXT_MAX),
      who: "owner",
    });
    expect(new TextEncoder().encode(raw).length).toBeLessThan(TRANSCRIPT_BATCH_BYTES);
    expect(parseTalkTranscriptRequest({ raw }).kind).toBe("ok");
  });

  it("keeps the characters JSON escapes in two bytes, and a pair the cut splits becomes U+FFFD", () => {
    const body = "a".repeat(TRANSCRIPT_TEXT_MAX - 8);
    const line = segmentLine({
      atIso: AT,
      final: true,
      id: "s",
      open: undefined,
      openBy: undefined,
      text: `\t\n\r\b\f"\\${body}\u{1F600}`,
      who: "owner",
    });

    expect(line).toEqual({
      atIso: AT,
      final: true,
      id: "s",
      kind: "segment",
      text: `\t\n\r\b\f"\\${body}\uFFFD`,
      who: "owner",
    });
  });

  it("names the card open when the stretch began", () => {
    expect(
      segmentLine({
        atIso: AT,
        final: true,
        id: "s",
        open: "hand:voice-mark-step",
        openBy: undefined,
        text: "what is a voice mark",
        who: "owner",
      }),
    ).toStrictEqual({
      atIso: AT,
      final: true,
      id: "s",
      kind: "segment",
      open: "hand:voice-mark-step",
      text: "what is a voice mark",
      who: "owner",
    });
  });

  it("says the voice opened that card beside it, and never without a card", () => {
    const said = {
      atIso: AT,
      final: true,
      id: "s",
      openBy: "voice",
      text: "coming back in a minute",
      who: "owner",
    } as const;
    expect([segmentLine({ ...said, open: "ask:a" }), segmentLine({ ...said, open: undefined })]).toStrictEqual([
      {
        atIso: AT,
        final: true,
        id: "s",
        kind: "segment",
        open: "ask:a",
        openBy: "voice",
        text: said.text,
        who: "owner",
      },
      { atIso: AT, final: true, id: "s", kind: "segment", text: said.text, who: "owner" },
    ]);
  });
});

describe("parseTalkTranscriptRequest", () => {
  const open: CallLine = { atIso: AT, kind: "open", model: "m", sessionId: "sess", voice: "marin" };

  it("turns a batch into the JSONL the verb appends", () => {
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [open, open] }) });
    expect(parsed).toEqual({
      callId: CALL_A,
      count: 2,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(open)}\n${JSON.stringify(open)}\n`,
      kind: "ok",
    });
  });

  // `slopweaver desktop e2e --call`: the test instance's batch says so, and the verb is told, so it never reads as the owner's.
  it("carries the desktop test instance's marker, reads its absence as none, and refuses any other value", () => {
    const body = { callId: CALL_A, lines: [open] };
    const marked = parseTalkTranscriptRequest({ raw: JSON.stringify({ ...body, instance: "e2e" }) });
    const bare = parseTalkTranscriptRequest({ raw: JSON.stringify(body) });
    expect(marked).toStrictEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      instance: "e2e",
      jsonl: `${JSON.stringify(open)}\n`,
      kind: "ok",
    });
    expect((bare as Extract<typeof bare, { kind: "ok" }>).instance).toBe(undefined);
    expect([
      parseTalkTranscriptRequest({ raw: JSON.stringify({ ...body, instance: "E2E" }) }),
      parseTalkTranscriptRequest({ raw: JSON.stringify({ ...body, instance: true }) }),
    ]).toEqual([
      { kind: "refused", status: 400, why: "instance is not e2e" },
      { kind: "refused", status: 400, why: "instance is not e2e" },
    ]);
  });

  // A finished stretch of the owner's wakes the chair — the owner's only, and only finished.
  it("says a batch finishes a stretch of the owner's only when one of its lines is the owner's, finished", () => {
    const owners = { atIso: AT, final: true, id: "s", kind: "segment", text: "merge it", who: "owner" } as const;
    const batches = [[open, owners], [{ ...owners, final: false }], [{ ...owners, who: "voice" }], [open]];
    expect(
      batches.map((lines) => parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines }) })),
    ).toMatchObject([
      { finishesOwnerStretch: true, kind: "ok" },
      { finishesOwnerStretch: false, kind: "ok" },
      { finishesOwnerStretch: false, kind: "ok" },
      { finishesOwnerStretch: false, kind: "ok" },
    ]);
  });

  it("takes a reconnect step written onto the dropped call", () => {
    const step: CallLine = {
      atIso: AT,
      event: { attempt: 1, kind: "failed", why: "the console server did not answer the mint" },
      kind: "reconnect",
    };
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [step] }) })).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(step)}\n`,
      kind: "ok",
    });
  });

  // The link a read tool opened rides its line to the file, so the next call can open it again.
  it("carries the link a read tool opened through to the JSONL", () => {
    const read: CallLine = {
      atIso: AT,
      detail: "read",
      kind: "tool",
      name: "slack_thread_after",
      opened: "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100",
      refused: false,
    };
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [read] }) })).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(read)}\n`,
      kind: "ok",
    });
  });

  // The next call opens whatever link the file names, so only a url-taking read may name one.
  it("drops a link from a tool line whose tool takes none, and keeps the line", () => {
    const kept = { atIso: AT, detail: "read", kind: "tool", name: "code_read", refused: false };
    const stray = { ...kept, opened: "https://x" };
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [stray] }) })).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(kept)}\n`,
      kind: "ok",
    });
  });

  // A url-taking read with the field left off must still stop an older link passing for it.
  it("writes null on a url-taking read line that names no link, and leaves other tools' lines alone", () => {
    const bare = { atIso: AT, detail: "read", kind: "tool", name: "slack_thread_after", refused: false };
    const other = { atIso: AT, detail: "read", kind: "tool", name: "code_read", refused: false };
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [bare, other] }) })).toEqual({
      callId: CALL_A,
      count: 2,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify({ ...bare, opened: null })}\n${JSON.stringify(other)}\n`,
      kind: "ok",
    });
  });

  it("refuses a call id that is not a v4 UUID — it names a file", () => {
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: "../../etc/passwd", lines: [open] }) });
    expect(parsed).toEqual({ kind: "refused", status: 400, why: "callId is not a v4 UUID" });
  });

  it("refuses an empty batch and a line of an unknown kind", () => {
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [] }) })).toEqual({
      kind: "refused",
      status: 400,
      why: `lines is not a list of 1 to ${String(TRANSCRIPT_BATCH_MAX)}`,
    });
    expect(parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [{ kind: "shell" }] }) })).toEqual(
      {
        kind: "refused",
        status: 400,
        why: "a line is not an object of a known kind, or its writeId is not a v4 UUID",
      },
    );
  });

  it("takes a plan turn's token usage as a line of its own — the verb, not the route, checks its counts", () => {
    const counts = {
      cachedInputTokens: 30,
      inputTokens: 41,
      outputTokens: 3,
      reasoningOutputTokens: 1,
      totalTokens: 44,
    };
    const usage: CallLine = {
      atIso: AT,
      contextWindow: null,
      kind: "usage",
      last: counts,
      total: counts,
      turnId: "u1",
    };
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [usage] }) });
    expect(parsed).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(usage)}\n`,
      kind: "ok",
    });
  });

  it("takes what the plan thread wrote, so the call file holds the thread's words beside the voice's", () => {
    const wrote: CallLine = {
      atIso: AT,
      itemId: "m-1",
      kind: "wrote",
      text: "That covers fourteen cards.",
      turnId: "t-1",
    };
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [wrote] }) });
    expect(parsed).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(wrote)}\n`,
      kind: "ok",
    });
  });

  // A tray offer was not recoverable from disk, the log said "copy offered".
  it("takes a copy-tray offer whole, byte for byte, and never as a finished stretch of the owner's", () => {
    const offered: CallLine = {
      atIso: AT,
      kind: "offered",
      offer: {
        belowFold: "  • <@U01ARI> owns the rollback\n",
        id: "offer-7",
        label: "reply to Ari",
        made: "7",
        text: "*Staging* is back ",
      },
    };
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [offered] }) });
    expect(parsed).toEqual({
      callId: CALL_A,
      count: 1,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(offered)}\n`,
      kind: "ok",
    });
  });

  it("fits the costliest offer the tray allows into one keepalive body alone, every character kept", () => {
    // U+0001 is the costliest code point on the wire: JSON writes it as a six-byte `\u0001`. 8192 of them, the
    // joining newline among them, and a full label of them, as the tray's own bounds allow.
    const text = "\u0001".repeat(4096);
    const belowFold = "\u0001".repeat(8192 - 4096 - 1);
    const offered: CallLine = {
      atIso: AT,
      kind: "offered",
      offer: {
        belowFold,
        id: "offer-18446744073709551617",
        label: "\u0001".repeat(80),
        made: "18446744073709551617",
        text,
      },
    };
    const line: QueuedLine = { callId: CALL_A, line: { ...offered, writeId: WRITE_ID } };
    const batch = nextTranscriptBatch({ maxBytes: TRANSCRIPT_BATCH_BYTES, queued: [line, line] })!;
    expect(batch.taken).toBe(1);
    const raw = JSON.stringify(batch.wire);
    expect(new TextEncoder().encode(raw).length).toBeLessThan(TRANSCRIPT_BODY_MAX_BYTES);
    const parsed = parseTalkTranscriptRequest({ raw });
    expect(parsed.kind).toBe("ok");
    const appended: unknown = JSON.parse((parsed as Extract<typeof parsed, { kind: "ok" }>).jsonl);
    expect(appended).toEqual({ ...offered, writeId: WRITE_ID });
  });

  describe("a tool line carrying its answer", () => {
    /** The costliest answer the page can hand the model: JSON of nothing but backslashes, at the byte cap. */
    const costliest = (): string => {
      const { output } = functionCallOutputOf({
        answer: "\\".repeat((TOOL_OUTPUT_MAX - 2) / 2),
        image: undefined,
        tool: "file_read",
      });
      return callFileToolAnswerOf({ output });
    };
    const tool = (answer: string): CallLine => ({
      answer,
      atIso: AT,
      detail: "read a file",
      kind: "tool",
      name: "file_read",
      refused: false,
    });

    it("carries the answer through the route byte for byte", () => {
      const answer = '{"text":"a \\"quoted\\" line\\nand é 語 🙂"}';
      const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [tool(answer)] }) });
      expect(parsed).toEqual({
        callId: CALL_A,
        count: 1,
        finishesOwnerStretch: false,
        jsonl: `${JSON.stringify(tool(answer))}\n`,
        kind: "ok",
      });
      const appended = JSON.parse((parsed as Extract<typeof parsed, { kind: "ok" }>).jsonl) as { answer: string };
      expect(appended.answer).toBe(answer);
    });

    it("fits the costliest answer at the cap into one batch, under the keepalive body, whole", () => {
      const answer = costliest();
      expect(new TextEncoder().encode(answer).length).toBe(TOOL_OUTPUT_MAX);
      const line: QueuedLine = { callId: CALL_A, line: { ...tool(answer), writeId: WRITE_ID } };
      const lineBytes = new TextEncoder().encode(JSON.stringify(line.line)).length;
      expect(lineBytes).toBeLessThan(TRANSCRIPT_BATCH_BYTES);
      const batch = nextTranscriptBatch({ maxBytes: TRANSCRIPT_BATCH_BYTES, queued: [line] })!;
      expect(batch.taken).toBe(1);
      const raw = JSON.stringify(batch.wire);
      expect(new TextEncoder().encode(raw).length).toBeLessThan(TRANSCRIPT_BODY_MAX_BYTES);
      const parsed = parseTalkTranscriptRequest({ raw });
      expect(parsed.kind).toBe("ok");
      const appended = JSON.parse((parsed as Extract<typeof parsed, { kind: "ok" }>).jsonl) as { answer: string };
      expect(appended.answer).toBe(answer);
    });

    it("batches a long line before it apart, never cutting the answer", () => {
      const before = queued({ callId: CALL_A, text: "x".repeat(TRANSCRIPT_TEXT_MAX) });
      const answer = costliest();
      const line: QueuedLine = { callId: CALL_A, line: { ...tool(answer), writeId: WRITE_ID } };
      const first = nextTranscriptBatch({ maxBytes: TRANSCRIPT_BATCH_BYTES, queued: [before, line] })!;
      expect(first.taken).toBe(1);
      expect(first.wire.lines).toEqual([before.line]);
      const second = nextTranscriptBatch({ maxBytes: TRANSCRIPT_BATCH_BYTES, queued: [line] })!;
      expect(second.taken).toBe(1);
      expect(second.wire.lines).toEqual([line.line]);
      expect((second.wire.lines[0] as { answer: string }).answer).toBe(answer);
    });
  });

  it("carries a line's writeId through to the verb, and still takes a line from a page that mints none", () => {
    const withId = { ...open, writeId: WRITE_ID };
    const parsed = parseTalkTranscriptRequest({ raw: JSON.stringify({ callId: CALL_A, lines: [withId, open] }) });
    expect(parsed).toEqual({
      callId: CALL_A,
      count: 2,
      finishesOwnerStretch: false,
      jsonl: `${JSON.stringify(withId)}\n${JSON.stringify(open)}\n`,
      kind: "ok",
    });
  });

  it("refuses a writeId that is not a v4 UUID", () => {
    const raw = JSON.stringify({ callId: CALL_A, lines: [{ ...open, writeId: "not-an-id" }] });
    expect(parseTalkTranscriptRequest({ raw })).toEqual({
      kind: "refused",
      status: 400,
      why: "a line is not an object of a known kind, or its writeId is not a v4 UUID",
    });
  });

  it("refuses a batch in which two lines carry the same writeId, rather than let the verb drop one", () => {
    const raw = JSON.stringify({
      callId: CALL_A,
      lines: [
        { ...open, writeId: WRITE_ID },
        { ...open, writeId: WRITE_ID },
      ],
    });
    expect(parseTalkTranscriptRequest({ raw })).toEqual({
      kind: "refused",
      status: 400,
      why: "two lines carry the same writeId",
    });
  });

  it("refuses a body that is not JSON, and one over the size bound", () => {
    expect(parseTalkTranscriptRequest({ raw: "{" })).toEqual({
      kind: "refused",
      status: 400,
      why: "the body is not JSON",
    });
    expect(parseTalkTranscriptRequest({ raw: "x".repeat(64 * 1024 + 1) })).toEqual({
      kind: "refused",
      status: 413,
      why: "the body is over 65536 bytes",
    });
  });
});
