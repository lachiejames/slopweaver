/**
 * Whether the voice STOPPED FOR THE OWNER: the barge-in signal the orb's "your turn" state is drawn from.
 *
 * Why it exists: when the owner starts speaking over the voice, they cannot tell whether the voice will stop and
 * listen or both will pause and wait on each other. Good visual feedback that the voice stopped to listen, such as an
 * interrupted indicator, answers "do I talk now?".
 *
 * ## Derived from the two meters, because nothing on the wire says it
 *
 * A plan call's realtime v3 session sends no speech-started, cancelled or truncated event: the 0.157.1 session
 * carried transcripts, turns, delegations and usage, nothing else, and the synthetic session the tests fold
 * (`site/__tests__/unit/fixtures/talkPlanSession.jsonl`) uses only that vocabulary. So the yield is read off what the
 * page can measure — the owner's microphone and the voice's own output, sampled about twelve times a second
 * (`components/voice/useVoiceActivity.ts`). Transcript fragments are no use here: they lag the audio, which is why the
 * speaking phase holds for 700 ms after one.
 *
 * ## Three rules make it mean "it stopped for you"
 *
 * - **Order.** The owner cuts in only by starting AFTER the voice began. The voice starting while they talk is a
 *   backchannel ("Go on."), never a cut-in.
 * - **Held.** The owner has to keep talking over it for {@link CUT_IN_MS}; a cough is not a cut-in.
 * - **Still talking when it stops.** The voice's own sound leaking past echo cancellation starts and stops WITH the
 *   voice, so it never outlasts it: a yield is the voice going quiet while the owner is still audibly talking, loud
 *   {@link HEARD_AFTER_MS} past its last sound.
 *
 * Every threshold here is a judgement, not a measurement: no call has yet been recorded with both meters sampled.
 * The owner's side is the one exception: they are loud only when their microphone clears BOTH bars (`micAudible`,
 * `./micAudible.ts`), since a quiet room clears the spectral one alone and a stretch of them built on it never ends.
 */

import { micAudible } from "./micAudible";

/** One sample of both meters, as the page reads them. */
export interface SoundSample {
  /** The voice's own output level, 0 to 1, unlifted. */
  readonly outputLevel: number;
  /** The owner's microphone level, 0 to 1, unlifted. */
  readonly micLevel: number;
  /** The owner's microphone waveform RMS on the same sample, the second bar they must clear to be heard. */
  readonly micRms: number;
  /** Whether the session acknowledged the owner's mute, so their microphone is not heard. */
  readonly muted: boolean;
}

/** One side's current audible stretch: when it began, and when it was last loud. */
export interface Stretch {
  readonly sinceMs: number;
  readonly lastMs: number;
}

/** What the turn-taking fold carries between samples. */
export interface TurnTaking {
  /** The voice's current or most recent stretch of sound. */
  readonly voice: Stretch | undefined;
  /** The owner's current or most recent stretch of sound. */
  readonly owner: Stretch | undefined;
  /** When the owner cut in over the voice's current stretch, until it yields or they stop. */
  readonly cutInMs: number | undefined;
  /** When the voice went quiet under the owner's cut-in — the instant it stopped for them. */
  readonly yieldedMs: number | undefined;
}

/** Nothing heard from either side yet. */
export const NO_TURN_TAKING: TurnTaking = {
  cutInMs: undefined,
  owner: undefined,
  voice: undefined,
  yieldedMs: undefined,
};

/** At or above this output level the voice is audibly speaking — the same bar as the meter's (`voiceMeter.ts`). */
export const VOICE_SOUND_LEVEL = 0.04;

/** A quiet this short inside the voice's speech is the gap between syllables, not the voice stopping. */
export const VOICE_GAP_MS = 300;

/** A quiet this short inside the owner's speech is a breath, not them stopping. Longer than the voice's, so it bridges it. */
export const OWNER_GAP_MS = 400;

/** How long the owner must talk over the voice before it counts as cutting in. */
export const CUT_IN_MS = 250;

