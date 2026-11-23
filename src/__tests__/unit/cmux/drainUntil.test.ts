/**
 * `drainUntil` over a fake subscription whose `close()` fires `onEnd` SYNCHRONOUSLY — exactly what
 * `openCmuxEventStream`'s own `close()` does. Measured: `finish` closed the stream before settling,
 * the synchronous `onEnd` re-entered `finish` with `match: undefined` and won, and `cmux takeover` refused on
 * the GAP-inconclusive line with its own armed sweep in hand.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import {
  type CmuxEventHandlers,
  type CmuxEventStream,
  drainUntil,
  readCmuxEventAck,
} from "../../../cmux/eventStream.js";
import { type CmuxEvent, type CmuxEventAck } from "../../../cmux/events.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Long enough that neither timer can decide a case; `finish` clears both. */
const NEVER_MS = 60_000;

const ACK: CmuxEventAck = {
  gap: true,
  latestSeq: 1_241_800,
  nextSeq: 1_241_801,
  oldestSeq: 1_200_000,
  replayCount: 3,
  subscriptionId: "sub-1",
};

function event({ seq, toolName }: { seq: number; toolName: string }): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: "/worktree",
    id: `boot-${String(seq)}`,
    name: "agent.hook.PreToolUse",
    occurredAtIso: "2026-10-05T19:30:00.000Z",
    phase: undefined,
    seq,
    sessionId: "claude-1",
    surfaceId: undefined,
    toolName,
    workspaceId: "ws-1",
  };
}

/**
 * A subscription opener that hands its handlers back to the test and ends the way the real stream does:
 * `close()` calls `onEnd` synchronously, at most once.
 */
function fakeOpener(): {
  readonly open: (options: { handlers: CmuxEventHandlers }) => CmuxEventStream;
  readonly handlers: () => CmuxEventHandlers;
  readonly closes: () => number;
} {
  let captured: CmuxEventHandlers | undefined;
  let closes = 0;
  let ended = false;
  return {
    closes: () => closes,
    handlers: () => captured!,
    open: ({ handlers }) => {
      captured = handlers;
      return {
        close: () => {
          closes += 1;
          if (ended) {
            return;
          }
          ended = true;
          handlers.onEnd({ error: undefined });
        },
      };
    },
  };
}

describe("drainUntil", () => {
  it("keeps the stopWhen match when close() ends the stream synchronously", async () => {
    const fake = fakeOpener();
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: fake.open,
      quietMs: NEVER_MS,
      stopWhen: ({ event: one }) => one.toolName === "ScheduleWakeup",
      subscription: { afterSeq: 0 },
    });

    fake.handlers().onAck({ ack: ACK });
    fake.handlers().onEvent({ event: event({ seq: 1_241_762, toolName: "Bash" }) });
    fake.handlers().onEvent({ event: event({ seq: 1_241_763, toolName: "ScheduleWakeup" }) });
    const result = unwrap(await drained);

    expect(result.gap).toBe(true);
    expect(result.match!.seq).toBe(1_241_763);
    expect(fake.closes()).toBe(1);
  });

  it("ignores an event arriving after the match settled the drain", async () => {
    const fake = fakeOpener();
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: fake.open,
      quietMs: NEVER_MS,
      stopWhen: ({ event: one }) => one.toolName === "ScheduleWakeup",
      subscription: { afterSeq: 0 },
    });

    fake.handlers().onAck({ ack: { ...ACK, gap: false } });
    fake.handlers().onEvent({ event: event({ seq: 7, toolName: "ScheduleWakeup" }) });
    fake.handlers().onEvent({ event: event({ seq: 8, toolName: "ScheduleWakeup" }) });
    const result = unwrap(await drained);

    expect(result).toEqual({ gap: false, match: event({ seq: 7, toolName: "ScheduleWakeup" }), oldestSeq: 1_200_000 });
  });

  it("resolves with no match when the stream ends cleanly before any event matched", async () => {
    const fake = fakeOpener();
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: fake.open,
      quietMs: NEVER_MS,
      stopWhen: ({ event: one }) => one.toolName === "ScheduleWakeup",
      subscription: { afterSeq: 0 },
    });

    fake.handlers().onAck({ ack: ACK });
    fake.handlers().onEvent({ event: event({ seq: 9, toolName: "Bash" }) });
    fake.handlers().onEnd({ error: undefined });

    expect(unwrap(await drained)).toEqual({ gap: true, match: undefined, oldestSeq: 1_200_000 });
  });

  it("reports no oldest seq when the stream ends before cmux acked", async () => {
    const fake = fakeOpener();
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: fake.open,
      quietMs: NEVER_MS,
      stopWhen: () => true,
      subscription: { afterSeq: 0 },
    });

    fake.handlers().onEnd({ error: undefined });

    expect(unwrap(await drained)).toEqual({ gap: false, match: undefined, oldestSeq: undefined });
  });

  it("resolves the socket's typed failure when the stream ends with an error", async () => {
    const fake = fakeOpener();
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: fake.open,
      quietMs: NEVER_MS,
      stopWhen: () => true,
      subscription: { afterSeq: 0 },
    });

    fake.handlers().onEnd({
      error: CmuxErrors.socketUnavailable({ detail: "connection reset", socketPath: "/tmp/cmux.sock" }),
    });
    const failure = unwrapErr(await drained);

    expect(failure.code).toBe("SOCKET_UNAVAILABLE");
    expect(failure.message).toBe("cmux control socket unavailable at /tmp/cmux.sock: connection reset");
  });
});

