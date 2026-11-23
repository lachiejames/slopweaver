/*
 * One console-voice call folded from the lines the page appended while it ran. The case that matters is the dropped
 * one: a partial snapshot is all that survives of what the owner was saying, and no end is written.
 */
import { describe, expect, it } from "vitest";

import { reconnectPhrase } from "../../../talk/callReconnectRecord.js";
import { type CallEntry, callEndPhrase, callEntryOf, foldCall, OWNER_SPEAKER } from "../../../talk/callRecord.js";
import { CALL_TOOL_ANSWER_MAX_BYTES } from "../../../talk/callToolLine.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

const OPEN: CallEntry = {
  atIso: "2026-09-25T02:20:00.000Z",
  kind: "open",
  model: "gpt-live",
  sessionId: "sess_1",
  voice: "marin",
};

/** A segment line, overridable. */
const said = (over: Partial<Extract<CallEntry, { kind: "segment" }>> = {}): CallEntry => ({
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "look at the staging pool",
  who: OWNER_SPEAKER,
  ...over,
});

describe("callEntryOf", () => {
  it("accepts each kind of line and refuses an unknown one", () => {
    expect(callEntryOf({ value: OPEN })).toEqual(OPEN);
    expect(callEntryOf({ value: { atIso: "2026-09-25T02:30:00.000Z", kind: "closed", why: null } })).toEqual({
      atIso: "2026-09-25T02:30:00.000Z",
      kind: "closed",
      why: null,
    });
    expect(callEntryOf({ value: { atIso: "2026-09-25T02:30:00.000Z", kind: "rename" } })).toBe(undefined);
  });

  it("refuses a line whose instant does not parse", () => {
    expect(callEntryOf({ value: { ...said(), atIso: "yesterday-ish" } })).toBe(undefined);
  });

  it("keeps the card a stretch of speech began on, and drops a mis-shaped card rather than the owner's words", () => {
    const onCard = callEntryOf({ value: said({ open: "hand:voice-mark-step" }) });
    const misShaped = callEntryOf({ value: { ...said(), open: "hand:../../etc" } });
    expect((onCard as Extract<CallEntry, { kind: "segment" }>).open).toBe("hand:voice-mark-step");
    expect((misShaped as Extract<CallEntry, { kind: "segment" }>).open).toBe(undefined);
    expect((misShaped as Extract<CallEntry, { kind: "segment" }>).text).toBe("look at the staging pool");
  });

  it("keeps that the voice opened the card, and drops any other opener rather than the owner's words", () => {
    const byVoice = callEntryOf({ value: said({ open: "hand:voice-mark-step", openBy: "voice" }) });
    const byOther = callEntryOf({ value: { ...said({ open: "hand:voice-mark-step" }), openBy: OWNER_SPEAKER } });
    expect((byVoice as Extract<CallEntry, { kind: "segment" }>).openBy).toBe("voice");
    expect((byOther as Extract<CallEntry, { kind: "segment" }>).openBy).toBe(undefined);
    expect((byOther as Extract<CallEntry, { kind: "segment" }>).open).toBe("hand:voice-mark-step");
  });

  it("keeps the other cards a relay landed, and makes only that line unreadable when the list is malformed", () => {
    const relay = {
      about: "ask:open-one",
      answersCard: true,
      atIso: "2026-09-25T02:22:00.000Z",
      detail: "",
      heard: "always split oversized files",
      kind: "relay",
      outcome: "relayed",
      say: "split them",
      turnId: "a0000071-0000-4000-8000-000000000077",
    };
    const kept = callEntryOf({ value: { ...relay, alsoAnswers: ["draft:abc-1", "ask:split-files"] } });
    expect((kept as Extract<CallEntry, { kind: "relay" }>).alsoAnswers).toEqual(["draft:abc-1", "ask:split-files"]);
    expect([
      callEntryOf({ value: { ...relay, alsoAnswers: ["ask:../../etc"] } }),
      callEntryOf({ value: { ...relay, alsoAnswers: ["ask:a", "ask:b", "ask:c", "ask:d", "ask:e", "ask:f"] } }),
    ]).toEqual([undefined, undefined]);
    expect((callEntryOf({ value: relay }) as Extract<CallEntry, { kind: "relay" }>).alsoAnswers).toBe(undefined);
  });

  it("cuts a monologue past the bound rather than refusing it", () => {
    const entry = callEntryOf({ value: said({ text: "x".repeat(20_000) }) });
    expect((entry as Extract<CallEntry, { kind: "segment" }>).text.length).toBe(16_000);
  });
});

