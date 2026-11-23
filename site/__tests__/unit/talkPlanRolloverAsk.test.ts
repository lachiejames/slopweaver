import { describe, expect, it } from "vitest";

import {
  CONTEXT_ROLLOVER_REASON,
  PLAN_CALL_LIMITS,
  type PlanCallEvent,
  ROLLOVER_REASON,
} from "../../lib/planCallContract";
import type { PlanFloor } from "../../lib/talkPlanFloor";
import { PlanRolloverAsk } from "../../lib/talkPlanRolloverAsk";
import type { PlanCallClock } from "../../lib/talkPlanStart";

/**
 * A clock whose time moves only when the test says, firing each timer earliest first, `late.ms` after its own instant:
 * a loaded event loop runs a due callback late, and the clock has moved on by then.
 */
function fakeClock({ startMs }: { startMs: number }): PlanCallClock & {
  advance: (input: { ms: number }) => void;
  late: { ms: number };
} {
  let now = startMs;
  const late = { ms: 0 };
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    advance: ({ ms }) => {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= until).toSorted((a, b) => a.at - b.at)[0];
        if (due === undefined) {
          break;
        }
        due.live = false;
        now = Math.max(now, due.at + late.ms);
        due.run();
      }
      now = Math.max(now, until);
    },
    after: ({ ms, run }) => {
      const timer = { at: now + ms, live: true, run };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    elapsedMs: () => now,
    late,
    nowMs: () => now,
  };
}

/** A floor nothing holds. */
const CLEAR: Omit<PlanFloor, "nowMs"> = {
  acking: false,
  announcing: false,
  announcingMeeting: false,
  announcingWindowNotice: false,
  correctingCompletion: false,
  ended: false,
  endedReason: undefined,
  heardUtteranceOpen: false,
  heldAnswers: 0,
  lastAckMs: undefined,
  lastHeardMs: undefined,
  lastLookMs: undefined,
  lastNudgeMs: undefined,
  lastOwnLineMs: undefined,
  lastResumeMs: undefined,
  lastTranscribedMs: undefined,
  lastTurnEndedMs: undefined,
  lastVoicedMs: undefined,
  looking: false,
  nudging: false,
  pendingTools: 0,
  reportingTurnOutcome: false,
  resuming: false,
  runningTurns: 0,
  threadId: "t1",
  typingIn: false,
  waitingRequests: 0,
};

const MADE_MS = 1_800_000_000_000;
const { lifetimeMs, rolloverFromMs, rolloverLastMs, rolloverPollMs, rolloverUrgentMs } = PLAN_CALL_LIMITS;

/**
 * One call's rollover ask over a fake clock, armed as `PlanCall` arms it, with a floor and an ending the test moves.
 *
 * @param staged whether the call is ever told to roll over, as a voice call is; a typed conversation's is `false`
 * @returns the ask, its clock, each event emitted with the instant it went out, what a reconnecting stream would
 *   replay in each one's place, and the state the test moves
 */
function opened({ staged = true }: { staged?: boolean } = {}): {
  ask: PlanRolloverAsk;
  clock: ReturnType<typeof fakeClock>;
  emitted: { atMs: number; event: PlanCallEvent }[];
  replays: (() => PlanCallEvent)[];
  state: { floor: Partial<PlanFloor>; ended: boolean };
} {
  const clock = fakeClock({ startMs: MADE_MS });
  const emitted: { atMs: number; event: PlanCallEvent }[] = [];
  const replays: (() => PlanCallEvent)[] = [];
  const state: { floor: Partial<PlanFloor>; ended: boolean } = { ended: false, floor: {} };
  const ask = new PlanRolloverAsk({
    call: {
      emit: ({ event, replayAs }) => {
        emitted.push({ atMs: clock.nowMs(), event });
        replays.push(replayAs);
      },
      ended: () => state.ended,
      floor: () => ({ ...CLEAR, nowMs: clock.nowMs(), ...state.floor }),
    },
    clock,
    staged,
  });
  ask.arm({ ms: rolloverFromMs });
  return { ask, clock, emitted, replays, state };
}

/** The ask sent for `reason`, naming `leftMs` of the lifetime, `null` while the cut is far, context-urgent or not. */
function askFor({
  reason,
  leftMs,
  contextUrgent = false,
}: {
  reason: string;
  leftMs: number | null;
  contextUrgent?: boolean;
}): PlanCallEvent {
  return { contextUrgent, kind: "rollover", lifetimeRemainingMs: leftMs, reason };
}

/**
 * The asks sent as the urgent and last windows open, each `lateMs` after its own instant.
 *
 * @param lateMs how late a loaded loop ran each callback
 */
function stageAsks({ lateMs }: { lateMs: number }): { atMs: number; event: PlanCallEvent }[] {
  return [rolloverUrgentMs, rolloverLastMs].map((leftMs) => ({
    atMs: MADE_MS + lifetimeMs - leftMs + lateMs,
    event: askFor({ leftMs: leftMs - lateMs, reason: ROLLOVER_REASON }),
  }));
}