/** How long after the voice's last sound the owner must still be loud: longer than a room's echo tail of it. */
export const HEARD_AFTER_MS = 150;

/** How soon after the owner's cut-in the voice must go quiet for that to be it stopping for them. */
export const YIELD_WITHIN_MS = 2_500;

/** What the orb says under "your turn": the answer to the owner's "do I talk now?". */
export const YIELDED_WORDS = "stopped to listen to you";

/** How long "your turn" shows after the voice stopped for the owner, before it reads plainly as hearing them. */
export const YIELDED_SHOWN_MS = 1_400;

/**
 * Fold one sample of both meters into the turn-taking.
 *
 * @param turn the fold so far
 * @param sample both meters now
 * @param nowMs the sample's instant, on the clock every later read uses
 * @returns the next turn-taking — the same object when nothing changed, since this runs twelve times a second
 */
export function foldTurnTaking({
  turn,
  sample,
  nowMs,
}: {
  turn: TurnTaking;
  sample: SoundSample;
  nowMs: number;
}): TurnTaking {
  const voiceLoud = sample.outputLevel >= VOICE_SOUND_LEVEL;
  const ownerLoud = micAudible(sample);
  const voice = stretched({ gapMs: VOICE_GAP_MS, loud: voiceLoud, nowMs, stretch: turn.voice });
  const owner = stretched({ gapMs: OWNER_GAP_MS, loud: ownerLoud, nowMs, stretch: turn.owner });
  let { cutInMs, yieldedMs } = turn;
  if (voiceLoud) {
    // Speaking again: whatever it stopped for is over.
    yieldedMs = undefined;
  }
  const voiceSounding = sounding({ gapMs: VOICE_GAP_MS, nowMs, stretch: voice });
  const ownerNow = sounding({ gapMs: OWNER_GAP_MS, nowMs, stretch: owner });
  if (!ownerNow || (cutInMs !== undefined && nowMs - cutInMs > YIELD_WITHIN_MS)) {
    // The owner stopped before it did, or it talked on over them: neither is it stopping for them.
    cutInMs = undefined;
  } else if (cutInMs === undefined && voiceSounding && cutsIn({ nowMs, owner, voice })) {
    cutInMs = owner?.sinceMs;
  } else if (cutInMs !== undefined && !voiceSounding && heardAfter({ owner, voice })) {
    yieldedMs = nowMs;
    cutInMs = undefined;
  }
  if (voice === turn.voice && owner === turn.owner && cutInMs === turn.cutInMs && yieldedMs === turn.yieldedMs) {
    return turn;
  }
  return { cutInMs, owner, voice, yieldedMs };
}

/**
 * Whether the voice stopped for the owner recently enough to say so, and is still quiet.
 *
 * @param turn the fold
 * @param outputLevel the voice's output level now
 * @param nowMs the same clock the fold was stamped on
 * @returns true while "your turn" should show
 */
export function yieldedNow({
  turn,
  outputLevel,
  nowMs,
}: {
  turn: TurnTaking;
  outputLevel: number;
  nowMs: number;
}): boolean {
  const { yieldedMs } = turn;
  if (yieldedMs === undefined || outputLevel >= VOICE_SOUND_LEVEL) {
    return false;
  }
  const since = nowMs - yieldedMs;
  return since >= 0 && since < YIELDED_SHOWN_MS;
}

/** A stretch carried one sample on: extended or begun when loud, else unchanged. */
function stretched({
  stretch,
  loud,
  nowMs,
  gapMs,
}: {
  stretch: Stretch | undefined;
  loud: boolean;
  nowMs: number;
  gapMs: number;
}): Stretch | undefined {
  if (!loud) {
    return stretch;
  }
  if (stretch === undefined || nowMs - stretch.lastMs > gapMs) {
    return { lastMs: nowMs, sinceMs: nowMs };
  }
  return { lastMs: nowMs, sinceMs: stretch.sinceMs };
}

