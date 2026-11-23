/**
 * THE PRIVATE-WORDS REVIEW, the pure half of recording a verdict (`./types.ts`): whether a cited review judged
 * this hold's packet, whether its reviewer was fresh, and the receipt it becomes.
 *
 * Modelled on the description review (`../github/descriptionReview.ts`) and deliberately stricter in one place:
 * a fallback review must be recorded by a visible session that is neither the one that PREPARED the packet nor
 * the one that HELD the write, because the session that wrote the text is the one whose judgement is in question.
 * The verb (`../../cli/commands/privateTerms/review.ts`) goes further and binds no fallback receipt at all: one
 * records no session id, so the recorder is the importer, never provably the reviewer. The freshness rule stays
 * here for a receipt that one day carries its own session.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { PageReviewCandidate } from "../../pages/review.js";
import {
  type SupervisorSession,
  sameSupervisorSession,
  supervisorSessionLabel,
  type VisibleSupervisorSession,
} from "../../supervisor/session.js";
import { type PrivateTermReviewError, PrivateTermReviewErrors } from "./errors.js";
import { contextsMarkdown } from "./hold.js";
import { type PrivateTermPacketFacts, packetTextSha256 } from "./packet.js";
import {
  PRIVATE_TERM_REVIEW_PROPERTY,
  PRIVATE_TERM_REVIEW_PROPERTY_ID,
  type PrivateTermHold,
  type PrivateTermReviewer,
  type PrivateTermReviewPreparation,
  type PrivateTermReviewReceipt,
} from "./types.js";

/**
 * Prove a candidate review judged this hold's packet, or say which binding failed.
 *
 * @param candidate the review as its record states it
 * @param preparation the packet its repository root resolved to
 * @param hold the hold that packet was prepared for, read back and re-hashed
 * @param facts what the shell read from the packet repository at the candidate's commits
 * @returns the candidate, or the binding that failed
 */
export function bindPrivateTermReview({
  candidate,
  preparation,
  hold,
  facts,
}: {
  candidate: PageReviewCandidate;
  preparation: PrivateTermReviewPreparation;
  hold: PrivateTermHold;
  facts: PrivateTermPacketFacts;
}): Result<PageReviewCandidate, PrivateTermReviewError> {
  const wrong = ({ why }: { why: string }): Result<PageReviewCandidate, PrivateTermReviewError> =>
    err(PrivateTermReviewErrors.wrongPacket({ reviewId: candidate.id, why }));
  if (
    candidate.property.id !== PRIVATE_TERM_REVIEW_PROPERTY_ID ||
    candidate.property.statement !== PRIVATE_TERM_REVIEW_PROPERTY
  ) {
    return wrong({ why: `it answered property "${candidate.property.id}", not the one \`review-prepare\` prints` });
  }
  if (preparation.holdId !== hold.holdId || preparation.holdKey !== hold.holdKey) {
    return wrong({ why: "its packet was prepared for another hold" });
  }
  if (candidate.baseSha !== preparation.baseSha || candidate.headSha !== preparation.headSha) {
    return wrong({ why: "its base and head commits are not the ones `private-terms review-prepare` committed" });
  }
  if (facts.diffSha256 !== candidate.diffSha256) {
    return wrong({ why: "the diff it judged does not reproduce from the packet's commits" });
  }
  if (facts.contextsSha256 !== packetTextSha256({ text: contextsMarkdown({ draft: hold }) })) {
    return wrong({ why: "the contexts at its head commit are not this hold's matches" });
  }
  return ok(candidate);
}

/**
 * Whether the reviewer was fresh: never the session that held the write or prepared its packet.
 *
 * A Codex review is fresh by construction: Codex runs its own thread and writes the verdict itself. A Claude
 * fallback is recorded by the reviewing session, so the recorder IS the reviewer. Residue, stated: a session id is
 * read from the environment and compared as an opaque value, so this catches the honest mistake of a writer
 * judging its own words, not a process that sets another session's id.
 *
 * @param reviewer who the cited review says took it
 * @param heldBy the session the write was attempted from
 * @param preparedBy the session that prepared the packet
 * @param recordedBy the session recording the receipt now
 * @returns the reviewer, or why it is not fresh
 */
export function decidePrivateTermReviewerFreshness({
  reviewer,
  heldBy,
  preparedBy,
  recordedBy,
}: {
  reviewer: PrivateTermReviewer;
  heldBy: SupervisorSession | null;
  preparedBy: SupervisorSession | null;
  recordedBy: SupervisorSession | null;
}): Result<PrivateTermReviewer, PrivateTermReviewError> {
  if (reviewer === "codex") {
    return ok(reviewer);
  }
  if (recordedBy === null) {
    return err(
      PrivateTermReviewErrors.notFresh({
        why: "a Claude fallback review is recorded by the session that took it, and this environment names no visible session",
      }),
    );
  }
  if (preparedBy === null || heldBy === null) {
    return err(
      PrivateTermReviewErrors.notFresh({
        why: "the write was held or its packet prepared outside any visible session, so a Claude reviewer cannot be shown to be a different one",
      }),
    );
  }
  for (const [session, act] of [
    [heldBy, "attempted this write"],
    [preparedBy, "prepared this packet"],
  ] as const) {
    if (sameSupervisorSession({ left: session, right: recordedBy })) {
      return err(
        PrivateTermReviewErrors.notFresh({
          why: `session ${supervisorSessionLabel({ session: recordedBy })} ${act} and is recording its own review; a separate visible session takes the fallback pass`,
        }),
      );
    }
  }
  return ok(reviewer);
}

/**
 * The receipt a bound, fresh review becomes.
 *
 * @returns the receipt
 */
export function privateTermReceiptOf({
  candidate,
  preparation,
  recordedBy,
  receiptId,
  recordedAtIso,
}: {
  candidate: PageReviewCandidate;
  preparation: PrivateTermReviewPreparation;
  recordedBy: VisibleSupervisorSession | null;
  receiptId: string;
  recordedAtIso: string;
}): PrivateTermReviewReceipt {
  return {
    holdId: preparation.holdId,
    holdKey: preparation.holdKey,
    preparationId: preparation.preparationId,
    receiptId,
    recordedAtIso,
    recordedBy,
    reviewer: candidate.reviewer,
    reviewId: candidate.id,
    schemaVersion: 1,
    summary: candidate.summary,
    verdict: candidate.verdict,
  };
}
