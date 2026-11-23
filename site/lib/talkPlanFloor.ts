/**
 * Who holds the floor of a plan call, judged off one snapshot of its state: why each of the server's own writes —
 * a nudge, a look line, a write that waits for a clear floor, a write that cuts in, a rollover — may not go now. Pure,
 * so `PlanCall` (`./talkPlanCallNotifications.ts`) only gathers the snapshot and the order of every check reads in one place.
 */
import { PLAN_CALL_LIMITS } from "./planCallContract";

/** A plan call's state at one instant, as the floor checks read it. */
export interface PlanFloor {
  readonly nowMs: number;
  readonly ended: boolean;
  readonly endedReason: string | undefined;
  readonly threadId: string | undefined;
  /** A nudge's request is unanswered. */
  readonly nudging: boolean;
  /** A "having a look" line's request is unanswered. */
  readonly looking: boolean;
  /** An acknowledgement's request is unanswered. */
  readonly acking: boolean;
  /** A resume's request is unanswered. */
  readonly resuming: boolean;
  /** A send outcome's request is unanswered. */
  readonly announcing: boolean;
  /** A meeting line's request is unanswered. */
  readonly announcingMeeting: boolean;
  /** A window notice's request is unanswered: a drift line or an ISO nudge. */
  readonly announcingWindowNotice: boolean;
  /** A completion correction's request is unanswered (`./talkPlanCompletionCorrection.ts`). */
  readonly correctingCompletion: boolean;
  /** A Codex turn's outcome line's request is unanswered (`./talkPlanTurnOutcome.ts`). */
  readonly reportingTurnOutcome: boolean;
  /** The owner's typed turn's request is unanswered, or the voice's answer to it has not been seen yet. */
  readonly typingIn: boolean;
  /** Tool calls waiting on the page. */
  readonly pendingTools: number;
  /** The thinking model's messages held off the voice until the owner finishes, or being handed over (`./talkPlanHeldAnswers.ts`). */
  readonly heldAnswers: number;
  /** Codex turns started and not completed. */
  readonly runningTurns: number;
  /** Requests to the app-server unanswered. */
  readonly waitingRequests: number;
  /** When the realtime session last transcribed the owner or the voice. */
  readonly lastTranscribedMs: number | undefined;
  /** When the realtime session last transcribed the owner, never the voice. */
  readonly lastHeardMs: number | undefined;
  /** An utterance of the owner's opened by a delta and not yet closed by its `done` (`./talkPlanUtterance.ts`). */
  readonly heardUtteranceOpen: boolean;
  readonly lastNudgeMs: number | undefined;
  readonly lastLookMs: number | undefined;
  readonly lastAckMs: number | undefined;
  readonly lastResumeMs: number | undefined;
  /** When one of the server's own lines was last taken: the session answers before the voice has said it. */
  readonly lastOwnLineMs: number | undefined;
  /** When the voice was last handed the thinking model's held messages, which it says within a second or two. */
  readonly lastVoicedMs: number | undefined;
  readonly lastTurnEndedMs: number | undefined;
}

/** A condition, and the refusal it gives when it holds. */
export type FloorCheck = readonly [boolean, string];

/**
 * The refusal a clear-floor write gets while the thinking model's messages wait for the owner: one constant, because
 * `PlanCall.resume` reads it as "every check ahead of it is clear, so the owed answer can go instead".
 */
export const HELD_ANSWERS_REFUSAL = "what Codex wrote is waiting for the owner to finish";

/**
 * The refusal a write gets while someone was transcribed a moment ago: the one refusal a moment clears by itself, so
 * the page retries a resume it gave (`transientResumeRefusal`, `site/components/voice/planWiringLines.ts`).
 */
export const TALKING_REFUSAL = "someone is talking";

/**
 * Whether an instant the call recorded is less than `ms` before the snapshot.
 *
 * @param floor the snapshot
 * @param since the instant, `undefined` when it never happened
 * @returns false for an instant that never happened
 */
