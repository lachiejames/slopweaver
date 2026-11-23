/*
 * The word a plan call owes the owner when the Codex turn the voice said it was on hands it nothing, or fails, so the
 * owner is never left waiting for a result that is not coming. Whether a line is owed, and when it goes, over a fake clock and a plain injected call; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { PLAN_CALL_LIMITS, type PlanCallEvent } from "../../lib/planCallContract";
import type { PlanFloor } from "../../lib/talkPlanFloor";
import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import type { CallClock } from "../../lib/talkPlanStart";
import { OUTCOME_STALE_MS, PROMISE_AFTER_END_MS, TurnOutcomes } from "../../lib/talkPlanTurnOutcome";
import { EMPTY_TURN_OUTCOME_SPEECH, FAILED_TURN_OUTCOME_SPEECH } from "../../lib/talkPlanWords";
import { spokenClaimsOf } from "../../lib/talkSpokenClaims";
import { voicePromised } from "../../lib/voiceOwed";

/** A clock whose time moves only when the test says. */
function fakeClock(): CallClock & { advance: (input: { ms: number }) => void } {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    advance: ({ ms }) => {
      const until = now + ms;
      while (now < until) {
        now = Math.min(until, now + 50);
        for (const timer of timers.filter((t) => t.live && t.at <= now)) {
          timer.live = false;
          timer.run();
        }
      }
    },
    after: ({ ms, run }) => {
      const timer = { at: now + ms, live: true, run };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    nowMs: () => now,
  };
}

/** Let every queued answer land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
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

/** The voice's promise of work, as `voicePromised` reads one. */
const PROMISE = "Okay, let me pull those Slack messages up for you.";

/**
 * One call's outcome lines over a fake clock, a floor the test sets and a write that records each sentence.
 *
 * @param replies how the session answers each write in turn, taking it once they run out
 * @returns the outcomes, the clock, what was spoken, the stream and the floor the test moves
 */
function opened({ replies = [] }: { replies?: RpcOutcome[] } = {}): {
  outcomes: TurnOutcomes;
  clock: ReturnType<typeof fakeClock>;
  spoken: string[];
  events: PlanCallEvent[];
  state: { floor: Partial<PlanFloor>; correctionOwed: boolean };
} {
  const clock = fakeClock();
  const spoken: string[] = [];
  const events: PlanCallEvent[] = [];
  const state: { floor: Partial<PlanFloor>; correctionOwed: boolean } = { correctionOwed: false, floor: {} };
  const outcomes = new TurnOutcomes({
    call: {
      correctionOwed: () => state.correctionOwed,
      emit: ({ event }) => {
        events.push(event);
      },
      floor: () => ({ ...CLEAR, nowMs: clock.nowMs(), ...state.floor }),
      speak: ({ text }) => {
        spoken.push(text);
        const reply = replies.shift();
        if (reply === undefined) {
          return Promise.resolve({ kind: "result", result: {} });
        }
        return Promise.resolve(reply);
      },
    },
    clock,
  });
  return { clock, events, outcomes, spoken, state };
}

const POLL = PLAN_CALL_LIMITS.rolloverPollMs;

/**
 * Move the clock in polls, letting each write land.
 *
 * @param clock the call's clock
 * @param polls how many looks at the floor to pass
 */
async function pass({ clock, polls }: { clock: ReturnType<typeof fakeClock>; polls: number }): Promise<void> {
  for (let i = 0; i < polls; i += 1) {
    clock.advance({ ms: POLL });
    await settle();
  }
}

describe("the turn-outcome sentences", () => {
  it("claim no act done, and promise no further work", () => {
    const lines = [EMPTY_TURN_OUTCOME_SPEECH, FAILED_TURN_OUTCOME_SPEECH];
    expect(lines.map((text) => spokenClaimsOf({ text }))).toEqual([[], []]);
    expect(lines.map((text) => voicePromised({ text }))).toEqual([false, false]);
  });

  it("read the promise the tests here use as one", () => {
    expect(voicePromised({ text: PROMISE })).toBe(true);
  });
});