describe("foldCall", () => {
  it("keeps a segment's last snapshot at the place it first appeared", () => {
    const call = foldCall({
      callId: CALL,
      entries: [
        OPEN,
        said({ final: false, text: "look at" }),
        said({ atIso: "2026-09-25T02:21:30.000Z", id: "s-2", text: "on it", who: "voice" }),
        said({ atIso: "2026-09-25T02:21:40.000Z", text: "look at the staging pool" }),
      ],
      skipped: 0,
    })!;
    expect(call.segments.map((segment) => [segment.id, segment.text, segment.final])).toEqual([
      ["s-1", "look at the staging pool", true],
      ["s-2", "on it", true],
    ]);
    expect(call.lastIso).toBe("2026-09-25T02:21:40.000Z");
  });

  // A keepalive post as the page goes can land ahead of the batch still in flight.
  it("orders the segments by when each began, not where their lines fell in the file", () => {
    const call = foldCall({
      callId: CALL,
      entries: [
        OPEN,
        said({ atIso: "2026-09-25T02:21:30.000Z", id: "s-2", text: "on it", who: "voice" }),
        said({ atIso: "2026-09-25T02:21:00.000Z", final: false, id: "s-1", text: "look at" }),
        said({ atIso: "2026-09-25T02:21:40.000Z", id: "s-1", text: "look at the staging pool" }),
        said({ atIso: "2026-09-25T02:21:30.000Z", id: "s-3", text: "same instant, appeared later" }),
      ],
      skipped: 0,
    })!;
    expect(call.segments.map((segment) => [segment.id, segment.text, segment.beganIso])).toEqual([
      ["s-1", "look at the staging pool", "2026-09-25T02:21:00.000Z"],
      ["s-2", "on it", "2026-09-25T02:21:30.000Z"],
      ["s-3", "same instant, appeared later", "2026-09-25T02:21:30.000Z"],
    ]);
  });

  // The batch with s-1's first line was refused, so its final line alone made it read as begun after s-2.
  it("takes when a stretch began from the instant its lines carry for it, never one later than the line", () => {
    const call = foldCall({
      callId: CALL,
      entries: [
        OPEN,
        said({ atIso: "2026-09-25T02:21:30.000Z", id: "s-2", text: "wait", who: OWNER_SPEAKER }),
        said({
          atIso: "2026-09-25T02:21:40.000Z",
          beganIso: "2026-09-25T02:21:00.000Z",
          id: "s-1",
          text: "first, finished",
          who: "voice",
        }),
        said({
          atIso: "2026-09-25T02:21:50.000Z",
          beganIso: "2026-09-25T02:22:00.000Z",
          id: "s-3",
          text: "claims a later start",
        }),
      ],
      skipped: 0,
    })!;
    expect(call.segments.map((segment) => [segment.id, segment.beganIso])).toEqual([
      ["s-1", "2026-09-25T02:21:00.000Z"],
      ["s-2", "2026-09-25T02:21:30.000Z"],
      ["s-3", "2026-09-25T02:21:50.000Z"],
    ]);
  });

  it("never lets a late partial undo a closed segment", () => {
    const call = foldCall({
      callId: CALL,
      entries: [said(), said({ atIso: "2026-09-25T02:21:05.000Z", final: false, text: "look" })],
      skipped: 0,
    })!;
    expect(call.segments[0]!.text).toBe("look at the staging pool");
  });

  it("keeps a relay's latest outcome once per turn", () => {
    const relay = {
      about: "",
      atIso: "2026-09-25T02:22:00.000Z",
      detail: "posting",
      heard: "look at the staging pool",
      kind: "relay" as const,
      outcome: "sending",
      say: "Look at the staging pool.",
      turnId: "a0000075-0000-4000-8000-000000000082",
    };
    const call = foldCall({
      callId: CALL,
      entries: [relay, { ...relay, atIso: "2026-09-25T02:22:05.000Z", detail: "row talk-1111", outcome: "relayed" }],
      skipped: 0,
    })!;
    expect(call.notes.map((note) => note.kind === "relay" && note.outcome)).toEqual(["relayed"]);
  });

  it("folds by each line's own instant when a keepalive post landed before the batch still in flight", () => {
    const relay = {
      about: "",
      atIso: "2026-09-25T02:22:00.000Z",
      detail: "posting",
      heard: "look at the staging pool",
      kind: "relay" as const,
      outcome: "sending",
      say: "Look at the staging pool.",
      turnId: "a0000075-0000-4000-8000-000000000082",
    };
    const call = foldCall({
      callId: CALL,
      entries: [
        said({ atIso: "2026-09-25T02:22:08.000Z", final: false, text: "and merge the pool fix" }),
        { ...relay, atIso: "2026-09-25T02:22:05.000Z", detail: "row talk-1111", outcome: "relayed" },
        OPEN,
        said({ atIso: "2026-09-25T02:22:04.000Z", final: false, text: "and merge" }),
        relay,
      ],
      skipped: 0,
    })!;
    expect([
      call.openedIso,
      call.segments.map((segment) => segment.text),
      call.notes.map((note) => note.kind === "relay" && note.outcome),
    ]).toEqual([OPEN.atIso, ["and merge the pool fix"], ["relayed"]]);
  });

  it("keeps a turnless relay a retried batch wrote twice once, and two distinct turnless relays both", () => {
    const relay = {
      about: "",
      atIso: "2026-09-25T02:22:00.000Z",
      detail: "no row",
      heard: "look at the staging pool",
      kind: "relay" as const,
      outcome: "refused",
      say: "",
      turnId: null,
    };
    const call = foldCall({
      callId: CALL,
      entries: [relay, relay, { ...relay, atIso: "2026-09-25T02:22:09.000Z", heard: "and the pool" }],
      skipped: 0,
    })!;
    expect(call.notes.map((note) => note.atIso)).toEqual(["2026-09-25T02:22:00.000Z", "2026-09-25T02:22:09.000Z"]);
  });

  it("keeps a tool line a retried batch wrote twice once, and two distinct calls of one tool both", () => {
    const tool = {
      atIso: "2026-09-25T02:23:00.000Z",
      detail: "pr 1255 merged",
      kind: "tool" as const,
      name: "github",
      refused: false,
    };
    const call = foldCall({
      callId: CALL,
      entries: [tool, tool, { ...tool, atIso: "2026-09-25T02:23:04.000Z" }],
      skipped: 0,
    })!;
    expect(call.notes.map((note) => note.atIso)).toEqual(["2026-09-25T02:23:00.000Z", "2026-09-25T02:23:04.000Z"]);
  });

  it("keeps the link a read tool opened, marks one too long to carry or malformed, never dropping the line", () => {
    const tool = {
      atIso: "2026-10-07T05:21:25.976Z",
      detail: "read",
      kind: "tool" as const,
      name: "slack_thread_after",
      refused: false,
    };
    const link = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";
    const call = foldCall({
      callId: CALL,
      entries: [callEntryOf({ value: { ...tool, opened: link } })!],
      skipped: 0,
    })!;
    expect(call.notes).toEqual([{ ...tool, opened: link }]);
    expect(callEntryOf({ value: { ...tool, opened: "x".repeat(2001) } })).toEqual({ ...tool, opened: null });
    expect(callEntryOf({ value: { ...tool, opened: "x".repeat(2000) } })).toEqual({
      ...tool,
      opened: "x".repeat(2000),
    });
    expect(callEntryOf({ value: { ...tool, opened: 7 } })).toEqual({ ...tool, opened: null });
    expect(callEntryOf({ value: { ...tool, opened: "" } })).toEqual({ ...tool, opened: null });
    expect(callEntryOf({ value: tool })).toEqual(tool);
  });

  it("keeps a line written twice where its later copy sits, so file order still says which read was newer", () => {
    const read = {
      atIso: "2026-10-07T05:21:25.976Z",
      detail: "read",
      kind: "tool" as const,
      name: "slack_thread_after",
      opened: "https://acme.slack.com/archives/C0SYNPLATFORM/pA",
      refused: false,
    };
    const other = { ...read, opened: "https://acme.slack.com/archives/C0SYNPLATFORM/pB" };
    const call = foldCall({ callId: CALL, entries: [read, other, read], skipped: 0 })!;
    expect(call.notes.map((note) => (note.kind === "tool" ? note.opened : note.kind))).toEqual([
      "https://acme.slack.com/archives/C0SYNPLATFORM/pB",
      "https://acme.slack.com/archives/C0SYNPLATFORM/pA",
    ]);
  });

  it("keeps two reads at one instant of two different links as two lines", () => {
    const read = {
      atIso: "2026-10-07T05:21:25.976Z",
      detail: "read",
      kind: "tool" as const,
      name: "slack_thread_after",
      opened: "https://acme.slack.com/archives/C0SYNPLATFORM/p1",
      refused: false,
    };
    const call = foldCall({
      callId: CALL,
      entries: [read, read, { ...read, opened: "https://acme.slack.com/archives/C0SYNPLATFORM/p2" }],
      skipped: 0,
    })!;
    expect(call.notes.map((note) => (note.kind === "tool" ? note.opened : note.kind))).toEqual([
      "https://acme.slack.com/archives/C0SYNPLATFORM/p1",
      "https://acme.slack.com/archives/C0SYNPLATFORM/p2",
    ]);
  });

  describe("a tool's answer", () => {
    const read = {
      atIso: "2026-11-01T07:00:00.000Z",
      detail: "read a file",
      kind: "tool" as const,
      name: "file_read",
      refused: false,
    };

    it("reads an old tool line, written before answers were kept, with no answer", () => {
      const entry = callEntryOf({ value: read })!;
      expect(entry.kind).toBe("tool");
      expect(entry).toEqual(read);
      const call = foldCall({ callId: CALL, entries: [entry], skipped: 0 })!;
      expect(call.notes.map((note) => (note.kind === "tool" ? note.answer : note.kind))).toEqual([undefined]);
    });

    it("keeps an answer byte for byte, exactly at the byte cap", () => {
      // "é" is two UTF-8 bytes: 12,288 of them are exactly 24 KiB.
      const answer = "é".repeat(CALL_TOOL_ANSWER_MAX_BYTES / 2);
      expect(Buffer.byteLength(answer, "utf8")).toBe(CALL_TOOL_ANSWER_MAX_BYTES);
      const entry = callEntryOf({ value: { ...read, answer } })!;
      expect(entry).toEqual({ ...read, answer });
      const call = foldCall({ callId: CALL, entries: [entry], skipped: 0 })!;
      expect(call.notes).toEqual([{ ...read, answer, opened: undefined }]);
    });

    it("keeps escapes, newlines and four-byte characters exactly as written", () => {
      const answer = '{"text":"a \\"quoted\\" line\\nand 語 🙂"}';
      expect(callEntryOf({ value: { ...read, answer } })).toEqual({ ...read, answer });
    });

    it("drops only the answer, never the line, when it is one byte over the cap", () => {
      const answer = `${"é".repeat(CALL_TOOL_ANSWER_MAX_BYTES / 2)}x`;
      expect(callEntryOf({ value: { ...read, answer } })).toEqual(read);
    });

    it("drops only the answer, never the line, when it is not a string", () => {
      expect(callEntryOf({ value: { ...read, answer: 7 } })).toEqual(read);
      expect(callEntryOf({ value: { ...read, answer: { text: "x" } } })).toEqual(read);
      expect(callEntryOf({ value: { ...read, answer: null } })).toEqual(read);
    });

    it("keeps a retried line carrying the same answer once", () => {
      const line = { ...read, answer: '{"text":"one"}' };
      const call = foldCall({ callId: CALL, entries: [line, line], skipped: 0 })!;
      expect(call.notes).toEqual([{ ...line, opened: undefined }]);
    });

    it("keeps two reads at one instant with the same summary but different answers as two lines", () => {
      const first = { ...read, answer: '{"text":"first document"}' };
      const second = { ...read, answer: '{"text":"second document"}' };
      const call = foldCall({ callId: CALL, entries: [first, second, first], skipped: 0 })!;
      expect(call.notes.map((note) => (note.kind === "tool" ? note.answer : note.kind))).toEqual([
        '{"text":"second document"}',
        '{"text":"first document"}',
      ]);
    });

    it("keeps the turn that called it, so talk fidelity reads a message against its own turn", () => {
      const line = { ...read, answer: '{"text":"one"}', turnId: "turn-7" };
      expect(callEntryOf({ value: line })).toEqual(line);
      const call = foldCall({ callId: CALL, entries: [line], skipped: 0 })!;
      expect(call.notes.map((note) => (note.kind === "tool" ? note.turnId : note.kind))).toEqual(["turn-7"]);
    });

    it("drops only a turn that is not a string, and keeps two turns' reads of one answer as two lines", () => {
      expect(callEntryOf({ value: { ...read, turnId: 7 } })).toEqual(read);
      const first = { ...read, turnId: "turn-1" };
      const second = { ...read, turnId: "turn-2" };
      const call = foldCall({ callId: CALL, entries: [first, second], skipped: 0 })!;
      expect(call.notes.map((note) => (note.kind === "tool" ? note.turnId : note.kind))).toEqual(["turn-1", "turn-2"]);
    });
  });

  it("carries the session, the end and the skipped count", () => {
    const call = foldCall({
      callId: CALL,
      entries: [
        OPEN,
        said(),
        { atIso: "2026-09-25T02:30:00.000Z", kind: "closed", why: "the connection closed — ice" },
      ],
      skipped: 1,
    })!;
    expect([call.sessionId, call.voice, call.skipped, call.openedIso]).toEqual(["sess_1", "marin", 1, OPEN.atIso]);
    expect(callEndPhrase({ call })).toBe("it ended at 2026-09-25T02:30:00.000Z — the connection closed — ice");
  });

  // Every call rides the owner's ChatGPT plan. An open line written under the old rule may still say who paid.
  it("reads an open line that still says who paid, keeping the call and dropping the payer", () => {
    expect(callEntryOf({ value: { ...OPEN, funding: "plan" } })).toEqual(OPEN);
    expect(callEntryOf({ value: { ...OPEN, funding: "api-key", planRefused: "usage limit reached" } })).toEqual(OPEN);
  });

  // The typed box writes the same file, its open line saying so.
  it("reads an open line with no surface as a voice call, and keeps a typed one typed", () => {
    expect(foldCall({ callId: CALL, entries: [OPEN, said()], skipped: 0 })!.surface).toBe("voice");
    const typed = foldCall({ callId: CALL, entries: [{ ...OPEN, surface: "typed" }, said()], skipped: 0 })!;
    expect([typed.surface, typed.segments[0]!.text]).toEqual(["typed", "look at the staging pool"]);
    expect(callEntryOf({ value: { ...OPEN, surface: "smoke-signal" } })).toBe(undefined);
  });

  it("folds two open lines for one session into one record", () => {
    const joined = foldCall({
      callId: CALL,
      entries: [OPEN, { ...OPEN, atIso: "2026-09-25T02:20:02.000Z" }, said()],
      skipped: 0,
    })!;
    expect([joined.sessionId, joined.segments.length]).toEqual(["sess_1", 1]);
  });

  it("labels a second session under a reused call id as that session, never the first one", () => {
    const first: CallEntry = { ...OPEN, sessionId: "thread_first" };
    const reused = foldCall({
      callId: CALL,
      entries: [first, { ...OPEN, atIso: "2026-09-25T02:30:00.000Z", sessionId: "thread_second" }],
      skipped: 0,
    })!;
    expect(reused.sessionId).toBe("thread_second");
  });

  it("never lets a late line for an older session take a reused call id back from the newer one", () => {
    const first: CallEntry = { ...OPEN, sessionId: "thread_first" };
    const second: CallEntry = { ...OPEN, atIso: "2026-09-25T02:30:00.000Z", sessionId: "thread_second" };
    const late = foldCall({
      callId: CALL,
      entries: [first, second, { ...first, atIso: "2026-09-25T02:20:01.000Z" }],
      skipped: 0,
    })!;
    expect([late.sessionId, late.openedIso]).toEqual(["thread_second", "2026-09-25T02:30:00.000Z"]);
  });

  it("folds two sessions opened in the same millisecond to one record, whichever order their lines land in", () => {
    const at = "2026-09-27T00:00:00.000Z";
    const first: CallEntry = { ...OPEN, atIso: at, sessionId: "thread_a" };
    const second: CallEntry = { ...OPEN, atIso: at, sessionId: "thread_b" };
    const inOrder = foldCall({ callId: CALL, entries: [first, second], skipped: 0 })!;
    const reversed = foldCall({ callId: CALL, entries: [second, first], skipped: 0 })!;
    expect([inOrder.sessionId, reversed.sessionId]).toEqual(["thread_b", "thread_b"]);
  });

  it("is nothing when no line parsed", () => {
    expect(foldCall({ callId: CALL, entries: [], skipped: 3 })).toBe(undefined);
  });
});

