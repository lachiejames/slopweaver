/*
 * The voice's correction of its own done claim (a post claimed done when nothing was posted and the voice was never
 * told) and of fleet work it promised as its own. The fixed sentence, then when it goes, over a fake clock and a
 * plain injected call; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import { CORRECTION_ECHO_MS, CORRECTION_STALE_MS, CompletionCorrection } from "../../lib/talkPlanCompletionCorrection";
import type { PlanFloor } from "../../lib/talkPlanFloor";
import type { CallClock } from "../../lib/talkPlanStart";
import { claimCorrectionSpeech } from "../../lib/talkPlanWords";
import { spokenClaimsOf } from "../../lib/talkSpokenClaims";

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

/**
 * One call's corrections over a fake clock, a floor the test sets and a write that records each sentence.
 *
 * @returns the corrections, the clock, what was spoken, and the floor and ending the test moves
 */
function opened(): {
  corrections: CompletionCorrection;
  clock: ReturnType<typeof fakeClock>;
  spoken: string[];
  state: { floor: Partial<PlanFloor>; ended: boolean; noticing: boolean; answer: Promise<void> };
} {
  const clock = fakeClock();
  const spoken: string[] = [];
  const state: { floor: Partial<PlanFloor>; ended: boolean; noticing: boolean; answer: Promise<void> } = {
    answer: Promise.resolve(),
    ended: false,
    floor: {},
    noticing: false,
  };
  const corrections = new CompletionCorrection({
    call: {
      ended: () => state.ended,
      floor: () => ({ ...CLEAR, nowMs: clock.nowMs(), ...state.floor }),
      noticing: () => state.noticing,
      speak: async ({ text }) => {
        spoken.push(text);
        await state.answer;
      },
    },
    clock,
  });
  return { clock, corrections, spoken, state };
}

const POLL = PLAN_CALL_LIMITS.rolloverPollMs;

describe("claimCorrectionSpeech", () => {
  it("negates the act claimed, says two different acts as one, and is itself no done claim", () => {
    const lines = [
      claimCorrectionSpeech({ claims: [{ act: "posted", kind: "outcome" }] }),
      claimCorrectionSpeech({
        claims: [
          { act: "went up", kind: "outcome" },
          { act: "went up", kind: "outcome" },
        ],
      }),
      claimCorrectionSpeech({
        claims: [
          { act: "sent", kind: "outcome" },
          { act: "merged", kind: "outcome" },
        ],
      }),
    ];
    expect(lines).toEqual([
      "Correction: nothing on record shows anything was posted.",
      "Correction: nothing on record shows anything went up.",
      "Correction: nothing on record shows anything was done.",
    ]);
    expect(lines.map((text) => spokenClaimsOf({ text }))).toEqual([[], [], []]);
  });

  it("names the fleet for a fleet promise, once however many, and is itself no claim", () => {
    const lines = [
      claimCorrectionSpeech({ claims: [{ kind: "fleet-promise" }] }),
      claimCorrectionSpeech({ claims: [{ kind: "fleet-promise" }, { kind: "fleet-promise" }] }),
    ];
    expect(lines).toEqual([
      "Correction: that is fleet work; the fleet will do it, not me.",
      "Correction: that is fleet work; the fleet will do it, not me.",
    ]);
    expect(lines.map((text) => spokenClaimsOf({ text }))).toEqual([[], []]);
  });

  it("says a done claim and a fleet promise of one sentence as one two-part correction", () => {
    const line = claimCorrectionSpeech({ claims: [{ kind: "fleet-promise" }, { act: "sent", kind: "outcome" }] });
    expect(line).toBe(
      "Correction: nothing on record shows anything was sent, and that is fleet work; the fleet will do it, not me.",
    );
    expect(spokenClaimsOf({ text: line })).toEqual([]);
  });

  it("says nothing new went on the owner's running list, once however many, and is itself no claim", () => {
    const lines = [
      claimCorrectionSpeech({ claims: [{ kind: "running-list" }] }),
      claimCorrectionSpeech({ claims: [{ kind: "running-list" }, { kind: "running-list" }] }),
    ];
    expect(lines).toEqual([
      "Correction: nothing new went on your running list.",
      "Correction: nothing new went on your running list.",
    ]);
    expect(lines.map((text) => spokenClaimsOf({ text }))).toEqual([[], []]);
  });

  it("joins every shape of one sentence into one correction, and is itself no claim", () => {
    const line = claimCorrectionSpeech({
      claims: [{ kind: "running-list" }, { kind: "fleet-promise" }, { act: "sent", kind: "outcome" }],
    });
    expect(line).toBe(
      "Correction: nothing on record shows anything was sent, and that is fleet work; the fleet will do it, not me, and nothing new went on your running list.",
    );
    expect(spokenClaimsOf({ text: line })).toEqual([]);
  });
});

