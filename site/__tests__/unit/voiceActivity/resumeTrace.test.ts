import { describe, expect, it } from "vitest";

import { resumeGateLine } from "../../../components/voice/planWiringLines";
import {
  foldActivity,
  HEARING_LEVEL,
  HEARING_RMS,
  RESUME_MS,
  resumeDecisionOf,
  UNANSWERED_FORGET_MS,
  type VoiceActivity,
} from "../../../lib/voiceActivity";
import {
  foldResumeTrace,
  NO_RESUME_TRACE,
  type ResumeGateObservation,
  type ResumeTraceState,
} from "../../../lib/voiceResumeTrace";
import { sounded, steered } from "./resumeHarness";

/**
 * The page's clock over one fold, every 80 ms from `fromMs` to `toMs`, the owner's microphone silent: every observation the
 * trace emitted, in order, and the state it ended on.
 */
const clock = ({
  activity,
  fromMs,
  toMs,
  state = NO_RESUME_TRACE,
}: {
  activity: VoiceActivity;
  fromMs: number;
  toMs: number;
  state?: ResumeTraceState;
}): { observations: readonly ResumeGateObservation[]; state: ResumeTraceState } => {
  const observations: ResumeGateObservation[] = [];
  let held = state;
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += 80) {
    const decision = resumeDecisionOf({ activity, micLevel: 0, micRms: 0, muted: false, nowMs });
    const traced = foldResumeTrace({ activity, decision, micLevel: 0, micRms: 0, muted: false, nowMs, state: held });
    held = traced.state;
    if (traced.observation !== undefined) {
      observations.push(traced.observation);
    }
  }
  return { observations, state: held };
};

// `steered`: the voice spoke at 1s, the owner spoke a steer at 2s. Here the voice's audio is still heard at 2.5s.
const voiceAfter = sounded({ activity: steered, micLevel: 0, micRms: 0, nowMs: 2_500, outputLevel: 0.5 });

