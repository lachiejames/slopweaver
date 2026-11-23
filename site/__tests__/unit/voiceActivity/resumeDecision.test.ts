import { describe, expect, it } from "vitest";

import {
  foldActivity,
  HEARING_LEVEL,
  HEARING_RMS,
  RESUME_MS,
  resumeDecisionOf,
  resumeDueOf,
  type VoiceActivity,
} from "../../../lib/voiceActivity";
import { delegated, play } from "./harness";
import { STEER, sounded, steered } from "./resumeHarness";

/** The decision at one instant, the owner's microphone silent and live. */
const decisionAt = ({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }) =>
  resumeDecisionOf({ activity, micLevel: 0, micRms: 0, muted: false, nowMs });

// `steered`: the voice spoke at 1s, the owner spoke a steer at 2s.
const quietNow = 2_000 + RESUME_MS;

describe("resumeDecisionOf", () => {
  it("is due exactly when resumeDueOf is, and names no gate then", () => {
    expect([
      decisionAt({ activity: steered, nowMs: quietNow }),
      resumeDueOf({ activity: steered, micLevel: 0, micRms: 0, muted: false, nowMs: quietNow }),
    ]).toEqual([{ kind: "due" }, true]);
  });

  it("names the quiet not yet reached, and nothing heard at all", () => {
    expect([
      decisionAt({ activity: steered, nowMs: quietNow - 1 }),
      decisionAt({ activity: play({ script: [] }), nowMs: quietNow }),
    ]).toEqual([
      { blocker: "answered-or-not-quiet", kind: "held" },
      { blocker: "nothing-heard", kind: "held" },
    ]);
  });

  it("names the owner's microphone when it reads them talking", () => {
    expect(
      resumeDecisionOf({
        activity: steered,
        micLevel: HEARING_LEVEL,
        micRms: HEARING_RMS,
        muted: false,
        nowMs: quietNow,
      }),
    ).toEqual({ blocker: "microphone-audible", kind: "held" });
  });

  // The voice's audio is still playing as the owner's next line's first fragment lands.
  it("names the voice's output heard after the owner's words", () => {
    const voiceAfter = sounded({ activity: steered, micLevel: 0, micRms: 0, nowMs: 2_500, outputLevel: 0.5 });
    expect(decisionAt({ activity: voiceAfter, nowMs: quietNow + 10_000 })).toEqual({
      blocker: "voice-after-owner-words",
      kind: "held",
    });
  });

  // The voice's whole turn was ".", which folds as finished but never as spoken.
  it("names the turn the voice owes after a final that carried no words", () => {
    const dotted = foldActivity({
      activity: steered,
      input: { asked: false, kind: "voice-finished", promised: false },
      nowMs: 3_000,
    });
    expect(decisionAt({ activity: dotted, nowMs: 3_000 + RESUME_MS })).toEqual({
      blocker: "voice-owes-turn",
      kind: "held",
    });
  });

  it("names a pending tool apart from other work in flight", () => {
    const tool = foldActivity({
      activity: steered,
      input: { callId: "c1", kind: "tool-started", name: "read_card" },
      nowMs: 2_500,
    });
    const working = foldActivity({ activity: steered, input: delegated({ id: "d1" }), nowMs: 2_500 });
    expect([
      decisionAt({ activity: tool, nowMs: quietNow }),
      decisionAt({ activity: working, nowMs: quietNow }),
    ]).toEqual([
      { blocker: "tool-pending", kind: "held" },
      { blocker: "work-in-flight", kind: "held" },
    ]);
  });

  // A turn started on the owner's steer, the voice said "Checking, one sec.", their next words went quiet unclosed,
  // and `work-in-flight` held the resume until "Uh, hello" 40s later; it must not hold it for a turn that began
  // before those words.
  it("is due over a Codex turn that began before the owner's latest words, and held by one that began after them", () => {
    const turnFirst = play({
      script: [
        [500, { kind: "codex-turn", phase: "started", turnId: "before" }],
        [1_000, { kind: "spoke" }],
        [2_000, { kind: "heard", text: STEER }],
      ],
    });
    const turnAfter = foldActivity({
      activity: steered,
      input: { kind: "codex-turn", phase: "started", turnId: "after" },
      nowMs: 2_500,
    });
    expect([
      decisionAt({ activity: turnFirst, nowMs: quietNow }),
      decisionAt({ activity: turnAfter, nowMs: quietNow }),
    ]).toEqual([{ kind: "due" }, { blocker: "work-in-flight", kind: "held" }]);
  });

  // A blank fragment moves `lastHeardMs` but carries no words.
  it("still holds over a turn that only a blank fragment followed", () => {
    const blankAfter = play({
      script: [
        [500, { kind: "spoke" }],
        [1_000, { kind: "heard", text: STEER }],
        [1_500, { kind: "codex-turn", phase: "started", turnId: "after" }],
        [2_000, { kind: "heard", text: " " }],
      ],
    });
    expect(decisionAt({ activity: blankAfter, nowMs: quietNow })).toEqual({ blocker: "work-in-flight", kind: "held" });
  });

  // After a resume over the turn, the owner's sound and a blank fragment are no new words.
  it("holds a second resume over the same turn when only sound and a blank fragment follow the first", () => {
    const turnFirst = play({
      script: [
        [500, { kind: "codex-turn", phase: "started", turnId: "before" }],
        [1_000, { kind: "spoke" }],
        [2_000, { kind: "heard", text: STEER }],
      ],
    });
    const resumed = foldActivity({ activity: turnFirst, input: { kind: "resumed", post: 1 }, nowMs: quietNow });
    const sound = sounded({
      activity: resumed,
      micLevel: HEARING_LEVEL,
      micRms: HEARING_RMS,
      nowMs: quietNow + 3_000,
      outputLevel: 0,
    });
    const blank = foldActivity({ activity: sound, input: { kind: "heard", text: " " }, nowMs: quietNow + 4_000 });
    expect(decisionAt({ activity: blank, nowMs: quietNow + 4_000 + RESUME_MS * 3 })).toEqual({
      blocker: "work-in-flight",
      kind: "held",
    });
  });

  it("still holds over a delegation that began before the owner's latest words, alone or beside an earlier turn", () => {
    const delegationFirst = play({
      script: [
        [500, delegated({ id: "d0" })],
        [1_000, { kind: "spoke" }],
        [2_000, { kind: "heard", text: STEER }],
      ],
    });
    const turnAndDelegation = play({
      script: [
        [400, { kind: "codex-turn", phase: "started", turnId: "before" }],
        [500, delegated({ id: "d0" })],
        [1_000, { kind: "spoke" }],
        [2_000, { kind: "heard", text: STEER }],
      ],
    });
    expect([
      decisionAt({ activity: delegationFirst, nowMs: quietNow }),
      decisionAt({ activity: turnAndDelegation, nowMs: quietNow }),
    ]).toEqual([
      { blocker: "work-in-flight", kind: "held" },
      { blocker: "work-in-flight", kind: "held" },
    ]);
  });

  it("names words that ask it to wait", () => {
    const waiting = play({ script: [[2_000, { kind: "heard", text: "one sec" }]] });
    expect(decisionAt({ activity: waiting, nowMs: 30_000 })).toEqual({ blocker: "words-ask-to-wait", kind: "held" });
  });

  it("names a silence already resumed", () => {
    const resumed = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: quietNow });
    expect(decisionAt({ activity: resumed, nowMs: quietNow + 80 })).toEqual({
      blocker: "already-resumed",
      kind: "held",
    });
  });
});
