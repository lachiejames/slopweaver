/**
 * WHO is talking, and which signal says so: the one decision the orb's talking phases (`./voiceActivity.ts`'s
 * `voiceStatusOf`) and the orb's cue gate (`components/voice/OrbCues.tsx`) both read, so the two never disagree.
 *
 * A call where the owner saw every badge and heard none of its sounds left a call file saying only "held: somebody was
 * talking" twenty times, across stretches with nobody's words in the transcript. Five different signals can hold a
 * cue — the voice stopping for the owner, the voice's output level, the hold after its last spoken fragment, the
 * owner's microphone level, the hold after the owner's last transcribed fragment — and a trace that does not say
 * which fired cannot tell one from another. This names the one that fired, and {@link Talking} carries the levels it
 * read, so a silence is a measurement rather than a guess.
 */
import { micAudible } from "./micAudible";
import { SPEAKING_LEVEL } from "./voiceMeter";
import { type TurnTaking, YIELDED_WORDS, yieldedNow } from "./voiceTurnTaking";

export { HEARING_LEVEL, HEARING_RMS } from "./micAudible";

/** How long after the owner's last transcribed fragment they still count as talking. */
export const HEARING_HOLD_MS = 900;

/** How long after the last spoken fragment the voice still counts as speaking. */
export const SPEAKING_HOLD_MS = 700;

/**
 * The signal that says somebody is talking, in the order it is asked: the voice just stopped for the owner; the voice's
 * output is loud; the voice spoke a fragment moments ago; the owner's microphone is loud; the owner was transcribed
 * moments ago.
 */
export type TalkingSignal = "yielded" | "output-level" | "spoke-hold" | "mic-level" | "heard-hold";

/** Someone is talking: the owner, the voice, or the voice just stopped by the owner cutting in (`voiceTurnTaking.ts`). */
export type TalkingPhase = "hearing" | "yielded" | "speaking";

/** What the orb draws for each signal: the phase, its headline, and the detail a yield replaces the work's with. */
export const TALKING_STATUS: Readonly<
  Record<TalkingSignal, { readonly phase: TalkingPhase; readonly headline: string; readonly detail?: string }>
> = {
  "heard-hold": { headline: "hearing you", phase: "hearing" },
  "mic-level": { headline: "hearing you", phase: "hearing" },
  "output-level": { headline: "speaking", phase: "speaking" },
  "spoke-hold": { headline: "speaking", phase: "speaking" },
  yielded: { detail: YIELDED_WORDS, headline: "your turn", phase: "yielded" },
};

/**
 * Somebody talking, as the cue trace records it: the signal that said so, and both meters as that sample read them —
 * each as the gate reads it, a position in the analyser's decibel window, and as the signal's own RMS
 * (`./voiceMeter.ts`'s `waveformLevel`).
 */
export interface Talking {
  readonly signal: TalkingSignal;
  readonly micLevel: number;
  readonly outputLevel: number;
  readonly micRms: number;
  readonly outputRms: number;
  readonly muted: boolean;
}

/**
 * Which signal says somebody is talking at one sample, if any — the voice's first, since the transcript lags its audio.
 *
 * @param activity the fold's turn-taking, for the voice stopping for the owner, and its last spoken and transcribed
 *   fragments
 * @param outputLevel the voice's output level now, 0 to 1
 * @param micLevel the owner's microphone level now, 0 to 1
 * @param micRms the owner's microphone waveform RMS on the same sample, which must also clear its bar, so a quiet room
 *   whose spectrum reads loud is not the owner
 * @param muted whether the session acknowledged the owner's mute, so the owner's microphone counts for nothing
 * @param nowMs the same clock the fold was stamped on
 * @returns the first signal that fires, or `undefined` when neither of them is talking
 */
export function talkingOf({
  activity,
  outputLevel,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  activity: {
    readonly turn: TurnTaking;
    readonly lastSpokeMs: number | undefined;
    readonly lastHeardMs: number | undefined;
  };
  outputLevel: number;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): TalkingSignal | undefined {
  const { turn, lastSpokeMs, lastHeardMs } = activity;
  if (yieldedNow({ nowMs, outputLevel, turn })) {
    return "yielded";
  }
  if (outputLevel >= SPEAKING_LEVEL) {
    return "output-level";
  }
  if (lastSpokeMs !== undefined && nowMs - lastSpokeMs < SPEAKING_HOLD_MS) {
    return "spoke-hold";
  }
  if (micAudible({ micLevel, micRms, muted })) {
    return "mic-level";
  }
  if (lastHeardMs !== undefined && nowMs - lastHeardMs < HEARING_HOLD_MS) {
    return "heard-hold";
  }
  return undefined;
}