describe("foldResumeTrace", () => {
  it("writes nothing before the resume's own quiet has passed", () => {
    expect(clock({ activity: voiceAfter, fromMs: 2_000, toMs: 2_000 + RESUME_MS - 1 }).observations).toEqual([]);
  });

  it("writes one line for a gate held through the whole silence, however many samples read it", () => {
    const { observations } = clock({ activity: voiceAfter, fromMs: 2_000, toMs: 22_000 });
    expect(observations).toEqual([
      {
        blocker: "voice-after-owner-words",
        heardAgoMs: 5_040,
        micLevel: 0,
        micRms: 0,
        muted: false,
        ownerSoundAgoMs: undefined,
        rows: [],
        tools: 0,
        voiceFinalAgoMs: undefined,
        voiceSoundAgoMs: 4_540,
      },
    ]);
  });

  it("writes again when another gate takes over the same silence", () => {
    const first = clock({ activity: voiceAfter, fromMs: 2_000, toMs: 10_000 });
    const tool = foldActivity({
      activity: voiceAfter,
      input: { callId: "c1", kind: "tool-started", name: "read_card" },
      nowMs: 10_000,
    });
    const second = clock({ activity: tool, fromMs: 10_080, toMs: 20_000, state: first.state });
    expect(second.observations.map((observation) => [observation.blocker, observation.tools])).toEqual([
      ["tool-pending", 1],
    ]);
  });

  // A gate flickering against another wrote a line per flip.
  it("writes each gate once per silence, however the gates flicker between them", () => {
    const loud = { micLevel: HEARING_LEVEL, micRms: HEARING_RMS, muted: false };
    const quiet = { micLevel: 0, micRms: 0, muted: false };
    let state = NO_RESUME_TRACE;
    const observations: ResumeGateObservation[] = [];
    for (const sample of [
      { ...loud, nowMs: 8_000 },
      { ...quiet, nowMs: 8_080 },
      { ...loud, nowMs: 8_160 },
      { ...quiet, nowMs: 8_240 },
    ]) {
      const decision = resumeDecisionOf({ activity: voiceAfter, ...sample });
      const traced = foldResumeTrace({ activity: voiceAfter, decision, state, ...sample });
      state = traced.state;
      observations.push(...[traced.observation].filter((seen) => seen !== undefined));
    }
    expect(observations.map((observation) => observation.blocker)).toEqual([
      "microphone-audible",
      "voice-after-owner-words",
    ]);
  });

  it("writes afresh for new words of the owner's held by the same gate", () => {
    const first = clock({ activity: voiceAfter, fromMs: 2_000, toMs: 10_000 });
    const again = sounded({
      activity: foldActivity({ activity: voiceAfter, input: { kind: "heard", text: " Say card." }, nowMs: 10_000 }),
      micLevel: 0,
      micRms: 0,
      nowMs: 10_500,
      outputLevel: 0.5,
    });
    const second = clock({ activity: again, fromMs: 10_080, toMs: 30_000, state: first.state });
    expect(second.observations.map((observation) => [observation.blocker, observation.heardAgoMs])).toEqual([
      ["voice-after-owner-words", 5_040],
    ]);
  });

  it("writes nothing for a silence the voice has spoken into, nor one that was due", () => {
    const answered = foldActivity({ activity: steered, input: { kind: "spoke" }, nowMs: 3_000 });
    expect([
      clock({ activity: answered, fromMs: 2_000, toMs: 30_000 }).observations,
      clock({ activity: steered, fromMs: 2_000, toMs: 2_000 + RESUME_MS }).observations,
    ]).toEqual([[], []]);
  });

  // The voice answered in words, then the owner's words' last fragment landed late.
  it("writes nothing when the voice answered in words before a late fragment of the owner's, and traces a meter-only answer", () => {
    const ownerThenVoice = sounded({
      activity: sounded({
        activity: foldActivity({ activity: steered, input: { kind: "heard", text: "Check it." }, nowMs: 2_900 }),
        micLevel: HEARING_LEVEL,
        micRms: HEARING_RMS,
        nowMs: 3_000,
        outputLevel: 0,
      }),
      micLevel: 0,
      micRms: 0,
      nowMs: 4_000,
      outputLevel: 0.5,
    });
    const late = (activity: VoiceActivity): VoiceActivity =>
      foldActivity({ activity, input: { kind: "heard", text: " Over there." }, nowMs: 4_300 });
    const inWords = late(
      foldActivity({
        activity: foldActivity({ activity: ownerThenVoice, input: { kind: "spoke" }, nowMs: 4_100 }),
        input: { asked: false, kind: "voice-finished", promised: false },
        nowMs: 4_200,
      }),
    );
    expect([
      clock({ activity: inWords, fromMs: 4_300, toMs: 30_000 }).observations,
      clock({ activity: late(ownerThenVoice), fromMs: 4_300, toMs: 30_000 }).observations.map((seen) => seen.blocker),
    ]).toEqual([[], ["voice-after-owner-sound"]]);
  });

  it("writes nothing once the silence is as much the owner's as the voice's", () => {
    const lateMs = 2_000 + UNANSWERED_FORGET_MS;
    expect(clock({ activity: voiceAfter, fromMs: lateMs, toMs: lateMs + 1_000 }).observations).toEqual([]);
  });
});

describe("resumeGateLine", () => {
  it("names the gate and every instant it read, and is never a resume line", () => {
    const line = resumeGateLine({
      observation: {
        blocker: "voice-after-owner-words",
        heardAgoMs: 5_040,
        micLevel: 0.2345,
        micRms: 0.00555,
        muted: true,
        ownerSoundAgoMs: undefined,
        rows: ["d:d1", "t:c1"],
        tools: 1,
        voiceFinalAgoMs: 12_000,
        voiceSoundAgoMs: 4_540,
      },
    });
    expect(line).toEqual({
      detail:
        "not posted: voice-after-owner-words; heard 5.0s ago, voice sound 4.5s ago, the owner's sound never, " +
        "voice final 12.0s ago, mic 0.234 rms 0.0056 muted, tools 1, rows d:d1,t:c1",
      ms: undefined,
      name: "resume-gate",
      refused: true,
      usage: undefined,
    });
  });
});