export function floorWithin({
  floor,
  since,
  ms,
}: {
  floor: PlanFloor;
  since: number | undefined;
  ms: number;
}): boolean {
  return since !== undefined && floor.nowMs - since < ms;
}

/**
 * The refusal of the first check that holds.
 *
 * @param checks tried in order
 * @returns the refusal, or `undefined` when none holds
 */
function firstHeld({ checks }: { checks: readonly FloorCheck[] }): string | undefined {
  return checks.find(([held]) => held)?.[1];
}

/**
 * The checks every write opens with: the call ended, has no thread, or is being handed the owner's typed turn — no line of
 * the server's own goes in between the owner's words and the voice's answer to them.
 *
 * @param floor the snapshot
 * @returns the three checks
 */
function callChecks({ floor }: { floor: PlanFloor }): readonly FloorCheck[] {
  return [
    [floor.ended, `the call has ended: ${String(floor.endedReason)}`],
    [floor.threadId === undefined, "the call has no thread yet"],
    [floor.typingIn, "the owner's typed turn is being handed to the voice"],
  ];
}

/**
 * The unasked lines whose chime leads them by `ANNOUNCE_LEAD_MS` (`./announceCue.ts`): from the claim until the line
 * is written, nothing else of the server's may go in, or the chime would introduce somebody else's words.
 *
 * @param floor the snapshot
 * @returns the three checks
 */
function heraldChecks({ floor }: { floor: PlanFloor }): readonly FloorCheck[] {
  return [
    [floor.announcing, "a send outcome is being handed over"],
    [floor.announcingMeeting, "a meeting line is being said"],
    [floor.announcingWindowNotice, "a drift line, an ISO nudge or a steer-risk line is being said"],
    [floor.correctingCompletion, "a correction of the voice's own line is being said"],
    [floor.reportingTurnOutcome, "a Codex turn's outcome is being said"],
  ];
}

/**
 * Why a once-only line whose herald has just rung may not be written after all: the owner's utterance opened, or someone
 * started talking, during the lead. The rest of the floor was read before the herald, and the line's
 * own busy flag has held every other own line off since, so reading it whole again would refuse the line itself.
 *
 * @param floor the snapshot once the lead is up
 * @returns the reason, or `undefined` when the line may still go
 */
export function leadRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  const talking = floorWithin({ floor, ms: PLAN_CALL_LIMITS.resumeQuietMs, since: floor.lastTranscribedMs });
  return firstHeld({
    checks: [
      [floor.heardUtteranceOpen, "the owner's utterance is still open"],
      [talking, TALKING_REFUSAL],
    ],
  });
}

/**
 * Why a write that waits for a clear floor may not be sent now, or `undefined` when it may: the call ended or has no
 * thread, the owner's utterance is still open (when the caller holds for it), someone is talking, the caller's `own` checks,
 * or a nudge, a look line, a resume, a heralded line, Codex's words voiced or held for the owner to finish, a tool call or a
 * Codex turn holds it.
 *
 * The owner's open utterance is the caller's choice, never a default, because one write must ignore it: a resume is the
 * backstop for a silence the provider has not closed, and a lost `done` holding it would leave the owner in that silence.
 * Every other clear-floor write holds — measured, the triage clock's line handed over 72s of
 * the owner's words whose transcript had stalled let the voice answer it with "Send it, then." on a draft the owner never approved.
 *
 * A running Codex turn is the caller's choice too, for the same one write: a resume over a turn begun before the
 * owner's latest words, which that turn never heard (`./talkPlanResumeOverTurn.ts`). Every other write holds.
 *
 * @param floor the snapshot
 * @param openUtterance whether the owner's still-open utterance holds this write, or only the transcript's last 2s does
 * @param own the caller's checks, tried in order after "someone is talking"
 * @param runningTurn whether a Codex turn still running holds this write
 * @returns the refusal in a sentence the page writes to the call's log
 */
