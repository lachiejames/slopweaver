/**
 * The state the orb draws from the voice activity fold, and the nudge on offer — split out of `./voiceActivity.ts`.
 * When the page should resume is `./voiceResumeDecision.ts`, which shares {@link unanswered}.
 */

import { plainReasonOf } from "./plainReason";
import { AWAITING_MODEL_WORDS, AWAITING_RETRY_WORDS, COMPACTING_WORDS } from "./responsesStep";
import {
  activityRows,
  type NudgeOffer,
  secondsBetween,
  type VoiceLink,
  type VoicePhase,
  type VoiceStatus,
} from "./voiceActivityRows";
import { END_SKEW_MS, STALL_MS, UNANSWERED_FORGET_MS, UNANSWERED_MS, type VoiceActivity } from "./voiceActivityState";
import { OWED_WORDS, voiceOwesTurn } from "./voiceOwed";
import { ownerCurrentOpenAtOf } from "./voiceOwnerTurns";
import { TALKING_STATUS, talkingOf } from "./voiceTalking";

/**
 * The state to draw.
 *
 * The voice having just stopped for the owner outranks everything live but its own sound: the transcript lags the audio,
 * so the speaking hold would otherwise read "speaking" through the very moment it went quiet for the owner. Then the voice
 * talking — it is plainly not ghosting — then the owner talking, then an error the
 * session reported, then a turn gone stale, then a turn in flight, then the owner's turn nothing has answered. A turn in
 * flight rides along as `detail` whatever the phase, so "one sec, pulling that up" over a running tool shows both.
 *
 * @param activity the fold
 * @param link where the connection is
 * @param outputLevel the voice's output level now, 0 to 1
 * @param micLevel the owner's microphone's level now, 0 to 1
 * @param micRms the owner's microphone's waveform RMS on the same sample, the second bar the owner must clear to read as talking
 * @param muted whether the session acknowledged the owner's mute
 * @param nowMs the same clock the fold was stamped on
 * @returns the status
 */