/** The plan thread's tokens after one turn, overridable — what the page writes from `thread/tokenUsage/updated`. */
const used = (over: Partial<Extract<CallEntry, { kind: "usage" }>> = {}): Extract<CallEntry, { kind: "usage" }> => ({
  atIso: "2026-09-28T05:08:42.000Z",
  contextWindow: 272_000,
  kind: "usage",
  last: {
    cachedInputTokens: 30_000,
    inputTokens: 41_200,
    outputTokens: 310,
    reasoningOutputTokens: 120,
    totalTokens: 41_510,
  },
  total: {
    cachedInputTokens: 90_000,
    inputTokens: 118_400,
    outputTokens: 1_020,
    reasoningOutputTokens: 400,
    totalTokens: 119_420,
  },
  turnId: "turn-3",
  ...over,
});

describe("usage lines", () => {
  it("accepts a turn's usage whole, keeping an absent cache-write count absent and a null window null", () => {
    const entry = callEntryOf({ value: used({ contextWindow: null }) }) as Extract<CallEntry, { kind: "usage" }>;
    expect(entry.contextWindow).toBe(null);
    expect(entry.last).toEqual({
      cachedInputTokens: 30_000,
      inputTokens: 41_200,
      outputTokens: 310,
      reasoningOutputTokens: 120,
      totalTokens: 41_510,
    });
    expect("cacheWriteInputTokens" in entry.last).toBe(false);
  });

  it("refuses a count that is negative, fractional or missing, and a turn with no id", () => {
    const { last } = used();
    expect(callEntryOf({ value: used({ last: { ...last, inputTokens: -1 } }) })).toBe(undefined);
    expect(callEntryOf({ value: used({ last: { ...last, outputTokens: 1.5 } }) })).toBe(undefined);
    const { totalTokens: _dropped, ...missing } = last;
    expect(callEntryOf({ value: { ...used(), last: missing } })).toBe(undefined);
    expect(callEntryOf({ value: used({ turnId: "" }) })).toBe(undefined);
  });

  it("folds one row per turn, the latest report winning at the turn's first place, and never into the notes", () => {
    const later = used({ atIso: "2026-09-28T05:08:50.000Z", last: { ...used().last, outputTokens: 400 } });
    const next = used({ atIso: "2026-09-28T05:30:00.000Z", turnId: "turn-4" });
    const call = foldCall({ callId: CALL, entries: [OPEN, used(), next, later], skipped: 0 })!;
    expect(call.usages.map((usage) => [usage.turnId, usage.last.outputTokens])).toEqual([
      ["turn-3", 400],
      ["turn-4", 310],
    ]);
    expect(call.notes).toEqual([]);
    expect(call.lastIso).toBe("2026-09-28T05:30:00.000Z");
  });

  it("is an empty list on a call written before usage was recorded", () => {
    expect(foldCall({ callId: CALL, entries: [OPEN, said()], skipped: 0 })!.usages).toEqual([]);
  });
});

