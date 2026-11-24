/*
 * What app-server says of a Codex turn beside its items — the model's reply dropped and Codex is re-sending, it
 * dropped for good, a warning on the thread — read off the wire, forwarded to the page, streamed and written into the
 * call file. MEASURED: the console dropped every one, so a 326s wait that fits Codex's 300s stream idle timeout and a
 * re-send could not be told from the call file. Plain values; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { codexWaitLine } from "../../components/voice/planWiringCodexLines";
import { planStreamEntryOf } from "../../lib/talkPlanEventsStream";
import { codexNoticeOf } from "../../lib/talkPlanProtocolTurns";
import { codexNoticeEventsOf } from "../../lib/talkPlanTurns";

const dropped = {
  error: { additionalDetails: null, codexErrorInfo: null, message: "stream disconnected before completion" },
  threadId: "thread-1",
  turnId: "t-1",
  willRetry: true,
};

describe("codexNoticeOf", () => {
  it("reads a re-send, a failure and a thread's warning, each with its message", () => {
    expect([
      codexNoticeOf({ method: "error", params: dropped }),
      codexNoticeOf({ method: "error", params: { ...dropped, willRetry: false } }),
      codexNoticeOf({ method: "warning", params: { message: "approaching the usage limit", threadId: "thread-1" } }),
    ]).toEqual([
      { kind: "retry", message: "stream disconnected before completion", threadId: "thread-1", turnId: "t-1" },
      { kind: "failure", message: "stream disconnected before completion", threadId: "thread-1", turnId: "t-1" },
      { kind: "warning", message: "approaching the usage limit", threadId: "thread-1" },
    ]);
  });

  it("reads nothing it cannot read whole: no retry flag, no message, no turn, a warning on no thread, another method", () => {
    const { willRetry: _unset, ...noFlag } = dropped;
    expect([
      codexNoticeOf({ method: "error", params: noFlag }),
      codexNoticeOf({ method: "error", params: { ...dropped, error: {} } }),
      codexNoticeOf({ method: "error", params: { ...dropped, turnId: "" } }),
      codexNoticeOf({ method: "warning", params: { message: "a config warning", threadId: null } }),
      codexNoticeOf({ method: "thread/realtime/error", params: dropped }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("codexNoticeEventsOf", () => {
  const running = new Set<string>(["t-1"]);

  // Never the call's `error`: that would draw the error face over a turn Codex is still working.
  it("forwards a re-send in a running turn as a notice and that turn's step put to awaiting the re-send", () => {
    expect(codexNoticeEventsOf({ method: "error", params: dropped, running, threadId: "thread-1" })).toEqual([
      { kind: "codex-notice", level: "retry", message: "stream disconnected before completion", turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "awaiting", reason: "retry" }, turnId: "t-1" },
    ]);
  });

  it("forwards a failure, a warning, and a re-send in a turn no longer running as the notice alone", () => {
    const failure = { ...dropped, willRetry: false };
    const warning = { message: "approaching the usage limit", threadId: "thread-1" };
    expect([
      codexNoticeEventsOf({ method: "error", params: failure, running, threadId: "thread-1" }),
      codexNoticeEventsOf({ method: "warning", params: warning, running, threadId: "thread-1" }),
      codexNoticeEventsOf({ method: "error", params: dropped, running: new Set(), threadId: "thread-1" }),
    ]).toEqual([
      [{ kind: "codex-notice", level: "failure", message: "stream disconnected before completion", turnId: "t-1" }],
      [{ kind: "codex-notice", level: "warning", message: "approaching the usage limit", turnId: null }],
      [{ kind: "codex-notice", level: "retry", message: "stream disconnected before completion", turnId: "t-1" }],
    ]);
  });

  it("forwards nothing of another thread's notice", () => {
    expect(codexNoticeEventsOf({ method: "error", params: dropped, running, threadId: "thread-9" })).toEqual([]);
  });
});

describe("planStreamEntryOf on a wait or a notice", () => {
  it("reads a wait, a notice on a turn and a notice on none whole", () => {
    const wait = { kind: "model-wait", turnId: "t-1", waitMs: 326_000 };
    const notice = { kind: "codex-notice", level: "retry", message: "stream disconnected", turnId: "t-1" };
    const warning = { kind: "codex-notice", level: "warning", message: "near the limit", turnId: null };
    expect(
      [wait, notice, warning].map((event, seq) => planStreamEntryOf({ line: JSON.stringify({ event, seq }) })),
    ).toEqual([
      { event: wait, kind: "event", seq: 0 },
      { event: notice, kind: "event", seq: 1 },
      { event: warning, kind: "event", seq: 2 },
    ]);
  });

  it("reads a negative or fractional wait, an unknown level, a missing message or an absent turn as unreadable", () => {
    const broken = [
      { kind: "model-wait", turnId: "t-1", waitMs: -1 },
      { kind: "model-wait", turnId: "t-1", waitMs: 1.5 },
      { kind: "codex-notice", level: "panic", message: "x", turnId: "t-1" },
      { kind: "codex-notice", level: "retry", turnId: "t-1" },
      { kind: "codex-notice", level: "retry", message: "x" },
    ];
    const lines = broken.map((event, seq) => JSON.stringify({ event, seq }));
    expect(lines.map((line) => planStreamEntryOf({ line }))).toEqual(
      lines.map((line) => ({ kind: "unreadable", line })),
    );
  });

  it("reads an awaiting step on a turn's progress, and one with an unknown reason as unreadable", () => {
    const event = { kind: "codex-turn", phase: "progress", step: { kind: "awaiting", reason: "retry" }, turnId: "t-1" };
    const odd = JSON.stringify({ event: { ...event, step: { kind: "awaiting", reason: "bored" } }, seq: 2 });
    expect([planStreamEntryOf({ line: JSON.stringify({ event, seq: 1 }) }), planStreamEntryOf({ line: odd })]).toEqual([
      { event, kind: "event", seq: 1 },
      { kind: "unreadable", line: odd },
    ]);
  });
});

describe("codexWaitLine", () => {
  it("writes a long wait in whole seconds rounded down, and each notice level under its own name", () => {
    expect([
      codexWaitLine({ event: { kind: "model-wait", turnId: "t-1", waitMs: 326_999 } }),
      codexWaitLine({ event: { kind: "codex-notice", level: "retry", message: "stream disconnected", turnId: "t-1" } }),
      codexWaitLine({
        event: { kind: "codex-notice", level: "failure", message: "usage limit reached", turnId: "t-1" },
      }),
      codexWaitLine({ event: { kind: "codex-notice", level: "warning", message: "near the limit", turnId: null } }),
    ]).toEqual([
      {
        detail: "turn t-1 waited 326s for the model's reply",
        ms: undefined,
        name: "model-wait",
        refused: false,
        usage: undefined,
      },
      {
        detail: "turn t-1: stream disconnected; Codex is re-sending",
        ms: undefined,
        name: "codex-retry",
        refused: false,
        usage: undefined,
      },
      { detail: "turn t-1: usage limit reached", ms: undefined, name: "codex-error", refused: true, usage: undefined },
      { detail: "near the limit", ms: undefined, name: "codex-warning", refused: false, usage: undefined },
    ]);
  });
});
