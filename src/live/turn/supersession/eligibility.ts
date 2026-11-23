/**
 * MAY this correction delete the answer it says it supersedes? One pure function, every check in it.
 *
 * Pure and in one place on purpose. The act it guards is irreversible on somebody else's screen, and a
 * decision spread across a poster, a transport and an orchestrator is one nobody can read end to end or
 * test without standing a Slack up. Everything here is data in, verdict out.
 *
 * ## The four independent things that must agree
 *
 * A declared supersession is a composer's CLAIM. Three other sources have to corroborate it before a
 * message comes down, and they are independent by construction — no two of them are written by the same
 * process:
 *
 * 1. **the composer** names a `supersedes` timestamp on the answer form (`outbound/assistant/answerForm.ts`);
 * 2. **the reviewer** names the SAME timestamp in the review verdict and calls the delete warranted — from
 *    a session that is not the author, on a verdict bound to the digest of the answer that actually posted.
 *    That is what stops a turn from authorising its own destructive act, and the three conditions are
 *    checked HERE rather than relied on from the send gate, because a door override waives that gate;
 * 3. **this installation's own completion log** proves slopweaver posted an answer at that timestamp, in
 *    THIS channel and thread (`./completionReader.ts`);
 * 4. **Slack itself**, read back, puts the message in this correction's thread and reports it unedited since
 *    the completion that recorded it.
 *
 * ## Two checks that look redundant and are not
 *
 * The completion row's `askIdentity` and the live message's `thread_ts` are BOTH compared against the
 * correction's thread, because one is a local assertion and the other is an observation. A completion row is
 * written by whatever process appended it and can name a thread the message is not in — a replayed log, a
 * copied home, a turn whose identity was recorded before the message moved. Comparing only the row would let
 * a live answer in an unrelated thread be deleted by a correction that never saw it; comparing only the live
 * message would let a correction delete an answer this install never posted. Neither alone is the check.
 *
 * `editedTs` is the fourth source's second half and it exists because `chat.update` replaces a message's
 * words without moving its `ts`. An answer repaired after the completion that recorded it is no longer the
 * answer anyone judged, so it stays up and the correction stands beside it.
 *
 * ## The race that survives, stated rather than discovered
 *
 * The read that decides and the delete are two calls, so a message edited BETWEEN them would be deleted on
 * the strength of a read that had stopped being true. Most of that window is CLOSED rather than tolerated:
 * `deleteOwnedMessage` re-reads the message immediately before removing it and is handed this decision's own
 * `recordedIso` as `unchangedSince`, so it asks `editedAtOrAfter` — the same comparison, not a copy — of the
 * later observation too. A review executed the open version against the real wiring: two reads,
 * one delete, an edit in between, `outcome: "deleted"`.
 *
 * What survives is the last round trip, between that second read and `chat.delete` itself, and it cannot be
 * closed from anywhere — Slack's `chat.delete` takes no expected revision. It is named rather than left for a
 * reader to notice, because an undocumented residue is what a later session finds mid-turn and treats as
 * grounds to stall.
 *
 * ## What is deliberately NOT checked
 *
 * The ask lifecycle log (`live/ask/lifecycle.ts`) is not read. It records how an ASK progressed, and the
 * question here is about a MESSAGE — every fact that bears on this decision is already in one of the four
 * sources above, and a fifth read whose contribution nobody could name would be ceremony that reads as
 * rigour. Said out loud because an earlier draft of this mechanism CLAIMED to check it.
 */
import type { ReviewedSupersession } from "../../../admit/reviewVerdict.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { editedAtOrAfter, type ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import type { AskIdentity } from "../../ask/identity.js";
import type { AnsweredPredecessor } from "./completionReader.js";
import { type SupersessionError, SupersessionErrors } from "./errors.js";

/**
 * The reviewer's judgement about one supersession — `../../../admit/reviewVerdict.ts`'s own
 * {@link ReviewedSupersession}, re-named here rather than re-declared.
 *
 * A second interface with the same three fields is what the dedup refactor in `.claude/rules/error-handling.md` is the standing example of: the shapes
 * agree on the day they are written and drift on the day one of them gains a field. The local name stays
 * because this module reads the verdict as EVIDENCE rather than as a verdict — every other name in this
 * file is about the decision, not about where a fact came from.
 */
export type SupersessionReview = ReviewedSupersession;