/** One message the plan thread handed the voice, overridable — what the page writes from a completed agentMessage. */
const wrote = (over: Partial<Extract<CallEntry, { kind: "wrote" }>> = {}): Extract<CallEntry, { kind: "wrote" }> => ({
  atIso: "2026-10-09T12:07:42.250Z",
  itemId: "msg-1",
  kind: "wrote",
  text: "That covers fourteen cards. That's the last one.",
  turnId: "01a1208f",
  ...over,
});

// The voice once said "fourteen cards" and the file could not say whether the plan
// thread wrote it, because only what the voice said was kept.
describe("wrote lines", () => {
  it("accepts a completed message whole and refuses one with no item or turn", () => {
    expect(callEntryOf({ value: wrote() })).toEqual(wrote());
    expect(callEntryOf({ value: wrote({ itemId: "" }) })).toBe(undefined);
    expect(callEntryOf({ value: wrote({ turnId: "" }) })).toBe(undefined);
  });

  it("folds one row per message, a retried copy once, apart from what the voice said and from the notes", () => {
    const next = wrote({ atIso: "2026-10-09T12:09:40.000Z", itemId: "msg-2", text: "My response said nine." });
    const call = foldCall({
      callId: CALL,
      entries: [OPEN, wrote(), said({ who: "voice" }), next, wrote()],
      skipped: 0,
    })!;
    expect(call.written).toEqual([
      {
        atIso: "2026-10-09T12:07:42.250Z",
        itemId: "msg-1",
        text: "That covers fourteen cards. That's the last one.",
        turnId: "01a1208f",
      },
      { atIso: "2026-10-09T12:09:40.000Z", itemId: "msg-2", text: "My response said nine.", turnId: "01a1208f" },
    ]);
    expect(call.notes).toEqual([]);
    expect(call.segments.map((segment) => segment.who)).toEqual(["voice"]);
  });

  it("is an empty list on a call written before the thread's words were kept", () => {
    expect(foldCall({ callId: CALL, entries: [OPEN, said()], skipped: 0 })!.written).toEqual([]);
  });
});