describe("CompletionCorrection", () => {
  it("says Tuesday's correction once, one poll after the claim was owed", async () => {
    const { clock, corrections, spoken } = opened();
    expect(corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" })).toBe(undefined);
    clock.advance({ ms: POLL - 50 });
    expect(spoken).toEqual([]);
    clock.advance({ ms: 50 });
    await settle();
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect(spoken).toEqual(["Correction: nothing on record shows anything was posted."]);
  });

  it("says the claims of one sentence as one correction", async () => {
    const { clock, corrections, spoken } = opened();
    corrections.owe({ claim: { act: "sent", kind: "outcome" }, key: "v3:0" });
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:9" });
    clock.advance({ ms: POLL });
    await settle();
    expect(spoken).toEqual(["Correction: nothing on record shows anything was done."]);
  });

  it("says a fleet promise's correction once, one poll after it was owed", async () => {
    const { clock, corrections, spoken } = opened();
    expect(corrections.owe({ claim: { kind: "fleet-promise" }, key: "v3:1" })).toBe(undefined);
    clock.advance({ ms: POLL });
    await settle();
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect(spoken).toEqual(["Correction: that is fleet work; the fleet will do it, not me."]);
  });

  it("says a running-list claim's correction once, one poll after it was owed", async () => {
    const { clock, corrections, spoken } = opened();
    expect(corrections.owe({ claim: { kind: "running-list" }, key: "v2:1" })).toBe(undefined);
    clock.advance({ ms: POLL });
    await settle();
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect(spoken).toEqual(["Correction: nothing new went on your running list."]);
  });

  it("owes nothing for a key already owed, nor a claim inside the echo window, and owes again past it", async () => {
    const { clock, corrections, spoken } = opened();
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: POLL });
    await settle();
    const refusals = [
      corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" }),
      corrections.owe({ claim: { act: "sent", kind: "outcome" }, key: "v4:0" }),
    ];
    clock.advance({ ms: CORRECTION_ECHO_MS });
    const late = corrections.owe({ claim: { act: "merged", kind: "outcome" }, key: "v5:0" });
    clock.advance({ ms: POLL });
    await settle();
    expect(refusals).toEqual([
      "that claim is already owed a correction",
      "a correction was handed over moments ago, so this claim is kept and not corrected again",
    ]);
    expect([late, spoken]).toEqual([
      undefined,
      [
        "Correction: nothing on record shows anything was posted.",
        "Correction: nothing on record shows anything was merged.",
      ],
    ]);
  });

  it("waits while the owner is talking or a line of the server's is being handed over, and goes once clear", async () => {
    const { clock, corrections, spoken, state } = opened();
    state.floor = { heardUtteranceOpen: true };
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: POLL * 4 });
    await settle();
    const whileOpen = [...spoken];
    state.floor = { announcingMeeting: true, lastHeardMs: clock.nowMs() };
    clock.advance({ ms: POLL * 4 });
    await settle();
    const whileAnnouncing = [...spoken];
    state.floor = { lastHeardMs: 0 };
    clock.advance({ ms: POLL });
    await settle();
    expect([whileOpen, whileAnnouncing, spoken]).toEqual([
      [],
      [],
      ["Correction: nothing on record shows anything was posted."],
    ]);
  });

  it("waits while a running-list notice is being handed over, which the floor does not carry", async () => {
    const { clock, corrections, spoken, state } = opened();
    state.noticing = true;
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: POLL * 4 });
    await settle();
    const whileNoticing = [...spoken];
    state.noticing = false;
    clock.advance({ ms: POLL });
    await settle();
    expect([whileNoticing, spoken]).toEqual([[], ["Correction: nothing on record shows anything was posted."]]);
  });

  it("goes while a thinking turn runs and while the voice is still speaking: only the owner holds it", async () => {
    const { clock, corrections, spoken, state } = opened();
    state.floor = { lastTranscribedMs: 0, lastVoicedMs: 0, runningTurns: 2 };
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: POLL });
    await settle();
    expect(spoken).toEqual(["Correction: nothing on record shows anything was posted."]);
  });

  it("owes while a correction waits and is not stale, and owes nothing once said or stale", async () => {
    const { clock, corrections, state } = opened();
    expect(corrections.owes).toBe(false);
    state.floor = { heardUtteranceOpen: true };
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    expect(corrections.owes).toBe(true);
    clock.advance({ ms: CORRECTION_STALE_MS });
    expect(corrections.owes).toBe(false);
    state.floor = {};
    corrections.owe({ claim: { act: "merged", kind: "outcome" }, key: "v3:1" });
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect(corrections.owes).toBe(false);
  });

  it("drops a correction unsaid once it is stale", async () => {
    const { clock, corrections, spoken, state } = opened();
    state.floor = { heardUtteranceOpen: true };
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: CORRECTION_STALE_MS });
    state.floor = {};
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect(spoken).toEqual([]);
  });

  it("says nothing owed once the call ended before its try, and owes nothing after", async () => {
    const { clock, corrections, spoken, state } = opened();
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    state.ended = true;
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect([corrections.owe({ claim: { act: "sent", kind: "outcome" }, key: "v4:0" }), spoken]).toEqual([
      "the call has ended",
      [],
    ]);
  });

  it("is busy while its request is unanswered, and never hands the same correction over twice", async () => {
    const { clock, corrections, spoken, state } = opened();
    let answer: () => void = () => undefined;
    state.answer = new Promise((resolve) => {
      answer = resolve;
    });
    corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: "v3:0" });
    clock.advance({ ms: POLL });
    await settle();
    const busy = corrections.busy;
    clock.advance({ ms: POLL * 4 });
    answer();
    await settle();
    clock.advance({ ms: POLL * 4 });
    await settle();
    expect([busy, corrections.busy, spoken]).toEqual([
      true,
      false,
      ["Correction: nothing on record shows anything was posted."],
    ]);
  });
});