export function voiceStatusOf({
  activity,
  link,
  outputLevel,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  activity: VoiceActivity;
  link: VoiceLink;
  outputLevel: number;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): VoiceStatus {
  if (link !== "live") {
    return linkStatus({ link });
  }
  const rows = activityRows({ activity, nowMs });
  const stale = rows.find((row) => row.stale);
  const focus = rows.at(0);
  let detail: string | undefined;
  if (focus !== undefined) {
    detail = `${focus.words} · ${String(focus.seconds)}s`;
  }
  let why: string | undefined;
  if (activity.error !== undefined) {
    // Talking outranks an error, but not so far that its reason is never seen: it rides as the detail, said plainly,
    // the raw message carried beside it for the fold and never as the line itself.
    why = activity.error.message;
    detail = plainReasonOf({ why }).plain;
  }
  // Who is talking is `./voiceTalking.ts`'s, the same answer the cue gate holds a badge on.
  const talking = talkingOf({ activity, micLevel, micRms, muted, nowMs, outputLevel });
  if (talking !== undefined) {
    const shown = TALKING_STATUS[talking];
    if (shown.detail !== undefined) {
      return status({ detail: shown.detail, headline: shown.headline, phase: shown.phase });
    }
    return withWhy({ shown: status({ detail, headline: shown.headline, phase: shown.phase }), why });
  }
  const heard = activity.lastHeardMs;
  if (activity.error !== undefined) {
    return withWhy({ shown: status({ detail, headline: "error", phase: "error" }), why });
  }
  if (stale !== undefined) {
    const quiet = `${stale.words} · no update for ${String(stale.seconds)}s`;
    const nudge = nudgeOfferOf({ activity, nowMs });
    if (ownerTurnOpen({ activity, heard, nowMs })) {
      // A quiet turn says nothing while the owner is still talking over it: the orb listens and keeps the row as its detail.
      return { detail: quiet, headline: muted ? "muted" : "listening", nudge, phase: "listening", seconds: undefined };
    }
    return { detail: quiet, headline: "no update", nudge, phase: "stalled", seconds: stale.seconds };
  }
  if (focus !== undefined && focus.step?.kind === "awaiting" && focus.seconds * 1000 >= STALL_MS) {
    // A request known to be out to the model is slow, not stalled: the working face, its own seconds, and no nudge,
    // since stopping the turn throws that request and the owner's words in it away.
    const slow = `${focus.words} · no reply for ${String(focus.seconds)}s`;
    if (ownerTurnOpen({ activity, heard, nowMs })) {
      return {
        detail: slow,
        headline: muted ? "muted" : "listening",
        nudge: undefined,
        phase: "listening",
        seconds: undefined,
      };
    }
    return status({ detail: slow, headline: SLOW_MODEL_HEADLINE, phase: "working", seconds: focus.seconds });
  }
  if (focus !== undefined) {
    return status({
      detail,
      headline: focusHeadline({ words: focus.words }),
      phase: "working",
      seconds: focus.seconds,
    });
  }
  if (heard !== undefined && unanswered({ activity, afterMs: UNANSWERED_MS, heard, nowMs })) {
    const nudge = nudgeOfferOf({ activity, nowMs });
    if (ownerTurnOpen({ activity, heard, nowMs })) {
      // The floor is the owner's, and the voice is holding for the owner to finish: never ZZZ, which says nothing is coming.
      return {
        detail: OPEN_TURN_WORDS,
        headline: muted ? "muted" : "listening",
        nudge,
        phase: "listening",
        seconds: undefined,
      };
    }
    const seconds = secondsBetween({ from: heard, to: nowMs });
    return { detail: "no answer since you spoke", headline: "still waiting", nudge, phase: "stalled", seconds };
  }
  if (voiceOwesTurn({ activity, afterMs: UNANSWERED_MS, nowMs })) {
    // Not a stall: the quiet may be the owner's to break too, so the orb keeps listening and only offers the press.
    const headline = muted ? "muted" : "listening";
    const nudge = nudgeOfferOf({ activity, nowMs });
    return { detail: OWED_WORDS, headline, nudge, phase: "listening", seconds: undefined };
  }
  if (muted) {
    return status({ detail: undefined, headline: "muted", phase: "listening" });
  }
  return status({ detail: undefined, headline: "listening", phase: "listening" });
}

/**
 * The nudge on offer NOW, judged on the live fold — what the orb shows beside a stalled state, and what the press
 * re-checks before it sends, so a turn that moved between the render and the press is never nudged over. Never while
 * the page runs a tool (stopping its Codex turn mid-write hides what it wrote), never over GPT-Live work, which a
 * plan call has none of, and once per thing the owner said.
 *
 * @param activity the fold
 * @param nowMs the same clock the fold was stamped on
 * @returns `interrupt` for a Codex turn gone quiet, `ask` for a hand-off nothing picked up, the owner's words nothing
 *   answered or a turn the voice owes ({@link voiceOwesTurn}), else `undefined`
 */
export function nudgeOfferOf({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): NudgeOffer | undefined {
  const heard = activity.lastHeardMs;
  if (heard === undefined || activity.nudgedHeardMs === heard || activity.tools.size > 0) {
    return undefined;
  }
  const rows = activityRows({ activity, nowMs });
  if (rows.some((row) => !row.key.startsWith("c:") && row.key !== "handoff")) {
    return undefined;
  }
  if (rows.some((row) => row.stale && row.key.startsWith("c:"))) {
    return "interrupt";
  }
  if (rows.some((row) => row.stale)) {
    return "ask";
  }
  if (rows.length > 0) {
    return undefined;
  }
  if (
    unanswered({ activity, afterMs: UNANSWERED_MS, heard, nowMs }) ||
    voiceOwesTurn({ activity, afterMs: UNANSWERED_MS, nowMs })
  ) {
    return "ask";
  }
  return undefined;
}

/**
 * The status for a link that is not live. A reconnect is its own phase, so the orb says the call is coming back
 * rather than starting, so the owner knows that it is happening — and changes
 * colour and shape while it does.
 */
function linkStatus({ link }: { link: Exclude<VoiceLink, "live"> }): VoiceStatus {
  if (link === "failed") {
    return status({ detail: undefined, headline: "stopped", phase: "error" });
  }
  if (link === "connecting") {
    return status({ detail: undefined, headline: "connecting", phase: "connecting" });
  }
  if (link === "reconnecting") {
    return status({ detail: undefined, headline: "reconnecting", phase: "reconnecting" });
  }
  return status({ detail: undefined, headline: "talk", phase: "off" });
}

/** A status with no nudge on offer, its age unset unless given. */
function status({
  phase,
  headline,
  detail,
  seconds,
}: {
  phase: VoicePhase;
  headline: string;
  detail: string | undefined;
  seconds?: number;
}): VoiceStatus {
  return { detail, headline, nudge: undefined, phase, seconds };
}

/** A status carrying the session's raw error beside its plain detail, or the status as it was when there is none. */
function withWhy({ shown, why }: { shown: VoiceStatus; why: string | undefined }): VoiceStatus {
  if (why === undefined) {
    return shown;
  }
  return { ...shown, why };
}

/**
 * The headline once a Codex turn has waited {@link STALL_MS} on the model. MEASURED: one call's orb read "working ·
 * 140s", then "no update" over the stalled face offering to nudge Codex, while the model's first reply took 233s to
 * 346s with no tool running.
 */
export const SLOW_MODEL_HEADLINE = "model slow";

/** The headline for a turn in flight: its step, shortened. */
function focusHeadline({ words }: { words: string }): string {
  if (words.startsWith("running")) {
    return "checking";
  }
  if (words === AWAITING_MODEL_WORDS || words === AWAITING_RETRY_WORDS) {
    return "waiting";
  }
  if (words === "writing") {
    return "answering";
  }
  if (words === "reasoning") {
    return "reasoning";
  }
  if (words === COMPACTING_WORDS) {
    return "compacting";
  }
  return "working";
}

/**
 * Whether the voice owes the owner an answer it has not given, long enough to be a finished silence — not forever.
 * It owes one after the owner's last fragment, and again after a Codex turn COMPLETES after it, whose answer is the
 * voice's to speak:
 * a "one sec" said before the turn ended does not pay that, so a turn that comes back and is never voiced reads
 * "still waiting", never "listening". An interrupted turn owes nothing — the voice relays none. The resume reads it
 * too (`resumeDecisionOf`, `./voiceResumeDecision.ts`), sooner.
 *
 * @param heard when the owner's last words were heard
 * @param afterMs how long the quiet must run before it is owed
 * @returns true while that quiet is owed and not yet forgotten
 */
export function unanswered({
  activity,
  heard,
  nowMs,
  afterMs,
}: {
  activity: VoiceActivity;
  heard: number;
  nowMs: number;
  afterMs: number;
}): boolean {
  const completed = activity.plan.lastCompletedMs;
  if (completed !== undefined && completed >= heard) {
    const spoke = activity.lastSpokeMs;
    if (spoke !== undefined && spoke >= heard && spoke >= completed - END_SKEW_MS) {
      return false;
    }
    return quietOwed({ afterMs, nowMs, sinceMs: completed });
  }
  const answered = activity.lastAnsweredMs;
  if (answered !== undefined && answered >= heard) {
    return false;
  }
  return quietOwed({ afterMs, nowMs, sinceMs: heard });
}

/** What the orb says while a turn of the owner's is still open and the owner's last words have gone quiet. */
export const OPEN_TURN_WORDS = "waiting for you to finish";

/**
 * Whether a turn of the owner's is still open — a segment of it arrived and its final has not — so the quiet after
 * the owner's words is inside their turn, not one the voice owes an answer to. The server holds the voice's answer on
 * exactly that state (the utterance is still open), and its transcript stalls mid-utterance while the owner keeps
 * talking, so the time since their last fragment cannot tell a pause from an end.
 *
 * Measured on a recorded call: a turn opened and finalised 50s apart, its partials 40s apart; a Codex turn completed
 * mid-turn and the orb drew ZZZ 12s on ({@link UNANSWERED_MS}) while the server held that answer and the owner's
 * microphone read loud. Repro, from the home:
 * `grep -nE '<turn-id>|stalled \(badge\) played|held-answer|"name":"codex"' talk/calls/<call-id>-*.jsonl`.
 *
 * Bounded so a final that never came cannot hide ZZZ for good. The open turn must be the one the owner is in now, no
 * later turn of the owner's ended past it ({@link ownerCurrentOpenAtOf}), so an older turn whose final was lost cannot
 * hold a later one's quiet. It lapses {@link UNANSWERED_FORGET_MS} after that turn's newest segment — the horizon the orb already
 * stops calling any quiet owed at, and the one a held rollover waits an open turn out for (`ROLLOVER_OWED_HOLD_MS`,
 * `./callRollover.ts`). That is a judgement, not a measurement (the longest gap measured inside one turn is 40s), and a
 * deliberate trade: a turn of the owner's silent past it may read ZZZ, chosen over a lost final hiding a dead turn
 * with no end. It ends once the page resumed or the owner nudged for their latest words, both of which say the words
 * are done — a resume as it is posted, so one whose post is lost can read ZZZ before the server closes the
 * turn — and it never withdraws the nudge, offered exactly as without it. An open turn is held whether or not it
 * carries words, so an empty one the provider never ends reads listening until that same horizon. It needs no heard
 * words, since the owner's transcript and their turn's segments arrive on separate events. Only a
 * plan call folds the owner's segments (`site/components/voice/planWiringEffects.ts`), so a GPT-Live call never has one open.
 */
function ownerTurnOpen({
  activity,
  heard,
  nowMs,
}: {
  activity: VoiceActivity;
  heard: number | undefined;
  nowMs: number;
}): boolean {
  const openAtMs = ownerCurrentOpenAtOf({ turns: activity.owner });
  if (openAtMs === undefined) {
    return false;
  }
  if (heard !== undefined && (activity.resumedHeardMs === heard || activity.nudgedHeardMs === heard)) {
    return false;
  }
  return nowMs - openAtMs < UNANSWERED_FORGET_MS;
}

/** A silence long enough to be owed an answer, and not so long it is the owner's as much as the voice's. */
function quietOwed({ nowMs, sinceMs, afterMs }: { nowMs: number; sinceMs: number; afterMs: number }): boolean {
  const quiet = nowMs - sinceMs;
  return quiet >= afterMs && quiet < UNANSWERED_FORGET_MS;
}
