/**
 * The owner's words on a voice call as the realtime session transcribes them, and the release rule that reads them:
 * whether a held answer may be handed to the voice now (`./talkPlanHeldAnswers.ts`). Split from that file, which sits
 * at its 300-line cap.
 *
 * The release rule is the owner's own two rulings for when the floor is the voice's, read off the transcript this
 * server is sent: {@link RESUME_MS} after their last words, the {@link RESUME_SOUND_QUIET_MS} after their code
 * word "over", and the {@link UNANSWERED_MS} backstop when their words trail off or ask to wait (`./waitAsk.ts`).
 */
import { endsOnOver } from "./overWord";
import { PLAN_CALL_LIMITS } from "./planCallContract";
import { paramString } from "./talkPlanProtocol";
import type { CallClock } from "./talkPlanStart";
import {
  closeUserUtteranceOnResume,
  foldUserUtterance,
  NO_USER_UTTERANCE,
  type TranscriptPhase,
  type UserUtteranceState,
  userUtteranceAfterResumeRefused,
  userUtteranceOpen,
} from "./talkPlanUtterance";
import { RESUME_MS, RESUME_SOUND_QUIET_MS, UNANSWERED_MS } from "./voiceActivity";
import { asksToWait } from "./waitAsk";

/** How much of the owner's words is kept for the wait and code-word reads: more than either reads. */
const HEARD_TAIL_CHARS = 200;

/**
 * Why a held answer may not be handed to the voice now, or `undefined` when it may. Pure: the instants are the
 * server's own reads of the realtime transcript, both sides.
 *
 * An utterance of the owner's still open holds it whatever the quiet since their last delta: an answer released five
 * seconds after a delta, 0.7s before the owner's "No, no, don't send it" closed, was handed over a draft the owner
 * was refusing.
 *
 * @param nowMs the instant judged at
 * @param heardAt when the owner was last transcribed, `undefined` when they have said nothing this call
 * @param heardTail the end of the owner's words as transcribed so far
 * @param heardUtteranceOpen an utterance of the owner's opened and not yet closed by its `done` (`./talkPlanUtterance.ts`)
 * @param voiceAt when the voice was last transcribed
 * @param blocked why the call itself takes no write now — ended, no thread, the owner's typed turn, another own write
 * @returns why it waits, or `undefined` once it may go
 */
export function heldAnswerRefusal({
  nowMs,
  heardAt,
  heardTail,
  heardUtteranceOpen,
  voiceAt,
  blocked,
}: {
  nowMs: number;
  heardAt: number | undefined;
  heardTail: string;
  heardUtteranceOpen: boolean;
  voiceAt: number | undefined;
  blocked: string | undefined;
}): string | undefined {
  if (blocked !== undefined) {
    return blocked;
  }
  if (heardUtteranceOpen) {
    return "the owner's utterance is still open";
  }
  if (voiceAt !== undefined && nowMs - voiceAt < PLAN_CALL_LIMITS.resumeQuietMs) {
    return "the voice is talking";
  }
  if (heardAt === undefined) {
    return undefined;
  }
  let quietMs = RESUME_MS;
  let why = "the owner is still talking";
  if (endsOnOver({ text: heardTail })) {
    quietMs = RESUME_SOUND_QUIET_MS;
  } else if (asksToWait({ text: heardTail })) {
    quietMs = UNANSWERED_MS;
    why = "the owner's words trail off or ask to wait";
  }
  if (nowMs - heardAt < quietMs) {
    return why;
  }
  return undefined;
}

/**
 * The words one `thread/realtime/transcript/*` notification of the owner's carries: a `delta` carries `delta`, a
 * `done` carries `text`.
 *
 * @param phase which notification it was, from its method
 * @param params the notification's params
 * @returns the words, `undefined` when it carried none
 */
export function transcriptTextOf({ phase, params }: { phase: TranscriptPhase; params: unknown }): string | undefined {
  const key = phase === "delta" ? "delta" : "text";
  return paramString({ key, params });
}

/** The owner's words on one call: the end of what they finished saying, what they are saying now, and whether they are mid-utterance. */
export class HeardWords {
  private readonly clock: CallClock;
  /** The end of the owner's finished utterances as transcribed, which the release rule reads for a trail-off or "over". */
  private finished = "";
  /** The owner's utterance still being transcribed, grown by each `delta` and replaced by its `done`. */
  private current = "";
  /** Whether an utterance of the owner's is open, and when their newest delta arrived (`./talkPlanUtterance.ts`). */
  private utterance: UserUtteranceState = NO_USER_UTTERANCE;

  /**
   * The owner's words on one call.
   *
   * @param clock the call's own time
   */
  constructor({ clock }: { clock: CallClock }) {
    this.clock = clock;
  }

  /**
   * The owner's words as the session transcribed them. A `delta` grows the utterance being transcribed and keeps it open;
   * its `done` carries the whole utterance as finally transcribed, which replaces what the deltas said (a `done`
   * reading "…, over there" must not leave a delta's "…, over" to free the floor in 2s), and closes it
   * whatever its text.
   *
   * @param atMs when the server took the notification
   * @param phase whether it was a `delta` or a `done`
   * @param text its words — a delta's new words, a done's whole utterance — `undefined` when it carried none
   * @returns true when it was a `done` with words in it: later words of the owner's, which supersede what they were answered
   */
  heard({ atMs, phase, text }: { atMs: number; phase: TranscriptPhase; text: string | undefined }): boolean {
    this.utterance = foldUserUtterance({ atMs, phase, state: this.utterance });
    if (phase === "done") {
      if (text !== undefined) {
        this.finished = `${this.finished} ${text}`.slice(-HEARD_TAIL_CHARS);
      }
      this.current = "";
      // A letter or a number, so whitespace or a zero-width character alone is no later words of the owner's: a blank `done`
      // closes their utterance but supersedes nothing.
      return text !== undefined && /[\p{L}\p{N}]/u.test(text);
    }
    if (text !== undefined) {
      this.current = `${this.current}${text}`.slice(-HEARD_TAIL_CHARS);
    }
    return false;
  }

  /**
   * The call took the page's resume, which it posts only once the owner's microphone has gone quiet: their open utterance is a
   * silence the provider never closed, so it holds nothing until their next delta reopens it
   * (`closeUserUtteranceOnResume`, `./talkPlanUtterance.ts`).
   *
   * @returns what puts the owner's utterance back should the session refuse the resume after all
   */
  resumeAccepted(): () => void {
    const before = this.utterance;
    const closed = closeUserUtteranceOnResume({ state: before });
    this.utterance = closed;
    return () => {
      this.utterance = userUtteranceAfterResumeRefused({ before, closed, now: this.utterance });
    };
  }

  /**
   * Whether an utterance of the owner's is open now, inside the lost-`done` ceiling.
   *
   * @returns true while the owner is mid-utterance
   */
  open(): boolean {
    return userUtteranceOpen({ nowMs: this.clock.nowMs(), state: this.utterance });
  }

  /**
   * The end of the owner's words so far, finished and current together, for the wait and code-word reads.
   *
   * @returns at most {@link HEARD_TAIL_CHARS} characters
   */
  tail(): string {
    return `${this.finished} ${this.current}`.trim().slice(-HEARD_TAIL_CHARS);
  }
}
