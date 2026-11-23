/**
 * Whether the conversation shows the owner's typing dots: the owner is audibly TALKING, not merely making a sound the
 * microphone picks up. An unmuted microphone with nothing said must not keep flashing the dots on and off, and the
 * dots must stay distinct from actual spoken words being received; breathing, or a moment in the middle of the
 * voice's reply, must not raise them either.
 *
 * Reading the owner's microphone's SPECTRAL level alone, one 80 ms sample at a time, is not enough. A quiet room
 * clears that bar (`./micAudible.ts`), so the dots would toggle with every sample. Every cue held while the voice
 * spoke and the owner was silent read the microphone at spectral 0.05 to 0.30 with an RMS of 0.00, above that bar
 * on the spectral reading alone. Repro, from the home:
 * `grep -o -E "held: the voice's output was loud \(mic [0-9.]* rms [0-9.]{4}" talk/calls/<call-id>-*.jsonl`.
 *
 * So the dots read the turn-taking fold's stretch of the owner (`./voiceTurnTaking.ts`). That stretch is built on
 * `micAudible`, both bars, and bridged across a breath by `OWNER_GAP_MS`, so a pause between words keeps them up. And
 * it must have been loud across {@link OWNER_TALKING_ONSET_MS} before they show, so a breath, a click or a cough never
 * flashes them. They stand for words not yet recognised, so once a word of the owner's lands inside the stretch — a
 * transcribed fragment, an unfinished segment, or one of the owner's turns ending — they are done with it: the
 * owner's turn carries what they say, and the breath hold never brings the dots back under that turn once it settles.
 *
 * That is a LATCH, keyed by the stretch's start ({@link wordsLatchOf}), never a fresh read of the fold's markers:
 * each marker is cleared by something else — the voice speaking clears the owner's turn's ending — so reading them
 * live would let the dots back under a settled turn every time one was cleared inside a breath hold. A
 * new stretch, after a quiet longer than a breath, starts unlatched and may show them again.
 */
import { type OwnerTurns, ownerOpenAtOf } from "./voiceOwnerTurns";
import { ownerSounding, type TurnTaking } from "./voiceTurnTaking";

/**
 * How long the owner's stretch must have been loud, first loud sample to last, before the dots show: three of the page's
 * 80 ms samples, so one or two loud ones never count. A judgement, the same order as a cut-in (`CUT_IN_MS`).
 */
export const OWNER_TALKING_ONSET_MS = 240;

/** What the dots read off the activity fold: the owner's stretch, last transcribed fragment and turns. */
interface WordsActivity {
  readonly turn: TurnTaking;
  readonly lastHeardMs: number | undefined;
  readonly owner: OwnerTurns;
}

/**
 * The start of the stretch a word of the owner's has landed in, carried forward: the current stretch's start once a
 * fragment is transcribed, a segment of the owner's arrives or a turn of the owner's ends at or after it, else the
 * latch as it was. Folded on every fold event and every meter read, so a marker cleared moments later has already
 * latched.
 *
 * @param activity the activity fold
 * @param latched the latch so far, `undefined` before any word
 * @returns the start of the newest stretch a word of the owner's landed in, `undefined` before any
 */
export function wordsLatchOf({
  activity,
  latched,
}: {
  activity: WordsActivity;
  latched: number | undefined;
}): number | undefined {
  const stretch = activity.turn.owner;
  if (stretch === undefined) {
    return latched;
  }
  const wordsAt = [activity.lastHeardMs, ownerOpenAtOf({ turns: activity.owner }), activity.owner.awaiting?.sinceMs];
  if (wordsAt.some((atMs) => atMs !== undefined && atMs >= stretch.sinceMs)) {
    return stretch.sinceMs;
  }
  return latched;
}

/**
 * Whether the owner's typing dots show at one instant: the owner's stretch is still sounding, has been loud long
 * enough to be the owner talking, and no word of theirs has latched it.
 *
 * @param turn the turn-taking fold, whose stretch of the owner was built on both microphone bars
 * @param wordsLatch {@link wordsLatchOf}'s latch, folded through the same instant
 * @param nowMs the instant asked about, on the clock the fold was sampled on
 * @returns true while the owner is audibly talking with no word of it recognised
 */
export function ownerTalkingShown({
  turn,
  wordsLatch,
  nowMs,
}: {
  turn: TurnTaking;
  wordsLatch: number | undefined;
  nowMs: number;
}): boolean {
  const stretch = turn.owner;
  if (stretch === undefined || !ownerSounding({ nowMs, turn })) {
    return false;
  }
  return wordsLatch !== stretch.sinceMs && stretch.lastMs - stretch.sinceMs >= OWNER_TALKING_ONSET_MS;
}
