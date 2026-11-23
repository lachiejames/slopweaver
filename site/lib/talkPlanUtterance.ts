/**
 * Whether the owner's utterance is still open on a plan call: a `delta` of their transcript opened it and no `done`
 * has closed it yet. That, not the time since their last delta, is what says they still hold the floor, because the
 * transcript stalls mid-utterance while they keep talking.
 *
 * Measured on one call: the owner's bug report ran nearly two minutes, and the page's live text froze on its early
 * words for 72s while the owner talked on. The floor read 2s with no delta as quiet, so the triage clock's line was
 * handed to the voice over them; the voice answered it with "Send it, then." on a held draft they had not approved,
 * and a held answer was released 0.7s before their "No, no, don't send it" closed. Both instants are in that call
 * file, which `slopweaver talk calls` reads: the owner's segment `<turn-id>` and the `held-answer` line naming it.
 *
 * A lost `done` must not hold the floor for good, so the open state lapses {@link OPEN_UTTERANCE_MAX_MS} after the
 * newest delta: a backstop for a lost notification, never a claim that no utterance runs longer.
 */

/** How long after the owner's newest delta an utterance with no `done` stops holding the floor. */
export const OPEN_UTTERANCE_MAX_MS = 600_000;

/** Which realtime transcript notification of the owner's arrived: a `delta` grows the utterance, a `done` closes it. */
export type TranscriptPhase = "delta" | "done";

/** The owner's transcript lifecycle as the server has been sent it. */
export interface UserUtteranceState {
  /** A delta arrived and no `done` since. */
  readonly open: boolean;
  /** When the owner's newest delta arrived. */
  readonly lastDeltaMs: number | undefined;
}

/** Nothing of the owner's transcribed yet this call. */
export const NO_USER_UTTERANCE: UserUtteranceState = { lastDeltaMs: undefined, open: false };

/**
 * The owner's transcript state after one notification of theirs: a delta opens it, a `done` closes it, whatever its
 * text.
 *
 * @param atMs when the server took the notification
 * @param phase whether it was a `delta` or a `done`
 * @param state the state before it
 * @returns the state after it
 */
export function foldUserUtterance({
  atMs,
  phase,
  state,
}: {
  atMs: number;
  phase: TranscriptPhase;
  state: UserUtteranceState;
}): UserUtteranceState {
  if (phase === "done") {
    return { ...state, open: false };
  }
  return { ...state, lastDeltaMs: atMs, open: true };
}

/**
 * The owner's transcript state once the call has taken the page's resume: the page posts one only after the owner's
 * microphone has gone quiet (`resumeDueOf`, `./voiceActivity.ts`), so a delta with no `done` behind it is a silence
 * the provider never closed, not words still coming. Closed until their next delta reopens it, and never a worded
 * `done`: nothing of theirs is superseded by it. Without this, an answer Codex wrote 8s after the resume was taken stayed
 * held as "the owner's utterance is still open" for 41s, until they spoke again. Repro: `grep -e held-answer -e '"name":"resume"'
 * $SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`.
 *
 * @param state the state before the resume
 * @returns the state with no utterance of the owner's open
 */
export function closeUserUtteranceOnResume({ state }: { state: UserUtteranceState }): UserUtteranceState {
  return { ...state, open: false };
}

/**
 * The owner's transcript state once the session refused a resume that {@link closeUserUtteranceOnResume} had closed
 * it for: the voice was never asked to take its turn, so the state from before the resume comes back — unless a
 * notification of theirs arrived meanwhile, which already says where their utterance stands. A `failure("no session")`
 * hand-over that left it closed would put a later answer on the quiet rule over the owner's open words.
 *
 * @param before the state the resume closed
 * @param closed the state the resume wrote
 * @param now the state when the refusal came back
 * @returns the state to keep
 */
export function userUtteranceAfterResumeRefused({
  before,
  closed,
  now,
}: {
  before: UserUtteranceState;
  closed: UserUtteranceState;
  now: UserUtteranceState;
}): UserUtteranceState {
  if (now !== closed) {
    return now;
  }
  return before;
}

/**
 * Whether the owner holds the floor because their utterance is still open, lapsing {@link OPEN_UTTERANCE_MAX_MS}
 * after its newest delta so a lost `done` never holds it for good.
 *
 * @param nowMs the instant judged at
 * @param state the owner's transcript state
 * @returns true while an utterance of the owner's is open and inside the ceiling
 */
export function userUtteranceOpen({ nowMs, state }: { nowMs: number; state: UserUtteranceState }): boolean {
  return state.open && state.lastDeltaMs !== undefined && nowMs - state.lastDeltaMs < OPEN_UTTERANCE_MAX_MS;
}