/** A supersession that every check agreed to — what the orchestrator acts on. */
export interface EligibleSupersession {
  /** The message to delete. */
  readonly targetTs: string;
  /** The thread it and the correction both stand in. */
  readonly askIdentity: AskIdentity;
  /** The turn that posted the message being removed. */
  readonly supersededTurnId: string;
  /** Why the reviewer called it warranted, carried into the journal. */
  readonly reason: string;
  /**
   * When this install RECORDED posting the message — the instant the edit check compares against.
   *
   * Carried out of the decision rather than re-derived by the caller, because the DELETE asks the same
   * question of its own later read: the value that judged the message here has to be the value that judges
   * it there, or the two reads disagree about what "since" means.
   */
  readonly recordedIso: string;
}

/**
 * Whether the local record and the live read-back agree about where the target stands.
 *
 * Split out because it is the check with two failure arms that must not collapse: an ABSENT `thread_ts`
 * means Slack has the message at a channel root, which is a different finding from one in another thread,
 * and both refuse.
 */
function liveThreadDisagreement({
  live,
  threadTs,
  targetTs,
}: {
  live: ReadSlackMessage;
  threadTs: string;
  targetTs: string;
}): SupersessionError | undefined {
  if (live.threadTs === threadTs) {
    return undefined;
  }
  return SupersessionErrors.liveThreadMismatch({
    correctingThreadTs: threadTs,
    liveThreadTs: live.threadTs,
    ts: targetTs,
  });
}

/**
 * Whether the live message has been edited since the completion that recorded it.
 *
 * The comparison itself is `editedAtOrAfter` in `../../../outbound/slack/lifecycleGuards.ts`, not a copy
 * here, because the DELETE asks the same question of its own later read — an edit landing between the two
 * reads is the window a second copy would eventually disagree across.
 */
function editedSince({
  live,
  recordedIso,
  targetTs,
}: {
  live: ReadSlackMessage;
  recordedIso: string;
  targetTs: string;
}): SupersessionError | undefined {
  const editedTs = editedAtOrAfter({ live, sinceIso: recordedIso });
  if (editedTs === undefined) {
    return undefined;
  }
  return SupersessionErrors.editedSince({ editedTs, ts: targetTs });
}

/**
 * The verdict's own provenance: which answer its reviewer read, and who the two sessions were.
 *
 * Separate from {@link SupersessionReview} because they answer different questions of the same document.
 * The review says what the reviewer decided ABOUT the target; this says whether that decision is bound to
 * the answer that actually went out, and whether anybody but the author made it.
 */
export interface SupersessionWarrant {
  /** The `sha256:` digest the verdict is bound to — `answerDigestOf` of the answer the reviewer read. */
  readonly answerDigest: string;
  readonly authorSession: string;
  readonly reviewerSession: string;
}

/**
 * Whether the warrant belongs to the answer this turn posted, and to somebody other than its author.
 *
 * Both properties are ALSO checked by `../../../admit/answerQualityGate.ts` before the answer is sent, and
 * both are checked again here because that gate raises WARNINGS: a `answer.quality:v1` door override waives
 * them, which is the right trade for a SEND — an unreviewed answer is untidy and recoverable — and the
 * wrong one for a DELETE. Measured by a pre-mortem: under that override, a
 * verdict bound to sixty-four zeroes and a verdict whose reviewer was its own author each deleted the
 * predecessor. An override of the send is not an override of the removal.
 */
function warrantedIndependently({
  warrant,
  postedAnswerDigest,
  targetTs,
}: {
  warrant: SupersessionWarrant | undefined;
  postedAnswerDigest: string;
  targetTs: string;
}): SupersessionError | undefined {
  if (warrant === undefined) {
    return SupersessionErrors.unreviewed({ ts: targetTs });
  }
  if (warrant.authorSession === warrant.reviewerSession) {
    return SupersessionErrors.selfReviewed({ session: warrant.authorSession, ts: targetTs });
  }
  if (warrant.answerDigest !== postedAnswerDigest) {
    return SupersessionErrors.staleWarrant({
      postedDigest: postedAnswerDigest,
      reviewedDigest: warrant.answerDigest,
      ts: targetTs,
    });
  }
  return undefined;
}

/** The reviewer's half: a verdict naming this exact target and calling the delete warranted. */
function reviewedSupersession({
  review,
  targetTs,
}: {
  review: SupersessionReview | undefined;
  targetTs: string;
}): Result<SupersessionReview, SupersessionError> {
  if (review === undefined) {
    return err(SupersessionErrors.unreviewed({ ts: targetTs }));
  }
  if (review.targetTs !== targetTs) {
    return err(SupersessionErrors.verdictTargetMismatch({ reviewedTs: review.targetTs, ts: targetTs }));
  }
  if (!review.warranted) {
    return err(SupersessionErrors.notWarranted({ reason: review.reason, ts: targetTs }));
  }
  return ok(review);
}