/**
 * An opener that delivers its frames SYNCHRONOUSLY, before it returns the stream — allowed by the opener's
 * contract — and whose `close()` also ends synchronously, counting closes.
 */
function synchronousOpener({ deliver }: { deliver: (options: { handlers: CmuxEventHandlers }) => void }): {
  readonly open: (options: { handlers: CmuxEventHandlers }) => CmuxEventStream;
  readonly closes: () => number;
} {
  let closes = 0;
  return {
    closes: () => closes,
    open: ({ handlers }) => {
      deliver({ handlers });
      return {
        close: () => {
          closes += 1;
          handlers.onEnd({ error: undefined });
        },
      };
    },
  };
}

describe("a synchronous opener", () => {
  it("lets drainUntil settle on a match delivered before the opener returned, then closes it", async () => {
    const opener = synchronousOpener({
      deliver: ({ handlers }) => {
        handlers.onAck({ ack: ACK });
        handlers.onEvent({ event: event({ seq: 1_241_763, toolName: "ScheduleWakeup" }) });
      },
    });
    const drained = drainUntil({
      deadlineMs: NEVER_MS,
      openStream: opener.open,
      quietMs: NEVER_MS,
      stopWhen: ({ event: one }) => one.toolName === "ScheduleWakeup",
      subscription: { afterSeq: 0 },
    });
    const result = unwrap(await drained);

    expect(result.match!.seq).toBe(1_241_763);
    expect(opener.closes()).toBe(1);
  });

  it("lets readCmuxEventAck settle on an ack delivered before the opener returned, then closes it", async () => {
    const opener = synchronousOpener({ deliver: ({ handlers }) => handlers.onAck({ ack: ACK }) });
    const acked = readCmuxEventAck({ deadlineMs: NEVER_MS, openStream: opener.open, subscription: {} });

    expect(unwrap(await acked)).toEqual(ACK);
    expect(opener.closes()).toBe(1);
  });
});

describe("readCmuxEventAck", () => {
  it("resolves the ack and hangs up once, even though close() ends the stream synchronously", async () => {
    const fake = fakeOpener();
    const acked = readCmuxEventAck({ deadlineMs: NEVER_MS, openStream: fake.open, subscription: {} });

    fake.handlers().onAck({ ack: ACK });

    expect(unwrap(await acked)).toEqual(ACK);
    expect(fake.closes()).toBe(1);
  });

  it("is a malformed reply when the stream ends cleanly before any ack", async () => {
    const fake = fakeOpener();
    const acked = readCmuxEventAck({ deadlineMs: NEVER_MS, openStream: fake.open, subscription: {} });

    fake.handlers().onEnd({ error: undefined });
    const failure = unwrapErr(await acked);

    expect(failure.code).toBe("MALFORMED_REPLY");
    expect(failure.message).toContain("the stream ended before cmux acked");
  });

  it("resolves the socket's typed failure when the stream ends with an error", async () => {
    const fake = fakeOpener();
    const acked = readCmuxEventAck({ deadlineMs: NEVER_MS, openStream: fake.open, subscription: {} });

    fake.handlers().onEnd({
      error: CmuxErrors.socketUnavailable({ detail: "connection reset", socketPath: "/tmp/cmux.sock" }),
    });

    expect(unwrapErr(await acked).code).toBe("SOCKET_UNAVAILABLE");
  });

  it("times out when cmux never acks", async () => {
    const fake = fakeOpener();
    const acked = readCmuxEventAck({ deadlineMs: 1, openStream: fake.open, subscription: {} });
    const failure = unwrapErr(await acked);

    expect(failure.code).toBe("TIMEOUT");
    expect(fake.closes()).toBe(1);
  });
});