describe("TurnOutcomes", () => {
  // A turn acknowledged, with two blank messages, completed — and nothing said after.
  it("says once that an acknowledged turn which handed the voice nothing came back with no answer", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "01a1973d" });
    outcomes.acknowledgementTaken({ turnId: "01a1973d" });
    outcomes.turnEnded({ end: "completed", turnId: "01a1973d" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
    expect(events).toEqual([
      { detail: "said it came back with no answer", kind: "turn-outcome", phase: "said", turnId: "01a1973d" },
    ]);
  });

  it("owes the line when the acknowledgement lands after the turn already completed", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([]);
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
  });

  it("says nothing for a turn that wrote nothing while nobody told the owner it was on it", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([]);
  });

  it("never owes the line for a turn whose answer was handed, before or after its end", async () => {
    const before = opened();
    before.outcomes.turnStarted({ turnId: "t-1" });
    before.outcomes.acknowledgementTaken({ turnId: "t-1" });
    before.outcomes.handed({ answered: ["t-1"], commented: [] });
    before.outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock: before.clock, polls: 8 });
    expect(before.spoken).toEqual([]);
    expect(before.events).toEqual([]);

    // Ended, and its held answer released before the floor freed — the ordinary turn: nothing was owed, nothing traced.
    const after = opened();
    after.state.floor = { heldAnswers: 1 };
    after.outcomes.turnStarted({ turnId: "t-1" });
    after.outcomes.acknowledgementTaken({ turnId: "t-1" });
    after.outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock: after.clock, polls: 2 });
    after.outcomes.handed({ answered: ["t-1"], commented: [] });
    after.state.floor = {};
    await pass({ clock: after.clock, polls: 8 });
    expect(after.spoken).toEqual([]);
    expect(after.events).toEqual([]);
  });

  it("reads another turn's answer handed as nothing of the newest's", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-2" });
    outcomes.acknowledgementTaken({ turnId: "t-2" });
    outcomes.handed({ answered: ["t-1"], commented: [] });
    outcomes.turnEnded({ end: "completed", turnId: "t-2" });
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
  });

  it("reads the turn's commentary handed as telling the owner it was on it, never as answering", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.handed({ answered: [], commented: ["t-1"] });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
  });

  it("says a failed turn failed in the fixed words, told or not, and never the provider's", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([FAILED_TURN_OUTCOME_SPEECH]);
    expect(events).toEqual([{ detail: "said it failed", kind: "turn-outcome", phase: "said", turnId: "t-1" }]);
  });

  it("says nothing for a failed turn that had already answered", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.handed({ answered: ["t-1"], commented: [] });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 4 });
    expect(spoken).toEqual([]);
  });

  it("says nothing for an interrupted turn, told or not", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "interrupted", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([]);
  });

  it("drops an older turn's owed line once a newer turn starts, and reads that newer one alone", async () => {
    const { clock, events, outcomes, spoken, state } = opened();
    state.floor = { heardUtteranceOpen: true };
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 2 });
    outcomes.turnStarted({ turnId: "t-2" });
    state.floor = {};
    // The older turn's end, replayed, reads nothing now.
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([
      {
        detail: "turn t-2 started after it, and its answer is the one owed",
        kind: "turn-outcome",
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
  });

  it("never says a line twice on a replayed start or end of the same turn", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 2 });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
  });

  it("says nothing once the call stopped, and records the owed line dropped, once", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    outcomes.stop();
    outcomes.stop();
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([
      { detail: "the call ended before the floor was free", kind: "turn-outcome", phase: "dropped", turnId: "t-1" },
    ]);
  });

  it("records nothing when the call stops with no line owed", async () => {
    const { clock, events, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "interrupted", turnId: "t-1" });
    outcomes.stop();
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([]);
  });

  it("waits for a clear floor, and says busy while its own write is unanswered", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const clock = fakeClock();
    const spoken: string[] = [];
    const state: { floor: Partial<PlanFloor> } = { floor: { heardUtteranceOpen: true } };
    const outcomes = new TurnOutcomes({
      call: {
        correctionOwed: () => false,
        emit: () => undefined,
        floor: () => ({ ...CLEAR, nowMs: clock.nowMs(), ...state.floor }),
        speak: ({ text }) => {
          spoken.push(text);
          return new Promise<RpcOutcome>((resolve) => {
            landings.push(resolve);
          });
        },
      },
      clock,
    });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    state.floor = {};
    await pass({ clock, polls: 1 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
    expect(outcomes.busy).toBe(true);
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(outcomes.busy).toBe(false);
  });

  // The stream closes on `closed`, so an in-flight line is recorded at stop.
  it("records a line whose write is unanswered when the call stops, before the stream closes, once", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const clock = fakeClock();
    const spoken: string[] = [];
    const events: PlanCallEvent[] = [];
    const outcomes = new TurnOutcomes({
      call: {
        correctionOwed: () => false,
        emit: ({ event }) => {
          events.push(event);
        },
        floor: () => ({ ...CLEAR, nowMs: clock.nowMs() }),
        speak: ({ text }) => {
          spoken.push(text);
          return new Promise<RpcOutcome>((resolve) => {
            landings.push(resolve);
          });
        },
      },
      clock,
    });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([FAILED_TURN_OUTCOME_SPEECH]);
    outcomes.stop();
    const atStop = [...events];
    landings.shift()!({ kind: "ended", reason: "the owner hung up" });
    await settle();
    expect(atStop).toEqual([
      {
        detail: "the call ended before the voice answered the line's write; it may have been said",
        kind: "turn-outcome",
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
    expect(events).toEqual(atStop);
    expect(outcomes.busy).toBe(false);
  });

  // A write that throws is a refusal, never a line silently lost.
  it("tries a write that throws or rejects again, then records it dropped with the throw's message", async () => {
    const clock = fakeClock();
    const events: PlanCallEvent[] = [];
    let writes = 0;
    const outcomes = new TurnOutcomes({
      call: {
        correctionOwed: () => false,
        emit: ({ event }) => {
          events.push(event);
        },
        floor: () => ({ ...CLEAR, nowMs: clock.nowMs() }),
        // Rejects, throws synchronously, rejects: both shapes of a write that never answers.
        speak: () => {
          writes += 1;
          if (writes === 2) {
            throw new Error("write EPIPE");
          }
          return Promise.reject(new Error("write EPIPE"));
        },
      },
      clock,
    });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 12 });
    expect(writes).toBe(3);
    expect(events).toEqual([
      {
        detail: "the voice would not take the line: write EPIPE",
        kind: "turn-outcome",
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
    expect(outcomes.busy).toBe(false);
  });

  // A sent write is never recalled, so a newer start mid-write finds the line said, once.
  it("records a line said when a newer turn starts while its write is unanswered, and owes the newer one afresh", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const clock = fakeClock();
    const spoken: string[] = [];
    const events: PlanCallEvent[] = [];
    const outcomes = new TurnOutcomes({
      call: {
        correctionOwed: () => false,
        emit: ({ event }) => {
          events.push(event);
        },
        floor: () => ({ ...CLEAR, nowMs: clock.nowMs() }),
        speak: ({ text }) => {
          spoken.push(text);
          return new Promise<RpcOutcome>((resolve) => {
            landings.push(resolve);
          });
        },
      },
      clock,
    });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 1 });
    outcomes.turnStarted({ turnId: "t-2" });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    outcomes.turnEnded({ end: "failed", turnId: "t-2" });
    await pass({ clock, polls: 2 });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH, FAILED_TURN_OUTCOME_SPEECH]);
    expect(events).toEqual([
      { detail: "said it came back with no answer", kind: "turn-outcome", phase: "said", turnId: "t-1" },
      { detail: "said it failed", kind: "turn-outcome", phase: "said", turnId: "t-2" },
    ]);
  });

  it("tries a line refused outright again, three writes in all, then gives it up saying so", async () => {
    const busy: RpcOutcome = { kind: "error", message: "busy" };
    const { clock, events, outcomes, spoken } = opened({ replies: [busy, busy, busy, busy] });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 12 });
    expect(spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH, EMPTY_TURN_OUTCOME_SPEECH, EMPTY_TURN_OUTCOME_SPEECH]);
    expect(events).toEqual([
      { detail: "the voice would not take the line: busy", kind: "turn-outcome", phase: "dropped", turnId: "t-1" },
    ]);
  });

  it("never tries again a line that timed out, since the voice may still say it", async () => {
    const { clock, events, outcomes, spoken } = opened({ replies: [{ kind: "timeout" }] });
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 12 });
    expect(spoken).toEqual([FAILED_TURN_OUTCOME_SPEECH]);
    expect(events).toEqual([
      {
        detail: "may have said it failed, and it is not tried again so it is never said twice: no answer in time",
        kind: "turn-outcome",
        phase: "said",
        turnId: "t-1",
      },
    ]);
  });

  // The voice's "I'm following that and checking …" can close 2.74s after a turn completes.
  it("counts the voice's own promise while the turn runs or just after its end, and not later", async () => {
    const during = opened();
    during.outcomes.turnStarted({ turnId: "t-1" });
    during.outcomes.voiceSaid({ params: { role: "assistant", text: PROMISE } });
    during.outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock: during.clock, polls: 2 });
    expect(during.spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);

    const justAfter = opened();
    justAfter.outcomes.turnStarted({ turnId: "t-1" });
    justAfter.outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    justAfter.clock.advance({ ms: PROMISE_AFTER_END_MS });
    justAfter.outcomes.voiceSaid({ params: { role: "assistant", text: PROMISE } });
    await pass({ clock: justAfter.clock, polls: 2 });
    expect(justAfter.spoken).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);

    const late = opened();
    late.outcomes.turnStarted({ turnId: "t-1" });
    late.outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    late.clock.advance({ ms: PROMISE_AFTER_END_MS + 50 });
    late.outcomes.voiceSaid({ params: { role: "assistant", text: PROMISE } });
    await pass({ clock: late.clock, polls: 2 });
    expect(late.spoken).toEqual([]);
  });

  it("reads a sentence of the voice's that promises nothing as nothing", async () => {
    const { clock, outcomes, spoken } = opened();
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.voiceSaid({ params: { role: "assistant", text: "Mm-hmm." } });
    outcomes.voiceSaid({ params: { role: "assistant" } });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: 4 });
    expect(spoken).toEqual([]);
  });

  // An outcome write in flight must not hold an owed correction past its stale cutoff.
  it("waits behind an owed correction of the voice's own line, then says its line once that clears", async () => {
    const { clock, outcomes, spoken, state } = opened();
    state.correctionOwed = true;
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.turnEnded({ end: "failed", turnId: "t-1" });
    await pass({ clock, polls: 8 });
    expect(spoken).toEqual([]);
    state.correctionOwed = false;
    await pass({ clock, polls: 2 });
    expect(spoken).toEqual([FAILED_TURN_OUTCOME_SPEECH]);
  });

  it("drops a line the floor never freed for within the stale window, saying so", async () => {
    const { clock, events, outcomes, spoken, state } = opened();
    state.floor = { heardUtteranceOpen: true };
    outcomes.turnStarted({ turnId: "t-1" });
    outcomes.acknowledgementTaken({ turnId: "t-1" });
    outcomes.turnEnded({ end: "completed", turnId: "t-1" });
    await pass({ clock, polls: OUTCOME_STALE_MS / POLL + 2 });
    state.floor = {};
    await pass({ clock, polls: 4 });
    expect(spoken).toEqual([]);
    expect(events).toEqual([
      {
        detail: "the floor was not free within 20s of the turn's end",
        kind: "turn-outcome",
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
  });
});