describe("PlanRolloverAsk", () => {
  it("asks once, at the first look the floor is free, carrying the lifetime's deadline", () => {
    const { ask, clock, emitted, state } = opened();
    state.floor = { runningTurns: 1 };
    clock.advance({ ms: rolloverFromMs + 3 * rolloverPollMs });
    const heldWhileBusy = emitted.length;
    state.floor = {};
    clock.advance({ ms: 10 * rolloverPollMs });
    expect([heldWhileBusy, emitted, ask.told]).toEqual([
      0,
      [
        {
          atMs: MADE_MS + rolloverFromMs + 4 * rolloverPollMs,
          event: askFor({ leftMs: null, reason: ROLLOVER_REASON }),
        },
      ],
      true,
    ]);
  });

  // The floor's holds must not renew one another until the lifetime cuts it mid-word.
  it("asks whatever the floor holds as the urgent and last windows open, naming the time left at each", () => {
    const { clock, emitted, state } = opened();
    state.floor = { heardUtteranceOpen: true, runningTurns: 1 };
    clock.advance({ ms: lifetimeMs });
    expect(emitted).toEqual(stageAsks({ lateMs: 0 }));
  });

  // The time left comes off the elapsed clock, never a wall-clock instant.
  it("asks again with the time left at each stage on an ask the page already holds", () => {
    const { clock, emitted } = opened();
    clock.advance({ ms: lifetimeMs });
    expect(emitted).toEqual([
      { atMs: MADE_MS + rolloverFromMs, event: askFor({ leftMs: null, reason: ROLLOVER_REASON }) },
      ...stageAsks({ lateMs: 0 }),
    ]);
  });

  // A fixed window would overstate the time left by however late the callback ran.
  it("measures the time left when a stage's callback runs late on a loaded loop", () => {
    const { clock, emitted, state } = opened();
    state.floor = { runningTurns: 1 };
    clock.late.ms = 25_000;
    clock.advance({ ms: lifetimeMs });
    expect(emitted).toEqual(stageAsks({ lateMs: 25_000 }));
  });

  // A last-stage ask replayed as sent, 10s late, put the page's count 10s behind the cut.
  it("replays each ask to a reconnecting stream with the time left as it replays, never as it was sent", () => {
    const { clock, replays } = opened();
    clock.advance({ ms: rolloverFromMs });
    const calmReplays = replays.map((replay) => replay());
    clock.advance({ ms: lifetimeMs - rolloverLastMs + 10_000 - rolloverFromMs });
    expect(calmReplays).toEqual([askFor({ leftMs: null, reason: ROLLOVER_REASON })]);
    expect(replays.map((replay) => replay())).toEqual([
      askFor({ leftMs: rolloverLastMs - 10_000, reason: ROLLOVER_REASON }),
      askFor({ leftMs: rolloverLastMs - 10_000, reason: ROLLOVER_REASON }),
      askFor({ leftMs: rolloverLastMs - 10_000, reason: ROLLOVER_REASON }),
    ]);
  });

  it("owes the ask for the thread's context once it nears full, sooner than the call's age", () => {
    const { ask, clock, emitted } = opened();
    clock.advance({ ms: 60_000 });
    ask.contextDue();
    ask.arm({ ms: 0 });
    clock.advance({ ms: rolloverFromMs });
    expect(emitted).toEqual([
      { atMs: MADE_MS + 60_000, event: askFor({ leftMs: null, reason: CONTEXT_ROLLOVER_REASON }) },
    ]);
  });

  // Measured: the calm context ask was held nine minutes until Codex compacted the thread.
  it("asks again at once, context-urgent, on an ask the page already holds, and only once", () => {
    const { ask, clock, emitted, replays } = opened();
    ask.contextDue();
    ask.arm({ ms: 0 });
    clock.advance({ ms: 60_000 });
    ask.contextUrgent();
    ask.contextUrgent();
    const urgent = askFor({ contextUrgent: true, leftMs: null, reason: CONTEXT_ROLLOVER_REASON });
    expect([emitted, replays.map((replay) => replay())]).toEqual([
      [
        { atMs: MADE_MS, event: askFor({ leftMs: null, reason: CONTEXT_ROLLOVER_REASON }) },
        { atMs: MADE_MS + 60_000, event: urgent },
      ],
      [urgent, urgent],
    ]);
  });

  it("asks context-urgent at once whatever the floor holds, and carries it into the lifetime's later asks", () => {
    const { ask, clock, emitted, state } = opened();
    state.floor = { heardUtteranceOpen: true, runningTurns: 1 };
    ask.contextUrgent();
    clock.advance({ ms: lifetimeMs });
    expect(emitted).toEqual([
      { atMs: MADE_MS, event: askFor({ contextUrgent: true, leftMs: null, reason: CONTEXT_ROLLOVER_REASON }) },
      ...stageAsks({ lateMs: 0 }).map(({ atMs, event }) => ({
        atMs,
        event: { ...event, contextUrgent: true, reason: CONTEXT_ROLLOVER_REASON },
      })),
    ]);
  });

  it("asks nothing context-urgent on a conversation never told to roll over, nor on a call that ended", () => {
    const typed = opened({ staged: false });
    typed.ask.contextUrgent();
    const ended = opened();
    ended.state.ended = true;
    ended.ask.contextUrgent();
    expect([typed.emitted, typed.ask.told, ended.emitted, ended.ask.told]).toEqual([[], false, [], false]);
  });

  it("asks nothing once stopped, the urgent window included", () => {
    const { ask, clock, emitted, state } = opened();
    state.floor = { runningTurns: 1 };
    clock.advance({ ms: rolloverFromMs + rolloverPollMs });
    ask.stop();
    clock.advance({ ms: lifetimeMs });
    expect([emitted, ask.told]).toEqual([[], false]);
  });

  it("asks nothing on a call that ended, and arms no further look", () => {
    const { ask, clock, emitted, state } = opened();
    state.ended = true;
    clock.advance({ ms: lifetimeMs });
    ask.arm({ ms: 0 });
    clock.advance({ ms: rolloverPollMs });
    expect([emitted, ask.told]).toEqual([[], false]);
  });
});