/**
 * The record half: a completion of ours naming this answer, in this correction's own thread.
 *
 * The comparison is CHANNEL and THREAD, deliberately not the whole {@link AskIdentity}. A correction is
 * routinely a NEW tag — its own `messageTs` — replying in the thread where an earlier tag was answered, and
 * that is the shape the mechanism was built for (the acme-bugs thread). Comparing `messageTs`
 * too would refuse exactly the case this exists to handle, while adding nothing: the boundary that keeps a
 * correction from reaching a stranger's conversation is the thread, not the ask.
 */
function recordedPredecessor({
  predecessor,
  askIdentity,
  targetTs,
}: {
  predecessor: AnsweredPredecessor | undefined;
  askIdentity: AskIdentity;
  targetTs: string;
}): Result<AnsweredPredecessor, SupersessionError> {
  if (predecessor === undefined) {
    return err(SupersessionErrors.noSuchAnswer({ ts: targetTs }));
  }
  const recorded = predecessor.askIdentity;
  if (recorded.channel !== askIdentity.channel || recorded.threadTs !== askIdentity.threadTs) {
    return err(
      SupersessionErrors.foreignThread({
        correctingIn: `${askIdentity.channel}/${askIdentity.threadTs}`,
        recordedIn: `${recorded.channel}/${recorded.threadTs}`,
        ts: targetTs,
      }),
    );
  }
  return ok(predecessor);
}

/**
 * Whether this correction may delete the answer it declares it supersedes.
 *
 * Every argument is data the caller already has: nothing here reads a file, a clock or a network. The
 * checks run in the order they are cheapest to explain — the declaration, the reviewer, our own record,
 * then Slack — and the FIRST refusal is returned, because a reader auditing a delete that did not happen
 * wants the reason it stopped, not a list.
 *
 * @param declaredTs the `supersedes` timestamp the answer form carried, absent on an additive follow-up
 * @param postedAnswerTs the answer this turn just posted, so it can never target itself
 * @param askIdentity the ask this correction is answering — its channel and thread are the boundary
 * @param postedAnswerDigest `answerDigestOf` of the answer that went out, which the warrant must be bound to
 * @param review the reviewer's judgement about this supersession, absent when none was produced
 * @param warrant the verdict's own provenance, absent when no verdict reached this turn
 * @param predecessor this install's own completion for the declared target, absent when it has none
 * @param live the message as Slack read it back, absent when the read found nothing
 * @returns the supersession to perform, or the one check that refused it
 */
export function supersessionEligibility({
  declaredTs,
  postedAnswerTs,
  postedAnswerDigest,
  askIdentity,
  review,
  warrant,
  predecessor,
  live,
}: {
  declaredTs: string | undefined;
  postedAnswerTs: string;
  postedAnswerDigest: string;
  askIdentity: AskIdentity;
  review: SupersessionReview | undefined;
  warrant: SupersessionWarrant | undefined;
  predecessor: AnsweredPredecessor | undefined;
  live: ReadSlackMessage | undefined;
}): Result<EligibleSupersession, SupersessionError> {
  if (declaredTs === undefined) {
    return err(SupersessionErrors.nothingDeclared());
  }
  if (declaredTs === postedAnswerTs) {
    return err(SupersessionErrors.selfTarget({ ts: declaredTs }));
  }
  const reviewed = reviewedSupersession({ review, targetTs: declaredTs });
  if (reviewed.isErr()) {
    return err(reviewed.error);
  }
  const unwarranted = warrantedIndependently({ postedAnswerDigest, targetTs: declaredTs, warrant });
  if (unwarranted !== undefined) {
    return err(unwarranted);
  }
  const recorded = recordedPredecessor({ askIdentity, predecessor, targetTs: declaredTs });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  if (live === undefined) {
    // The ownership read found nothing at that exact timestamp. Reported as NO_SUCH_ANSWER rather than as a
    // transport fault, because from this decision's point of view there is no answer there to supersede —
    // the delete operation's own `TARGET_ABSENT` is what names the read itself.
    return err(SupersessionErrors.noSuchAnswer({ ts: declaredTs }));
  }
  const refusedByThread = liveThreadDisagreement({ live, targetTs: declaredTs, threadTs: askIdentity.threadTs });
  if (refusedByThread !== undefined) {
    return err(refusedByThread);
  }
  const refusedByEdit = editedSince({ live, recordedIso: recorded.value.recordedIso, targetTs: declaredTs });
  if (refusedByEdit !== undefined) {
    return err(refusedByEdit);
  }
  return ok({
    askIdentity,
    reason: reviewed.value.reason,
    recordedIso: recorded.value.recordedIso,
    supersededTurnId: recorded.value.turnId,
    targetTs: declaredTs,
  });
}