export function floorRefusal({
  floor,
  openUtterance,
  own,
  runningTurn,
}: {
  floor: PlanFloor;
  openUtterance: "hold" | "ignore";
  own: readonly FloorCheck[];
  runningTurn: "hold" | "ignore";
}): string | undefined {
  const { lookGapMs, nudgeGapMs, nudgeSettleMs, resumeQuietMs } = PLAN_CALL_LIMITS;
  const within = ({ ms, since }: { ms: number; since: number | undefined }): boolean =>
    floorWithin({ floor, ms, since });
  return firstHeld({
    checks: [
      ...callChecks({ floor }),
      [openUtterance === "hold" && floor.heardUtteranceOpen, "the owner's utterance is still open"],
      [within({ ms: resumeQuietMs, since: floor.lastTranscribedMs }), TALKING_REFUSAL],
      ...own,
      [floor.nudging || within({ ms: nudgeGapMs, since: floor.lastNudgeMs }), "a nudge is being said"],
      [floor.looking || within({ ms: lookGapMs, since: floor.lastLookMs }), "a look line is being said"],
      [floor.acking || within({ ms: lookGapMs, since: floor.lastAckMs }), "an acknowledgement is being said"],
      [floor.resuming || within({ ms: lookGapMs, since: floor.lastResumeMs }), "it was just asked to take its turn"],
      ...heraldChecks({ floor }),
      [within({ ms: lookGapMs, since: floor.lastOwnLineMs }), "one of its own lines was just handed over"],
      [within({ ms: lookGapMs, since: floor.lastVoicedMs }), "the voice is saying what Codex just wrote"],
      [floor.heldAnswers > 0, HELD_ANSWERS_REFUSAL],
      [floor.pendingTools > 0, "a tool call is still running"],
      [runningTurn === "hold" && floor.runningTurns > 0, "a Codex turn is still working on the owner's words"],
      [
        within({ ms: nudgeSettleMs, since: floor.lastTurnEndedMs }),
        "Codex just finished, and the voice is about to answer",
      ],
    ],
  });
}

/**
 * Why a write that cuts in may not be sent now, or `undefined` when it may: only the call ending, no thread, or
 * another of the server's own writes still being sent holds it — never someone talking or work running.
 *
 * @param floor the snapshot
 * @returns the refusal in a sentence the page writes to the call's log
 */
export function ownWriteRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  return firstHeld({
    checks: [
      ...callChecks({ floor }),
      [floor.announcingMeeting, "another meeting line is being sent"],
      [floor.announcingWindowNotice, "a drift line, an ISO nudge or a steer-risk line is being sent"],
      [floor.nudging, "a nudge is being said"],
      [floor.looking, "a look line is being sent"],
      [floor.acking, "an acknowledgement is being sent"],
      [floor.resuming, "it is being asked to take its turn"],
      [floor.announcing, "a send outcome is being handed over"],
      [floor.correctingCompletion, "a correction of the voice's own line is being sent"],
      [floor.reportingTurnOutcome, "a Codex turn's outcome is being sent"],
    ],
  });
}

/**
 * Why the correction of a done claim or fleet promise the voice just made may not be said now, or `undefined` when it may. It follows
 * the voice's own sentence, so the voice having just spoken never holds it — only the call ending, no thread, the owner's
 * typed turn, the owner's words (still open, or heard inside {@link PLAN_CALL_LIMITS.resumeQuietMs}) or another of the
 * server's own writes being sent. A Codex turn running never holds it: a fixed sentence goes in as an acknowledgement
 * does, and one held behind work is heard long after the line it corrects.
 *
 * @param floor the snapshot
 * @returns the refusal in a sentence the call's log names
 */
