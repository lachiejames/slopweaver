/**
 * A made-up cut-in, so "your turn" can be seen — and recorded — with no call up: `?stage=star-cluster&orb=yielded&voice=sim`.
 *
 * The scene is RAW meter levels on a loop — the voice talking, the owner starting over it, the voice going quiet, the owner
 * talking on, then quiet — and every frame REPLAYS them through the same fold and status a call runs
 * (`foldActivity`, `voiceStatusOf`). So what the preview shows is the barge-in detector deciding, not a picture of
 * what it would decide: a change to the detector changes the recording.
 */
import { foldActivity, NO_ACTIVITY, type VoiceActivity, type VoiceStatus, voiceStatusOf } from "./voiceActivity";

/** How long the scene runs before it starts again, seconds. */
export const CUT_IN_SCENE_S = 9;

/** When the voice stops in the scene, seconds: it has been talking since the start. */
const VOICE_UNTIL_S = 2.9;

/** When the owner starts talking over it, seconds. */
const HIM_FROM_S = 2.2;

/** When the owner stops, seconds. */
const HIM_UNTIL_S = 6.5;

/** The scene's sampling step, seconds: the call's own meter clock (`useVoiceActivity.ts`). */
const STEP_S = 0.08;

/** Both raw levels at an instant of the scene, and the owner's microphone's waveform RMS beside its level. */
export interface SceneLevels {
  readonly outputLevel: number;
  readonly micLevel: number;
  readonly micRms: number;
}

/**
 * The raw levels at an instant: syllables over a floor while each side talks, silence otherwise. The owner's RMS while they
 * talk sits in the 0.03 to 0.06 a spoken sample read on the calls `HEARING_RMS` was measured on; that constant's
 * comment carries the command that reprints them.
 *
 * @param timeS seconds into one run of the scene
 * @returns the voice's output level, the owner's microphone's, and its RMS
 */
export function cutInLevelsAt({ timeS }: { timeS: number }): SceneLevels {
  let outputLevel = 0;
  if (timeS >= 0 && timeS < VOICE_UNTIL_S) {
    outputLevel = 0.05 + 0.1 * Math.abs(Math.sin(timeS * 13.5 + Math.sin(timeS * 3.1) * 2));
  }
  let micLevel = 0;
  let micRms = 0;
  if (timeS >= HIM_FROM_S && timeS < HIM_UNTIL_S) {
    const syllable = Math.abs(Math.sin(timeS * 11 + Math.sin(timeS * 2.3) * 2));
    micLevel = 0.05 + 0.08 * syllable;
    micRms = 0.03 + 0.03 * syllable;
  }
  return { micLevel, micRms, outputLevel };
}

/**
 * The status a call would show at an instant of the scene, and the levels then.
 *
 * @param timeS seconds since the preview started; the scene loops every {@link CUT_IN_SCENE_S}
 * @returns the status the real fold reads, and both raw levels
 */
export function cutInSceneAt({ timeS }: { timeS: number }): {
  readonly status: VoiceStatus;
  readonly levels: SceneLevels;
} {
  const into = ((Math.max(0, timeS) % CUT_IN_SCENE_S) + CUT_IN_SCENE_S) % CUT_IN_SCENE_S;
  let activity: VoiceActivity = NO_ACTIVITY;
  for (let at = 0; at <= into; at += STEP_S) {
    const { micLevel, micRms, outputLevel } = cutInLevelsAt({ timeS: at });
    activity = foldActivity({
      activity,
      input: { kind: "sounded", micLevel, micRms, muted: false, outputLevel },
      nowMs: at * 1000,
    });
  }
  const levels = cutInLevelsAt({ timeS: into });
  const status = voiceStatusOf({ activity, link: "live", muted: false, nowMs: into * 1000, ...levels });
  return { levels, status };
}
