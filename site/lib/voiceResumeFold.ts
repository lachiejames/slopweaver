/**
 * What the activity fold (`./voiceActivity.ts`) records of the page's resumes: which silence of the owner's was
 * resumed, when, how many times, and whether a refusal a moment clears has re-armed it (`resumeDueOf` reads all four).
 */
import type { TurnTaking } from "./voiceTurnTaking";

/**
 * How many times one silence of the owner's may be resumed again after the server refused it only because someone was
 * transcribed a moment ago (`transientResumeRefusal`, `site/components/voice/planWiringLines.ts`), each
 * `RESUME_SOUND_QUIET_MS` after the refusal. Without a retry, the one resume for the owner's words refused "someone is
 * talking" spent the silence, and the turn sat until the owner spoke again 12s after their words. Repro:
 * `grep '"name":"resume"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`. Two is a judgement: enough for the voice's own late
 * transcript, few enough that a floor that stays busy is left alone.
 */
export const RESUME_RETRIES = 2;

/** The fold's resume fields. */
export interface ResumeFields {
  /** The `lastHeardMs` the page resumed for (`resumeDueOf`), so one silence is resumed once. */
  readonly resumedHeardMs: number | undefined;
  /**
   * When the page last asked for a resume. The owner's words arriving after it re-arm one only when their microphone
   * sounded since: a fragment of the words it answered can land after the ask (0.7s after it on a live call) and is
   * not a new silence.
   */
  readonly resumedAtMs: number | undefined;
  /** How many resumes the page has posted for this silence of the owner's, bounding the retries ({@link RESUME_RETRIES}). */
  readonly resumeAttempts: number;
  /** When the server last refused a resume as transient, so the retry waits a quiet after it. */
  readonly resumeRetryMs: number | undefined;
  /**
   * The number of the newest post for this silence, `undefined` once a new silence opens: a refusal re-arms only the
   * post it answers. The page posts again before an earlier answer is back, so without it a stale refusal re-armed a
   * newer silence, resuming one already taken a second time, or a fresh one after 2s rather than 5s.
   */
  readonly resumePost: number | undefined;
}

/** No resume yet. */
export const NO_RESUME: ResumeFields = {
  resumeAttempts: 0,
  resumePost: undefined,
  resumeRetryMs: undefined,
  resumedAtMs: undefined,
  resumedHeardMs: undefined,
};

/**
 * The resume fields once the owner's words arrive. The tail of words already resumed for keeps that resume, and a
 * retry still owed stays owed; new sound from the owner since the resume opens a new silence, with its own retries.
 *
 * @param activity the fold's resume fields, and who last made a sound
 * @param nowMs when the owner's words arrived
 * @returns the resume fields after them
 */
export function resumeOnHeard({
  activity,
  nowMs,
}: {
  activity: ResumeFields & { readonly turn: Pick<TurnTaking, "owner"> };
  nowMs: number;
}): Omit<ResumeFields, "resumedAtMs"> {
  const { owner } = activity.turn;
  const resumedAt = activity.resumedAtMs;
  if (resumedAt === undefined || (owner !== undefined && owner.lastMs > resumedAt)) {
    return { resumeAttempts: 0, resumePost: undefined, resumeRetryMs: undefined, resumedHeardMs: undefined };
  }
  const { resumeAttempts, resumePost, resumeRetryMs } = activity;
  return {
    resumeAttempts,
    resumePost,
    resumeRetryMs,
    resumedHeardMs: resumeRetryMs === undefined ? nowMs : undefined,
  };
}

/**
 * The resume fields once the page posts a resume for the owner's newest words, or once the server refused it as transient —
 * re-armed while the silence has retries left, and left spent after, since a floor that stays busy is not one to press.
 * A refusal of any post but this silence's newest changes nothing.
 *
 * @param activity the fold's resume fields, with the owner's newest words' instant
 * @param event which happened
 * @param nowMs when it happened
 * @param post the number of the post posted or refused
 * @returns the resume fields after it
 */
export function resumeOnPost({
  activity,
  event,
  nowMs,
  post,
}: {
  activity: ResumeFields & { readonly lastHeardMs: number | undefined };
  event: "resumed" | "resume-refused-transient";
  nowMs: number;
  post: number;
}): ResumeFields {
  if (event === "resumed") {
    const resumeAttempts = activity.resumeAttempts + 1;
    return {
      resumeAttempts,
      resumePost: post,
      resumeRetryMs: undefined,
      resumedAtMs: nowMs,
      resumedHeardMs: activity.lastHeardMs,
    };
  }
  if (post !== activity.resumePost || activity.resumeAttempts > RESUME_RETRIES) {
    return activity;
  }
  return { ...activity, resumeRetryMs: nowMs, resumedHeardMs: undefined };
}