export function completionCorrectionRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  const hisWords = floorWithin({ floor, ms: PLAN_CALL_LIMITS.resumeQuietMs, since: floor.lastHeardMs });
  return firstHeld({
    checks: [
      ...callChecks({ floor }),
      [floor.heardUtteranceOpen, "the owner's utterance is still open"],
      [hisWords, "the owner is talking"],
      [floor.announcingMeeting, "a meeting line is being sent"],
      [floor.announcingWindowNotice, "a drift line, an ISO nudge or a steer-risk line is being sent"],
      [floor.nudging, "a nudge is being said"],
      [floor.looking, "a look line is being sent"],
      [floor.acking, "an acknowledgement is being sent"],
      [floor.resuming, "it is being asked to take its turn"],
      [floor.announcing, "a send outcome is being handed over"],
      [floor.reportingTurnOutcome, "a Codex turn's outcome is being sent"],
    ],
  });
}

/**
 * Why a "having a look" line may not be sent now, or `undefined` when it may. A line already written is spoken ~5s
 * later, so the voice has not said it yet: a look line inside {@link PLAN_CALL_LIMITS.lookGapMs} of one would be
 * queued straight behind it. A send outcome, meeting, drift or ISO line being handed holds it too: its chime is
 * already playing, and a look line written inside the lead would be what the chime introduced.
 *
 * @param floor the snapshot
 * @returns the refusal in a sentence the page writes to the call's log
 */
export function lookRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  const { lookGapMs, nudgeSettleMs } = PLAN_CALL_LIMITS;
  const within = ({ ms, since }: { ms: number; since: number | undefined }): boolean =>
    floorWithin({ floor, ms, since });
  return firstHeld({
    checks: [
      ...callChecks({ floor }),
      ...heraldChecks({ floor }),
      [floor.nudging || within({ ms: lookGapMs, since: floor.lastNudgeMs }), "a nudge is being said"],
      [within({ ms: lookGapMs, since: floor.lastVoicedMs }), "the voice is saying what Codex just wrote"],
      [
        within({ ms: nudgeSettleMs, since: floor.lastTurnEndedMs }),
        "Codex just finished, and the voice is about to answer",
      ],
      [floor.looking, "a look line is already being sent"],
      [within({ ms: lookGapMs, since: floor.lastLookMs }), "it said it was looking a moment ago"],
      [floor.acking || within({ ms: lookGapMs, since: floor.lastAckMs }), "it said it was on it a moment ago"],
    ],
  });
}

/**
 * Why an acknowledgement of a hand-off may not be sent now, or `undefined` when it may: every check a look line
 * makes, with a look line itself among them — "having a look" already said it, and a line being handed over, its
 * chime's lead included, is one more line for the voice to say — and a resume just handed. A Codex turn running is
 * not one: it is the hand-off being acknowledged.
 *
 * @param floor the snapshot
 * @returns the refusal in a sentence a test can name
 */
export function ackRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  const asLook = lookRefusal({ floor });
  if (asLook !== undefined) {
    return asLook;
  }
  const resumed = floorWithin({ floor, ms: PLAN_CALL_LIMITS.lookGapMs, since: floor.lastResumeMs });
  return firstHeld({ checks: [[floor.resuming || resumed, "it was just asked to take its turn"]] });
}

/**
 * The checks only the page's press over a promise makes: it is unasked, so a line whose chime is already playing
 * holds it, and so does a promise already kept. Otherwise the voice says "On it.", Codex answers, the answer is handed
 * over and the voice begins saying it — then the page, lagging, presses over the "On it." mid-answer, the console
 * starts a fresh turn, and the voice says the same answer twice. Repro: `grep -e '"name":"nudge"' -e
 * '"name":"owed-start"' -e held-answer $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl` over a call where the voice repeated
 * itself. A handed answer newer than the owner's newest words is the
 * promise kept, whatever the page saw; someone transcribed inside {@link PLAN_CALL_LIMITS.resumeQuietMs} is the voice
 * still saying one.
 *
 * @param floor the snapshot
 * @returns the checks, in order
 */