/** One message that landed on the owner's running list, overridable — what the page writes as the offer lands. */
const offered = ({
  offer = {},
  atIso = "2026-10-13T12:31:19.221Z",
}: {
  offer?: Record<string, unknown>;
  atIso?: string;
} = {}): Record<string, unknown> => ({
  atIso,
  kind: "offered",
  offer: {
    belowFold: "• <@U01ARI> owns the rollback",
    id: "offer-3",
    made: "3",
    text: "*Staging* is back",
    ...offer,
  },
  writeId: "0f1e2d3c-4b5a-4968-8776-655443322110",
});

// A tray offer was not recoverable from disk — the call log recorded only
// "copy offered", and the tray was the overlay's memory.
describe("offered lines", () => {
  it("accepts an offer whole, head, fold, label and mention tag byte for byte", () => {
    const line = offered({ offer: { label: "reply to Ari" } });
    expect(callEntryOf({ value: line })).toEqual(line);
  });

  it("accepts an offer at the list's bound, head and fold together with the newline that joins them", () => {
    const text = "🙂".repeat(4000);
    const belowFold = "🙂".repeat(8192 - 4000 - 1);
    const line = offered({ offer: { belowFold, text } });
    expect(callEntryOf({ value: line })).toEqual(line);
  });

  // The page refuses past 20 digits, so the file takes every width the page lands, and no wider.
  it("takes an offer whose counter is the page's widest, and refuses one a digit wider", () => {
    const widest = "9".repeat(20);
    const line = offered({ offer: { id: `offer-${widest}`, made: widest } });
    expect(callEntryOf({ value: line })).toEqual(line);
    const wider = `1${"0".repeat(20)}`;
    expect(callEntryOf({ value: offered({ offer: { id: `offer-${wider}`, made: wider } }) })).toBe(undefined);
  });

  it.each([
    ["one code point past the bound together", { belowFold: "🙂".repeat(8192 - 4000), text: "🙂".repeat(4000) }],
    ["a blank head", { text: "  " }],
    ["a blank fold", { belowFold: "\n" }],
    ["a blank label", { label: " " }],
    ["a label past 80 code points", { label: "🙂".repeat(81) }],
    ["made that is not canonical decimal", { made: "07" }],
    ["made as a number", { made: 3 }],
    ["an empty id", { id: "" }],
    ["half a surrogate pair in the head", { text: "<@U01ARI>\uD800" }],
    ["half a surrogate pair in the fold", { belowFold: "\uDC00 the rest" }],
  ])("refuses a line with %s, never cutting it", (_name, offer) => {
    expect(callEntryOf({ value: offered({ offer }) })).toBe(undefined);
  });

  it("folds each offer once, in the order they landed, apart from the notes, the speech and the owner's words", () => {
    const later = offered({
      atIso: "2026-10-13T12:33:00.000Z",
      offer: { belowFold: undefined, id: "offer-4", made: "4" },
    });
    const entries = [OPEN, offered(), said({ who: "voice" }), later, offered()].map((value) => callEntryOf({ value })!);
    const call = foldCall({ callId: CALL, entries, skipped: 0 })!;
    expect(call.offers).toEqual([
      {
        atIso: "2026-10-13T12:31:19.221Z",
        belowFold: "• <@U01ARI> owns the rollback",
        id: "offer-3",
        label: undefined,
        made: "3",
        text: "*Staging* is back",
      },
      {
        atIso: "2026-10-13T12:33:00.000Z",
        belowFold: undefined,
        id: "offer-4",
        label: undefined,
        made: "4",
        text: "*Staging* is back",
      },
    ]);
    expect(call.notes).toEqual([]);
    expect(call.segments.map((segment) => segment.who)).toEqual(["voice"]);
    expect(call.lastIso).toBe("2026-10-13T12:33:00.000Z");
  });

  it("leaves a malformed offer to be skipped and counted, the call still folding without it", () => {
    expect(callEntryOf({ value: offered({ offer: { text: "" } }) })).toBe(undefined);
    const call = foldCall({ callId: CALL, entries: [OPEN], skipped: 1 })!;
    expect(call.skipped).toBe(1);
    expect(call.offers).toEqual([]);
  });

  it("is an empty list on a call written before the tray's offers were kept", () => {
    expect(foldCall({ callId: CALL, entries: [OPEN, said()], skipped: 0 })!.offers).toEqual([]);
  });
});