/**
 * Whether the owner's microphone is sounding now: their stretch's last loud sample no further back than a breath. Read
 * before a clear-floor post the owner's transcript may not have caught up with yet (`useTriageWalk.ts`).
 *
 * @param turn the fold so far
 * @param nowMs the instant asked about, on the clock the fold was sampled on
 * @returns whether the owner is audibly talking
 */
export function ownerSounding({ turn, nowMs }: { turn: TurnTaking; nowMs: number }): boolean {
  return sounding({ gapMs: OWNER_GAP_MS, nowMs, stretch: turn.owner });
}

/**
 * Whether the owner's microphone was audible AFTER their latest words reached the page: speech the transcript has not
 * caught up with. A relay's `relay_steer` call and the owner's transcript ride two transports with no ordering between
 * them (the call over the console server's event stream, the words over the realtime data channel), so a correction
 * the owner began before the relay reached the page can have its first fragment land after it. Audio precedes its own
 * transcription, so the sound of words already received ends before their fragment arrives; sound sampled after it is
 * more speech, or noise or echo, and either way the relay is read `cut` rather than `whole`.
 *
 * MEASURED over the home's call files: of 432 relays accepted with no stretch of the owner's open, a new stretch of
 * theirs first reached the page within 500 ms after 2 and within 2 s after 5; in one call their "Yes" was accepted, a
 * cue sampled their microphone audible (rms 0.037) 68 ms later and their next stretch's first fragment landed 68 ms
 * after that. Echo bound: 19 of 747 cue samples held on the voice's own output cleared `micAudible`. Repro, from the
 * home: `grep -c "held: the voice's output was loud" talk/calls/*.jsonl`.
 *
 * Not a barrier: the meters are sampled about twelve times a second, so speech begun less than one sample before the
 * hand-off is not seen. It only ever turns `whole` into `cut`.
 *
 * @param ownerStretch the owner's current or most recent stretch of microphone sound (`TurnTaking`'s own)
 * @param lastTranscribedMs when the page last received the owner's words transcribed off the microphone, never a
 *   typed turn's (which carries no audio and would mask a later sample), on the clock the stretch was
 *   sampled on
 * @returns true when the owner's microphone was audible after, or on the same millisecond as, their latest transcribed
 *   words arriving: `performance.now()` need not advance between two callbacks, so a tie cannot tell the order and is
 *   read the fail-closed way, `cut`
 */
export function micAheadOfWords({
  ownerStretch,
  lastTranscribedMs,
}: {
  ownerStretch: Stretch | undefined;
  lastTranscribedMs: number | undefined;
}): boolean {
  return ownerStretch !== undefined && lastTranscribedMs !== undefined && ownerStretch.lastMs >= lastTranscribedMs;
}

/** Whether a stretch is still going: its last loud sample no further back than its gap. */
function sounding({ stretch, nowMs, gapMs }: { stretch: Stretch | undefined; nowMs: number; gapMs: number }): boolean {
  return stretch !== undefined && nowMs - stretch.lastMs <= gapMs;
}

/**
 * Whether the owner was loud clearly after the voice's last sound — the voice's own sound leaking past echo
 * cancellation ends with it, so only the owner can be.
 */
function heardAfter({ owner, voice }: { owner: Stretch | undefined; voice: Stretch | undefined }): boolean {
  if (owner === undefined || voice === undefined) {
    return false;
  }
  return owner.lastMs - voice.lastMs >= HEARD_AFTER_MS;
}

/**
 * Whether the owner's stretch began after the voice's and they have been loud across long enough of it to be cutting
 * in — and not so long ago that the voice has already talked on over them.
 */
function cutsIn({
  owner,
  voice,
  nowMs,
}: {
  owner: Stretch | undefined;
  voice: Stretch | undefined;
  nowMs: number;
}): boolean {
  if (owner === undefined || voice === undefined) {
    return false;
  }
  const held = owner.lastMs - owner.sinceMs >= CUT_IN_MS;
  return owner.sinceMs > voice.sinceMs && held && nowMs - owner.sinceMs <= YIELD_WITHIN_MS;
}