function promiseChecks({ floor }: { floor: PlanFloor }): readonly FloorCheck[] {
  const voiced = floor.lastVoicedMs;
  const heard = floor.lastHeardMs;
  const handedSinceOwner = voiced !== undefined && (heard === undefined || voiced >= heard);
  // An answer waiting or being handed over counts as handed: `lastVoicedMs` is stamped only once the session confirms
  // it, after the voice may already be saying it.
  return [
    ...heraldChecks({ floor }),
    [floor.heldAnswers > 0, "Codex's answer is being handed to the voice"],
    [handedSinceOwner, "the voice was handed Codex's answer after the owner's newest words"],
    [floorWithin({ floor, ms: PLAN_CALL_LIMITS.resumeQuietMs, since: floor.lastTranscribedMs }), TALKING_REFUSAL],
  ];
}

/**
 * Why a nudge may not be sent now, or `undefined` when it may. The owner's own press cuts in whatever is being said; the
 * page's press over a promise is unasked, so it makes {@link promiseChecks} too.
 *
 * @param floor the snapshot
 * @param promised whether the page pressed it over a promise, rather than the owner
 * @returns the refusal in a sentence the page shows
 */
export function nudgeRefusal({ floor, promised }: { floor: PlanFloor; promised: boolean }): string | undefined {
  const { nudgeGapMs, nudgeSettleMs } = PLAN_CALL_LIMITS;
  const promise = promised ? promiseChecks({ floor }) : [];
  return firstHeld({
    checks: [
      ...callChecks({ floor }),
      ...promise,
      [floor.nudging, "a nudge is already being sent"],
      [floor.pendingTools > 0, "a tool call is still running; stopping Codex now could hide what it did"],
      [
        floorWithin({ floor, ms: nudgeSettleMs, since: floor.lastTurnEndedMs }),
        "Codex just finished, and the voice is about to answer",
      ],
      [floorWithin({ floor, ms: nudgeGapMs, since: floor.lastNudgeMs }), "it was nudged a moment ago"],
    ],
  });
}

/**
 * Why the floor is not free for a rollover, or `undefined` when it is: the owner's utterance still open, anyone transcribed inside
 * {@link PLAN_CALL_LIMITS.rolloverQuietMs}, a Codex turn running or just ended, a tool call waiting on the page, any
 * request of the server's unanswered, a line of its own being said or just said, or Codex's words held for the owner to
 * finish. The same signals a write waiting
 * for a clear floor reads, over a longer quiet: a rollover in the middle of any of them is a cut the owner would notice.
 *
 * @param floor the snapshot
 * @returns what holds the floor, in a sentence a test can name
 */
export function rolloverRefusal({ floor }: { floor: PlanFloor }): string | undefined {
  const quiet = PLAN_CALL_LIMITS.rolloverQuietMs;
  const within = ({ since }: { since: number | undefined }): boolean => floorWithin({ floor, ms: quiet, since });
  return firstHeld({
    checks: [
      [floor.threadId === undefined, "the call has no thread yet"],
      [floor.heardUtteranceOpen, "the owner's utterance is still open"],
      [within({ since: floor.lastTranscribedMs }), TALKING_REFUSAL],
      [floor.runningTurns > 0, "a Codex turn is still working"],
      [within({ since: floor.lastTurnEndedMs }), "Codex just finished, and the voice is about to answer"],
      [floor.pendingTools > 0, "a tool call is still running"],
      [floor.typingIn, "the owner's typed turn is being handed to the voice"],
      [floor.waitingRequests > 0, "a request to the app-server is unanswered"],
      [floor.nudging || within({ since: floor.lastNudgeMs }), "a nudge is being said"],
      [floor.looking || within({ since: floor.lastLookMs }), "a look line is being said"],
      [floor.acking || within({ since: floor.lastAckMs }), "an acknowledgement is being said"],
      [floor.resuming || within({ since: floor.lastResumeMs }), "the voice was just asked to take its turn"],
      [within({ since: floor.lastVoicedMs }), "the voice is saying what Codex just wrote"],
      [floor.heldAnswers > 0, HELD_ANSWERS_REFUSAL],
    ],
  });
}