// A reconnect that tried and did not succeed left nothing on disk saying why. The page now writes each
// step onto the dropped call, after its close.
describe("reconnect lines", () => {
  const LIMIT = "the plan call ended: the console's own 90-minute call limit was reached";
  const DROPPED: CallEntry = { atIso: "2026-09-25T02:30:00.000Z", kind: "closed", why: LIMIT };
  const NEW_CALL = "a0000076-0000-4000-8000-000000000083";
  const step = ({
    atIso,
    event,
  }: {
    atIso: string;
    event: Extract<CallEntry, { kind: "reconnect" }>["event"];
  }): CallEntry => ({ atIso, event, kind: "reconnect" });
  const SCHEDULED = step({
    atIso: "2026-09-25T02:30:00.010Z",
    event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
  });
  const FAILED = step({
    atIso: "2026-09-25T02:30:03.000Z",
    event: {
      attempt: 1,
      kind: "failed",
      total: 5,
      why: "the console server did not answer the mint: TypeError: Failed to fetch",
    },
  });
  const LIVE = step({
    atIso: "2026-09-25T02:30:09.000Z",
    event: { attempt: 2, kind: "live", newCallId: NEW_CALL, total: 5 },
  });

  it("accepts each step and refuses an attempt past the chain's total or a live call id that is not one", () => {
    expect(callEntryOf({ value: LIVE })).toEqual(LIVE);
    expect(
      callEntryOf({
        value: { ...SCHEDULED, event: { attempt: 6, delayMs: 0, kind: "scheduled", total: 5 } },
      }),
    ).toBe(undefined);
    expect(
      callEntryOf({ value: { ...LIVE, event: { attempt: 1, kind: "live", newCallId: "not-a-call", total: 5 } } }),
    ).toBe(undefined);
  });

  it("keeps the steps in the order they happened, once each, and leaves the end and when the call was last heard alone", () => {
    const record = foldCall({
      callId: CALL,
      entries: [OPEN, said(), DROPPED, FAILED, SCHEDULED, FAILED, LIVE],
      skipped: 0,
    })!;
    expect(record.reconnects.map((reconnect) => reconnect.event.kind)).toEqual(["scheduled", "failed", "live"]);
    expect(record.ended).toEqual({ atIso: DROPPED.atIso, why: LIMIT });
    expect(record.lastIso).toBe(DROPPED.atIso);
  });

  it("makes no call of a file holding only reconnect steps", () => {
    expect(foldCall({ callId: CALL, entries: [SCHEDULED, FAILED], skipped: 0 })).toBe(undefined);
  });

  it("is an empty list on a call that never dropped", () => {
    expect(foldCall({ callId: CALL, entries: [OPEN, said()], skipped: 0 })!.reconnects).toEqual([]);
  });

  it("phrases each step as talk calls prints it, the failure's reason whole", () => {
    const record = foldCall({
      callId: CALL,
      entries: [
        DROPPED,
        SCHEDULED,
        FAILED,
        LIVE,
        step({ atIso: "2026-09-25T02:31:00.000Z", event: { kind: "gave-up", total: 5, why: "five tries failed" } }),
      ],
      skipped: 0,
    })!;
    expect(record.reconnects.map((reconnect) => reconnectPhrase({ reconnect }))).toEqual([
      "2026-09-25T02:30:00.010Z  reconnect 1/5 in 0ms",
      "2026-09-25T02:30:03.000Z  reconnect 1/5 failed — the console server did not answer the mint: TypeError: Failed to fetch",
      `2026-09-25T02:30:09.000Z  reconnect 2/5 live as call ${NEW_CALL}`,
      "2026-09-25T02:31:00.000Z  reconnect gave up — five tries failed",
    ]);
  });

  // A reconnect repeats until it succeeds, so the page
  // writes no total — and an attempt past the old five is a step like any other.
  it("accepts and phrases a step with no total, past where the old chain stopped", () => {
    const untotalled = [
      step({ atIso: "2026-10-05T08:00:00.010Z", event: { attempt: 9, delayMs: 30_000, kind: "scheduled" } }),
      step({ atIso: "2026-10-05T08:00:31.000Z", event: { attempt: 9, kind: "failed", why: "offline" } }),
      step({ atIso: "2026-10-05T08:01:02.000Z", event: { attempt: 10, kind: "live", newCallId: NEW_CALL } }),
    ];
    expect(untotalled.map((value) => callEntryOf({ value }))).toEqual(untotalled);
    const record = foldCall({ callId: CALL, entries: [DROPPED, ...untotalled], skipped: 0 })!;
    expect(record.reconnects.map((reconnect) => reconnectPhrase({ reconnect }))).toEqual([
      "2026-10-05T08:00:00.010Z  reconnect 9 in 30000ms",
      "2026-10-05T08:00:31.000Z  reconnect 9 failed — offline",
      `2026-10-05T08:01:02.000Z  reconnect 10 live as call ${NEW_CALL}`,
    ]);
  });
});

describe("callEndPhrase", () => {
  it("says the owner hung up, or that no end was recorded, never an end the file lacks", () => {
    expect(
      callEndPhrase({
        call: { ended: { atIso: "2026-09-25T02:30:00.000Z", why: null }, lastIso: "2026-09-25T02:30:00.000Z" },
      }),
    ).toBe("the owner hung up at 2026-09-25T02:30:00.000Z");
    expect(callEndPhrase({ call: { ended: undefined, lastIso: "2026-09-25T02:29:40.000Z" } })).toBe(
      "no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z",
    );
  });
});
