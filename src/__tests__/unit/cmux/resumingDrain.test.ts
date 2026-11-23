/**
 * `drainResuming` over a scripted subscription opener — one script per round, each delivering its frames
 * SYNCHRONOUSLY and, for a hang-up, ending the stream cleanly the way cmux 0.65.2 did mid-replay.
 * A round whose script does not end it is left to its quiet timer, set to zero here.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import { type CmuxEventHandlers, type CmuxEventStream } from "../../../cmux/eventStream.js";
import { type CmuxEvent, type CmuxEventAck } from "../../../cmux/events.js";
import { type DrainRound, drainResuming, nextDrainStep } from "../../../cmux/resumingDrain.js";

/** Long enough that the deadline never decides a case it is not named in. */
const NEVER_MS = 60_000;

function ack({ replayCount, gap = false }: { replayCount: number; gap?: boolean }): CmuxEventAck {
  return { gap, latestSeq: 900, nextSeq: 901, oldestSeq: 100, replayCount, subscriptionId: "sub-1" };
}

function event({ seq }: { seq: number }): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: "/worktree",
    id: `ev-${String(seq)}`,
    name: "agent.hook.PreToolUse",
    occurredAtIso: "2026-10-25T08:20:00.000Z",
    phase: undefined,
    seq,
    sessionId: "claude-1",
    surfaceId: undefined,
    toolName: "Bash",
    workspaceId: "ws-1",
  };
}

type Script = (options: { handlers: CmuxEventHandlers }) => void;

/**
 * An opener that runs the next script on each open and records where each round resumed from. Its `close()`
 * ends the stream synchronously, as the real one does, at most once per round.
 */
function scriptedOpener({ scripts }: { scripts: readonly Script[] }): {
  readonly open: (options: {
    handlers: CmuxEventHandlers;
    subscription: { readonly afterSeq?: number };
  }) => CmuxEventStream;
  readonly resumedFrom: () => readonly (number | undefined)[];
} {
  const resumedFrom: (number | undefined)[] = [];
  return {
    open: ({ handlers, subscription }) => {
      resumedFrom.push(subscription.afterSeq);
      let ended = false;
      const guarded: CmuxEventHandlers = {
        ...handlers,
        onEnd: (ending) => {
          if (ended) {
            return;
          }
          ended = true;
          handlers.onEnd(ending);
        },
      };
      scripts[resumedFrom.length - 1]!({ handlers: guarded });
      return { close: () => guarded.onEnd({ error: undefined }) };
    },
    resumedFrom: () => resumedFrom,
  };
}

/** A round cmux acks with a replay of `replayCount`, delivers `seqs` of it, then hangs up cleanly. */
function hangsUp({ replayCount, seqs, gap }: { replayCount: number; seqs: readonly number[]; gap?: boolean }): Script {
  return ({ handlers }) => {
    handlers.onAck({ ack: ack({ replayCount, ...(gap === undefined ? {} : { gap }) }) });
    for (const seq of seqs) {
      handlers.onEvent({ event: event({ seq }) });
    }
    handlers.onEnd({ error: undefined });
  };
}

/** A round that delivers its replay and then stays open, so the quiet timer ends it. */
function goesQuiet({ seqs }: { seqs: readonly number[] }): Script {
  return ({ handlers }) => {
    handlers.onAck({ ack: ack({ replayCount: seqs.length }) });
    for (const seq of seqs) {
      handlers.onEvent({ event: event({ seq }) });
    }
  };
}

