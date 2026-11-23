/*
 * Who is talking, and which signal says so: the one answer the orb's talking phases and its cue gate share, so a cue
 * held over "speech" names the signal that fired.
 */
import { describe, expect, it } from "vitest";

import { SPEAKING_LEVEL } from "../../lib/voiceMeter";
import {
  HEARING_HOLD_MS,
  HEARING_LEVEL,
  HEARING_RMS,
  SPEAKING_HOLD_MS,
  TALKING_STATUS,
  talkingOf,
} from "../../lib/voiceTalking";
import { NO_TURN_TAKING, type TurnTaking, YIELDED_WORDS } from "../../lib/voiceTurnTaking";

/** No transcript and no yield. */
const SILENT = { lastHeardMs: undefined, lastSpokeMs: undefined, turn: NO_TURN_TAKING };

/** A quiet sample at 10 000 ms: no transcript, both meters silent, unmuted. */
const QUIET = { activity: SILENT, micLevel: 0, micRms: 0, muted: false, nowMs: 10_000, outputLevel: 0 };

/** The voice stopped for the owner 100 ms before {@link QUIET}'s instant. */
const YIELDED: TurnTaking = { ...NO_TURN_TAKING, yieldedMs: 9_900 };

describe("talkingOf", () => {
  it("answers nobody in a quiet moment", () => {
    expect(talkingOf(QUIET)).toBe(undefined);
  });

  it("names the voice's output at its threshold, and nothing just under it", () => {
    expect(talkingOf({ ...QUIET, outputLevel: SPEAKING_LEVEL })).toBe("output-level");
    expect(talkingOf({ ...QUIET, outputLevel: SPEAKING_LEVEL - 0.001 })).toBe(undefined);
  });

  it("holds the voice as speaking until its hold after a spoken fragment runs out", () => {
    const spoke = (lastSpokeMs: number): ReturnType<typeof talkingOf> =>
      talkingOf({ ...QUIET, activity: { ...SILENT, lastSpokeMs } });
    expect(spoke(10_000 - SPEAKING_HOLD_MS + 1)).toBe("spoke-hold");
    expect(spoke(10_000 - SPEAKING_HOLD_MS)).toBe(undefined);
  });

  it("names the owner's microphone only with both bars cleared, and never while they are muted", () => {
    expect(talkingOf({ ...QUIET, micLevel: HEARING_LEVEL, micRms: HEARING_RMS })).toBe("mic-level");
    expect(talkingOf({ ...QUIET, micLevel: HEARING_LEVEL - 0.001, micRms: HEARING_RMS })).toBe(undefined);
    expect(talkingOf({ ...QUIET, micLevel: HEARING_LEVEL, micRms: HEARING_RMS - 0.001 })).toBe(undefined);
    expect(talkingOf({ ...QUIET, micLevel: HEARING_LEVEL, micRms: HEARING_RMS, muted: true })).toBe(undefined);
  });

  // A quiet room's spectrum reads loud and its RMS does not; a spoken sample clears both. Repro, from the home:
  // `grep -o 'held: the owner's microphone was loud (mic 0.\(346 rms 0.003\|480 rms 0.042\)' talk/calls/{<call-a>,<call-b>}-*.jsonl`
  it("reads a measured quiet room as nobody, and a measured voice as the owner", () => {
    expect(talkingOf({ ...QUIET, micLevel: 0.346, micRms: 0.003 })).toBe(undefined);
    expect(talkingOf({ ...QUIET, micLevel: 0.48, micRms: 0.042 })).toBe("mic-level");
  });

  it("holds the owner as talking until their hold after a transcribed fragment runs out", () => {
    const heard = (lastHeardMs: number): ReturnType<typeof talkingOf> =>
      talkingOf({ ...QUIET, activity: { ...SILENT, lastHeardMs } });
    expect(heard(10_000 - HEARING_HOLD_MS + 1)).toBe("heard-hold");
    expect(heard(10_000 - HEARING_HOLD_MS)).toBe(undefined);
  });

  it("asks the voice stopping for the owner first, then the voice, then the owner", () => {
    const busy = { ...SILENT, lastHeardMs: 9_990, lastSpokeMs: 9_990 };
    const everything = { ...QUIET, activity: busy, micLevel: 0.5, micRms: 0.1 };
    expect([
      talkingOf({ ...everything, activity: { ...busy, turn: YIELDED } }),
      talkingOf({ ...everything, outputLevel: 0.5 }),
      talkingOf(everything),
      talkingOf({ ...everything, activity: { ...busy, lastSpokeMs: undefined } }),
      talkingOf({ ...everything, activity: { ...busy, lastSpokeMs: undefined }, micLevel: 0 }),
    ]).toEqual(["yielded", "output-level", "spoke-hold", "mic-level", "heard-hold"]);
  });
});

describe("TALKING_STATUS", () => {
  it("draws both of the owner's signals as hearing, both of the voice's as speaking, and a yield as the owner's turn", () => {
    expect(TALKING_STATUS).toEqual({
      "heard-hold": { headline: "hearing you", phase: "hearing" },
      "mic-level": { headline: "hearing you", phase: "hearing" },
      "output-level": { headline: "speaking", phase: "speaking" },
      "spoke-hold": { headline: "speaking", phase: "speaking" },
      yielded: { detail: YIELDED_WORDS, headline: "your turn", phase: "yielded" },
    });
  });
});
