/**
 * When the page should resume, and which gate held it when it should not — split out of `./voiceActivityStatus.ts`,
 * whose "still waiting" rule (`unanswered`) it shares.
 */

import { micAudible } from "./micAudible";
import { endsOnOver } from "./overWord";
import { activityRows } from "./voiceActivityRows";
import { RESUME_MS, RESUME_SOUND_QUIET_MS, type VoiceActivity } from "./voiceActivityState";
import { unanswered } from "./voiceActivityStatus";
import { owedSinceMs } from "./voiceOwed";
import { asksInWordsToWait, asksToWait } from "./waitAsk";

/**
 * Whether the page should resume NOW (`PlanCall.resume`), asking the voice to acknowledge the owner while the console
 * starts the thinking model's turn: the owner's words have gone unanswered {@link RESUME_MS} — the same rule as "still
 * waiting", seven seconds sooner — with nothing in flight but Codex turns begun before the owner's words, no sound
 * from their microphone now nor for {@link RESUME_SOUND_QUIET_MS}, the voice not audible since their words, and their
 * words not ending on a wait (`asksToWait`, `./waitAsk.ts`). Words ending on the owner's code word "over"
 * (`endsOnOver`, `./overWord.ts`) are due after only {@link RESUME_SOUND_QUIET_MS}, the server's own quiet floor,
 * whatever wait came before it; every other gate still holds. Once per thing the owner said, and never after the
 * page's own nudge for it. Asking is not answering: if the voice still says nothing, "still waiting" and the nudge
 * follow at `UNANSWERED_MS` exactly as before, because ZZZ is valued for reliably meaning no response is coming.
 *
 * The owner's mute does not hold it: muting after speaking is how the owner ends a turn, and a muted microphone is a
 * quiet one. Without that, measured twice on one call, the owner went quiet on mute after their words and each time
 * the turn ended only when they spoke again (the call file records no mute state; the owner's report named it). So
 * muted, a filler the owner trailed off on is where the mute cut them off and holds nothing, while a wait they asked
 * for in words still holds (`asksInWordsToWait`: "…the staging pool and", then muted, would otherwise sit open for
 * good).
 *
 * Sound from the owner is `micAudible` (`./micAudible.ts`), the orb's own answer, both now and in the stretch of
 * them the fold keeps: read off the spectral level alone, a quiet room held this forever while the orb drew ZZZ (the
 * repro is in that module).
 *
 * Read off the meters, the voice sounding at or after the owner's last sound answered them — never once a turn of
 * theirs opened after the voice's did (`./voiceTurnOrder.ts`): under the voice's own audio the owner's microphone can
 * read silent while they talk, so that reading would hold the resume for the whole silence (37s on one call).
 *
 * @param activity the fold
 * @param micLevel the owner's microphone level now, whatever it reads of the room while they are muted
 * @param micRms the owner's microphone waveform RMS on the same sample, the second bar a sound must clear to be them
 * @param muted whether the owner is muted now
 * @param nowMs the same clock the fold was stamped on
 * @returns true at most once per silence of the owner's
 */
