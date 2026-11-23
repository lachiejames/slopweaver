/**
 * The page's record of WHY a silence of the owner's went unresumed: once their words have gone unanswered for the
 * resume's own quiet ({@link RESUME_MS}) and the resume is still held, the gate holding it is written to the call's
 * log once — and once more for each different gate that takes over the same silence, never twice for one. Pure; the
 * page's clock feeds it twelve times a second and writes what it emits (`site/components/voice/useVoiceActivity.ts`).
 *
 * Why it exists: none of the eight transcription-fidelity test calls posted a resume through 20s gaps in which the provider never
 * ended the owner's turn, while the owner's real calls post them. Every resume post writes a `resume` line, refused
 * or not, so the page never judged one due — and nothing on record said which gate held it. The microphone gate was
 * measured clear offline; the rest read live state only a running page has. Repro,
 * counting the `resume` lines per call file (zero for a call that never judged one due):
 * `grep -c '"name":"resume"' $SLOPWEAVER_HOME/talk/calls/{<call-a>,<call-b>,<call-c>}-*.jsonl`.
 *
 * A silence the voice has spoken into since the owner's words or last sound (`lastSpokeMs`) is answered, so it is
 * never traced. Each sample is judged as it stands: a voice transcript landing after a line was written leaves the
 * line, still true of the 5s that held the resume.
 */

import { activityRows } from "./voiceActivityRows";
import { RESUME_MS, UNANSWERED_FORGET_MS, type VoiceActivity } from "./voiceActivityState";
import type { ResumeBlocker, ResumeDecision } from "./voiceResumeDecision";

/**
 * What the trace has already written: the silence (the owner's last words' instant) and every gate it named for it.
 * Every gate, not the last one, so a gate flickering against another — the owner's microphone crossing its bar sample
 * to sample — writes each once rather than a line per flip: at most one line per gate per silence.
 */
export interface ResumeTraceState {
  readonly heardMs: number | undefined;
  readonly written: ReadonlySet<ResumeBlocker>;
}

/** Nothing written yet. */
export const NO_RESUME_TRACE: ResumeTraceState = { heardMs: undefined, written: new Set() };

/** The gates that are not a stall: nothing to answer, or this silence was already asked about. */
const NOT_A_STALL: ReadonlySet<ResumeBlocker> = new Set(["nothing-heard", "already-resumed", "already-nudged"]);

/** At most this many in-flight rows are named on one line. */
const ROWS_NAMED = 3;

/** One held silence, as the call's log records it: the gate, and the instants that gate reads, as ages. */
export interface ResumeGateObservation {
  readonly blocker: ResumeBlocker;
  readonly heardAgoMs: number;
  /** Since the output meter last heard the voice, `undefined` when it never has. */
  readonly voiceSoundAgoMs: number | undefined;
  /** Since the owner's microphone last read as them talking, `undefined` when it never has. */
  readonly ownerSoundAgoMs: number | undefined;
  /** Since the voice's last finished turn, `undefined` with none. */
  readonly voiceFinalAgoMs: number | undefined;
  readonly micLevel: number;
  readonly micRms: number;
  readonly muted: boolean;
  readonly tools: number;
  /** The keys of the work rows in flight, the first {@link ROWS_NAMED}. */
  readonly rows: readonly string[];
}

/** Milliseconds from an instant to now, `undefined` for no instant. */
function agoMs({ atMs, nowMs }: { atMs: number | undefined; nowMs: number }): number | undefined {
  return atMs === undefined ? undefined : nowMs - atMs;
}

/**
 * Fold one sample's resume decision into the trace.
 *
 * @param state what has been written so far
 * @param activity the fold the decision was judged on
 * @param decision the resume decision on this sample
 * @param micLevel the owner's microphone spectral level on this sample
 * @param micRms the owner's microphone waveform RMS on this sample
 * @param muted whether the owner is muted
 * @param nowMs the same clock the fold was stamped on
 * @returns the next state, and the observation to write when this sample is a new one
 */
export function foldResumeTrace({
  state,
  activity,
  decision,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  state: ResumeTraceState;
  activity: VoiceActivity;
  decision: ResumeDecision;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): { readonly state: ResumeTraceState; readonly observation: ResumeGateObservation | undefined } {
  const unchanged = { observation: undefined, state };
  const heard = activity.lastHeardMs;
  if (decision.kind === "due" || heard === undefined || NOT_A_STALL.has(decision.blocker)) {
    return unchanged;
  }
  const quietMs = nowMs - heard;
  // Answered in words: the voice's transcript at or after the owner's words, or after their last sound when their
  // words' last fragment lands late. A meter-only answer is NOT this, so it stays traced.
  const spoke = activity.lastSpokeMs;
  const ownerSoundMs = activity.turn.owner?.lastMs;
  const answered = spoke !== undefined && (spoke >= heard || (ownerSoundMs !== undefined && spoke >= ownerSoundMs));
  if (quietMs < RESUME_MS || quietMs >= UNANSWERED_FORGET_MS || answered) {
    return unchanged;
  }
  const sameSilence = state.heardMs === heard;
  if (sameSilence && state.written.has(decision.blocker)) {
    return unchanged;
  }
  const before: readonly ResumeBlocker[] = sameSilence ? [...state.written] : [];
  const observation: ResumeGateObservation = {
    blocker: decision.blocker,
    heardAgoMs: quietMs,
    micLevel,
    micRms,
    muted,
    ownerSoundAgoMs: agoMs({ atMs: activity.turn.owner?.lastMs, nowMs }),
    rows: activityRows({ activity, nowMs })
      .slice(0, ROWS_NAMED)
      .map((row) => row.key),
    tools: activity.tools.size,
    voiceFinalAgoMs: agoMs({ atMs: activity.lastVoiceFinal?.atMs, nowMs }),
    voiceSoundAgoMs: agoMs({ atMs: activity.turn.voice?.lastMs, nowMs }),
  };
  return { observation, state: { heardMs: heard, written: new Set([...before, decision.blocker]) } };
}