describe("drainResuming", () => {
  it("resumes after the highest seq it folded when cmux hangs up mid-replay, and reports every event", async () => {
    const opener = scriptedOpener({
      scripts: [hangsUp({ gap: true, replayCount: 5, seqs: [110, 150] }), goesQuiet({ seqs: [170, 190, 230] })],
    });
    const drained = await drainResuming({
      afterSeq: 50,
      deadlineMs: NEVER_MS,
      maxRounds: 20,
      names: ["agent.hook.PreToolUse"],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(opener.resumedFrom()).toEqual([50, 150]);
    expect(drained).toEqual({
      answered: true,
      events: [110, 150, 170, 190, 230].map((seq) => event({ seq })),
      gap: true,
      highestSeq: 230,
      kind: "drained",
      rounds: 2,
      truncated: false,
    });
  });

  it("ends with a report, not silence, when cmux hangs up having delivered nothing", async () => {
    const opener = scriptedOpener({ scripts: [hangsUp({ replayCount: 1400, seqs: [] })] });
    const drained = await drainResuming({
      afterSeq: 50,
      deadlineMs: NEVER_MS,
      maxRounds: 20,
      names: [],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(opener.resumedFrom()).toEqual([50]);
    expect(drained).toEqual({
      answered: true,
      events: [],
      gap: false,
      highestSeq: 50,
      kind: "drained",
      rounds: 1,
      truncated: true,
    });
  });

  it("stops at its round cap, saying the batch is truncated", async () => {
    const opener = scriptedOpener({
      scripts: [hangsUp({ replayCount: 9, seqs: [101] }), hangsUp({ replayCount: 8, seqs: [102] })],
    });
    const drained = await drainResuming({
      afterSeq: 100,
      deadlineMs: NEVER_MS,
      maxRounds: 2,
      names: [],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(opener.resumedFrom()).toEqual([100, 101]);
    expect(drained).toEqual({
      answered: true,
      events: [event({ seq: 101 }), event({ seq: 102 })],
      gap: false,
      highestSeq: 102,
      kind: "drained",
      rounds: 2,
      truncated: true,
    });
  });

  it("calls a hang-up after the whole promised replay complete, without resubscribing", async () => {
    const opener = scriptedOpener({ scripts: [hangsUp({ replayCount: 2, seqs: [300, 310] })] });
    const drained = await drainResuming({
      afterSeq: 200,
      deadlineMs: NEVER_MS,
      maxRounds: 20,
      names: [],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(opener.resumedFrom()).toEqual([200]);
    expect(drained).toEqual({
      answered: true,
      events: [event({ seq: 300 }), event({ seq: 310 })],
      gap: false,
      highestSeq: 310,
      kind: "drained",
      rounds: 1,
      truncated: false,
    });
  });

  it("reports an unanswered drain when cmux hangs up before acking, with its cursor at zero", async () => {
    const opener = scriptedOpener({ scripts: [({ handlers }) => handlers.onEnd({ error: undefined })] });
    const drained = await drainResuming({
      afterSeq: undefined,
      deadlineMs: NEVER_MS,
      maxRounds: 20,
      names: [],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(drained).toEqual({
      answered: false,
      events: [],
      gap: false,
      highestSeq: 0,
      kind: "drained",
      rounds: 1,
      truncated: false,
    });
  });

  it("hands back the socket's typed failure instead of a report", async () => {
    const failure = CmuxErrors.socketUnavailable({ detail: "connection reset", socketPath: "/tmp/cmux.sock" });
    const opener = scriptedOpener({ scripts: [({ handlers }) => handlers.onEnd({ error: failure })] });
    const drained = await drainResuming({
      afterSeq: 50,
      deadlineMs: NEVER_MS,
      maxRounds: 20,
      names: [],
      openStream: opener.open,
      quietMs: 0,
    });

    expect(drained).toEqual({ error: failure, kind: "failed" });
  });

  it("ends a round on the drain's deadline, however busy the stream stays", async () => {
    const opener = scriptedOpener({
      scripts: [({ handlers }) => handlers.onAck({ ack: ack({ replayCount: 0 }) })],
    });
    const drained = await drainResuming({
      afterSeq: 50,
      deadlineMs: 0,
      maxRounds: 20,
      names: [],
      nowMs: () => 1_000,
      openStream: opener.open,
      quietMs: NEVER_MS,
    });

    expect(drained).toEqual({
      answered: true,
      events: [],
      gap: false,
      highestSeq: 50,
      kind: "drained",
      rounds: 1,
      truncated: false,
    });
  });
});

describe("nextDrainStep", () => {
  const closed = ({ replayCount, events }: { replayCount: number; events: number }): DrainRound => ({
    ack: ack({ replayCount }),
    end: "closed",
    events: Array.from({ length: events }, (_, index) => event({ seq: 200 + index })),
    kind: "round",
  });

  it("resubscribes only after a close short of its replay that still made progress", () => {
    expect(nextDrainStep({ maxRounds: 3, round: closed({ events: 2, replayCount: 9 }), rounds: 1 })).toEqual({
      step: "resubscribe",
    });
  });

  it("stops truncated on a close that made no progress or spent the last round", () => {
    expect(nextDrainStep({ maxRounds: 3, round: closed({ events: 0, replayCount: 9 }), rounds: 1 })).toEqual({
      step: "stop",
      truncated: true,
    });
    expect(nextDrainStep({ maxRounds: 3, round: closed({ events: 2, replayCount: 9 }), rounds: 3 })).toEqual({
      step: "stop",
      truncated: true,
    });
  });

  it("stops complete on a quiet window, the deadline, or a close after the whole replay", () => {
    const quiet: DrainRound = { ...closed({ events: 0, replayCount: 9 }), end: "quiet" };
    const deadline: DrainRound = { ...closed({ events: 0, replayCount: 9 }), end: "deadline" };
    expect(nextDrainStep({ maxRounds: 3, round: quiet, rounds: 1 })).toEqual({ step: "stop", truncated: false });
    expect(nextDrainStep({ maxRounds: 3, round: deadline, rounds: 1 })).toEqual({ step: "stop", truncated: false });
    expect(nextDrainStep({ maxRounds: 3, round: closed({ events: 9, replayCount: 9 }), rounds: 1 })).toEqual({
      step: "stop",
      truncated: false,
    });
  });
});