export function resumeDueOf({
  activity,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  activity: VoiceActivity;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): boolean {
  return resumeDecisionOf({ activity, micLevel, micRms, muted, nowMs }).kind === "due";
}

/**
 * The three gates named after the owner. A gate's name is written into the call file's `resume-gate` line
 * (`resumeGateLine`, `site/components/voice/planWiringLines.ts`); no code reads one back off a call file.
 */
const VOICE_AFTER_OWNER_WORDS = "voice-after-owner-words" as const;

/** The owner's recent sound holding the resume. */
const OWNER_RECENT_SOUND = "owner-recent-sound" as const;

/** The voice sounding after the owner's last sound. */
const VOICE_AFTER_OWNER_SOUND = "voice-after-owner-sound" as const;

/**
 * Which gate of {@link resumeDueOf} held the resume, in the order it reads them. Each names one judgement, so a call
 * file can say which one kept a silence of the owner's unanswered: none of the eight transcription-fidelity test calls posted a resume
 * through 20s gaps the owner's real calls would have resumed in, and the mic gate was measured clear offline,
 * so only a gate the page names can say which of the rest it was.
 */
export type ResumeBlocker =
  | "nothing-heard"
  | "already-resumed"
  | "already-nudged"
  | "retry-quiet"
  | "microphone-audible"
  | "tool-pending"
  | "voice-owes-turn"
  | typeof VOICE_AFTER_OWNER_WORDS
  | typeof OWNER_RECENT_SOUND
  | typeof VOICE_AFTER_OWNER_SOUND
  | "work-in-flight"
  | "words-ask-to-wait"
  | "answered-or-not-quiet";

/** What {@link resumeDecisionOf} judged: due, or held by one named gate. */
export type ResumeDecision = { readonly kind: "due" } | { readonly kind: "held"; readonly blocker: ResumeBlocker };

/**
 * {@link resumeDueOf}'s judgement with the gate that held it named — the same gates in the same order, so naming one
 * can never change whether a resume is posted.
 *
 * @param activity the fold
 * @param micLevel the owner's microphone level now
 * @param micRms the owner's microphone waveform RMS on the same sample
 * @param muted whether the owner is muted now
 * @param nowMs the same clock the fold was stamped on
 * @returns due, or the first gate that held it
 */
export function resumeDecisionOf({
  activity,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  activity: VoiceActivity;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): ResumeDecision {
  const held = (blocker: ResumeBlocker): ResumeDecision => ({ blocker, kind: "held" });
  const heard = activity.lastHeardMs;
  if (heard === undefined) {
    return held("nothing-heard");
  }
  if (activity.resumedHeardMs === heard) {
    return held("already-resumed");
  }
  if (activity.nudgedHeardMs === heard) {
    return held("already-nudged");
  }
  // A retry after a transient refusal waits a quiet after the refusal, or after the owner's words if any landed since.
  const retryMs = activity.resumeRetryMs;
  if (retryMs !== undefined && nowMs - Math.max(retryMs, heard) < RESUME_SOUND_QUIET_MS) {
    return held("retry-quiet");
  }
  // A voice turn ending after the owner's words is an answer delivered or arriving, never one to speak over, "over"
  // included: the owed turn stays the owner's press, with or without a `spoke` before its final.
  if (micAudible({ micLevel, micRms, muted })) {
    return held("microphone-audible");
  }
  if (activity.tools.size > 0) {
    return held("tool-pending");
  }
  if (owedSinceMs({ activity }) !== undefined) {
    return held("voice-owes-turn");
  }
  // The meters run ahead of the transcript: the voice audible since the owner's words is it answering before its words
  // arrive, and any sound from the owner holds it for the margin their words run ahead of their transcript
  // ({@link RESUME_SOUND_QUIET_MS}). The voice heard at or after the owner's last sound answered them, whenever their
  // words' last fragment lands — unless their latest words are in a turn that OPENED after the voice's, which the
  // ordered turn stream proves came after it, however their microphone read under the voice's audio
  // (`./voiceTurnOrder.ts`).
  const { voice, owner } = activity.turn;
  // The meter names no turn: once the owner's latest words are in a turn that opened after the voice's, its sound after
  // them is that older turn's tail unless a new voice turn's segment follows within the quiet, so it holds only that
  // long.
  const tailQuiet = activity.order.ownerLatestSinceVoice && voice !== undefined && nowMs - voice.lastMs >= RESUME_MS;
  if (voice !== undefined && voice.lastMs >= heard && !tailQuiet) {
    return held(VOICE_AFTER_OWNER_WORDS);
  }
  if (owner !== undefined && nowMs - owner.lastMs < RESUME_SOUND_QUIET_MS) {
    return held(OWNER_RECENT_SOUND);
  }
  if (
    voice !== undefined &&
    owner !== undefined &&
    !activity.order.ownerLatestSinceVoice &&
    voice.lastMs >= owner.lastMs
  ) {
    return held(VOICE_AFTER_OWNER_SOUND);
  }
  // Work in flight holds it, bar ONE shape: nothing but Codex turns, every one begun before the owner's last words,
  // which never heard them. Measured: the owner's second utterance went quiet while the turn their first one started
  // ran on, the provider never closed it, and this gate held the backstop for the whole 40s until the owner spoke
  // again. The resume then
  // closes the owner's turn, whose final reaches the running turn as its spoken record (`PlanCall.resume`, which lets
  // the same shape past its own floor). Any other work still holds. The owner's words are the last fragment carrying
  // words off the microphone: a blank one moves `heard` but is no words.
  // A resume already posted after them spent them, bar a retry still owed for the same silence.
  const words = activity.lastTranscribedMs;
  const resumed = activity.resumedAtMs;
  const fresh = resumed === undefined || (words !== undefined && words > resumed) || retryMs !== undefined;
  const exempt = fresh && words !== undefined && onlyTurnsBegunBefore({ activity, sinceMs: words });
  if (activityRows({ activity, nowMs }).length > 0 && !exempt) {
    return held("work-in-flight");
  }
  // The owner's code word outranks a wait said before it: "one sec. Over" is done.
  const over = endsOnOver({ text: activity.heardTail });
  const waits = muted ? asksInWordsToWait({ text: activity.heardTail }) : asksToWait({ text: activity.heardTail });
  if (!over && waits) {
    return held("words-ask-to-wait");
  }
  // A retry's silence was already judged the owner's whole quiet, so a late fragment of the same words holds it only briefly.
  const short = over || retryMs !== undefined;
  if (unanswered({ activity, afterMs: short ? RESUME_SOUND_QUIET_MS : RESUME_MS, heard, nowMs })) {
    return { kind: "due" };
  }
  return held("answered-or-not-quiet");
}

/**
 * Whether the work in flight is nothing but running Codex turns, every one begun strictly before `sinceMs`: no
 * delegation, pending tool, stray backend work, hand-off or continuation — every other source `activityRows` lists.
 *
 * @param activity the fold
 * @param sinceMs the instant the owner's last words arrived
 * @returns true only for that one shape
 */
function onlyTurnsBegunBefore({ activity, sinceMs }: { activity: VoiceActivity; sinceMs: number }): boolean {
  const otherWork =
    activity.delegations.size > 0 ||
    activity.tools.size > 0 ||
    activity.stray !== undefined ||
    activity.plan.handoff !== undefined ||
    activity.continuations.length > 0;
  const turns = [...activity.plan.turns.values()];
  return !otherWork && turns.length > 0 && turns.every((turn) => turn.sinceMs < sinceMs);
}
