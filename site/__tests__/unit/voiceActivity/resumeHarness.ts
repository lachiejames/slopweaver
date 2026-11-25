/*
 * What the resumeDueOf tests share: the due-instant readers, the owner's microphone's two measured samples, the steer
 * the owner spoke, and the meter sampler.
 */
import { foldActivity, resumeDueOf, type VoiceActivity } from "../../../lib/voiceActivity";
import { play } from "./harness";

/**
 * Whether the voice is asked to take its turn at one instant, the owner's microphone silent and live.
 * @returns whether the resume is due at `nowMs`
 */
export const dueAt = ({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): boolean =>
  resumeDueOf({ activity, micLevel: 0, micRms: 0, muted: false, nowMs });

/**
 * The same, with the owner's microphone muted and its meter reading `micLevel` and `micRms` of the room.
 * @returns whether the resume is due at `nowMs` while the owner is muted
 */
export const mutedDueAt = ({
  activity,
  micLevel,
  micRms,
  nowMs,
}: {
  activity: VoiceActivity;
  micLevel: number;
  micRms: number;
  nowMs: number;
}): boolean => resumeDueOf({ activity, micLevel, micRms, muted: true, nowMs });

/** The owner's microphone while they talk: a spoken sample's RMS, as `voiceTurnTaking.test.ts` measured it. */
export const SPOKEN_RMS = 0.042;

/**
 * The owner's quiet room, loud on the spectral level and silent on RMS: a sample logged while nobody spoke.
 * Repro, from the home: `grep -o 'held: the owner was transcribed moments ago (mic 0.311 rms 0.004' talk/calls/<call-id>-*.jsonl`
 */
export const QUIET_ROOM = { micLevel: 0.311, micRms: 0.004 } as const;

// A steer that was met with 60s of nothing until the owner spoke again.
export const STEER = "Great, that works. You can go ahead and send that one, tagging the Acme launch channel.";

/** The activity after the owner spoke that steer at 2s, with the voice having spoken at 1s. */
export const steered = play({
  script: [
    [1_000, { kind: "spoke" }],
    [2_000, { kind: "heard", text: STEER }],
  ],
});

/**
 * Both meters sampled once, as the page's timer folds them before it asks.
 * @returns the activity after one sounded sample
 */
export const sounded = ({
  activity,
  outputLevel,
  micLevel,
  micRms,
  nowMs,
}: {
  activity: VoiceActivity;
  outputLevel: number;
  micLevel: number;
  micRms: number;
  nowMs: number;
}): VoiceActivity =>
  foldActivity({ activity, input: { kind: "sounded", micLevel, micRms, muted: false, outputLevel }, nowMs });
