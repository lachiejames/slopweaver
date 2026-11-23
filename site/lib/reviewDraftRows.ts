/**
 * The queue's rows for the review-draft register: one per review a session parked under the owner's name on a colleague's
 * pull request and the owner has not yet answered. Split from `./queueRows.ts`, which folds every register into one list,
 * so that file stays under the 300-line cap.
 */

import { isHeldReview, type ParkedReview } from "../components/live/readReviewDrafts";
import type { LiveState } from "../components/live/useLive";
import { type BriefingCardBasis, briefingCardForm } from "./briefingCardForm";
import { queueProvenanceOf } from "./provenance";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { prPlacement } from "./registerPlacementDirect";
import { reviewDraftCard, reviewSubject } from "./reviewDraftCard";
import { waitingTierOf } from "./waitingRank";
import type { WorkspacePlacer } from "./workspacePlacement";

/** What `reviewDraftCard` states: a `what` always, read off the review itself, and nothing it was not given. */
const REVIEW_BASIS: BriefingCardBasis = { lean: "absent", problem: "absent", stakes: "absent", what: "present" };

/**
 * One row per HELD review. A posted or dropped one is history, never a card: drawn as waiting, it would ask the owner to
 * post a review twice.
 *
 * @param reviews the register as the page holds it
 * @param placer the organisation's address readers, which place each review by its repository
 * @returns the rows, without tags yet; none until the register has read
 */
export function reviewDraftRows({
  placer,
  reviews,
}: {
  placer: WorkspacePlacer;
  reviews: LiveState<readonly ParkedReview[]>;
}): Omit<QueueRow, keyof QueueTags>[] {
  if (reviews.phase !== "ready") {
    return [];
  }
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  for (const review of reviews.value) {
    // A held row always carries its command (`readParkedReviews` refuses one without), so this skips spent rows.
    const command = review.postCommand;
    if (!isHeldReview({ review }) || command === undefined) {
      continue;
    }
    const card = reviewDraftCard({ command, review });
    const placement = prPlacement({ placer, row: { repoSlug: review.repo, url: review.url } });
    out.push({
      card,
      hint: `${reviewSubject({ review })} ${review.title} ${review.why} ${review.body}`,
      id: review.id,
      key: `review:${review.id}`,
      kind: "review",
      pill: "reviews as you",
      provenance: queueProvenanceOf({ placement }),
      record: { form: briefingCardForm({ basis: REVIEW_BASIS, card }), kind: "review", review },
      placement,
      source: { kind: "unrecorded", origin: `a session parked this review: ${review.why}`, steers: [] },
      threadUrl: undefined,
      tier: waitingTierOf({ checkIn: false, teamFacing: true }),
      verifiedBy: "the review-draft register still holds it",
      currencyFloorIso: review.tsIso,
      verifiedIso: reviews.observedAtIso,
      whenIso: review.tsIso,
    });
  }
  return out;
}

/**
 * What a review says first, for the "review before sending" line: its body, else its first comment — an APPROVE
 * may post neither, and then its verdict.
 *
 * @returns the opening text
 */
export function reviewOpening({ review }: { review: ParkedReview }): string {
  if (review.body.trim() !== "") {
    return review.body;
  }
  const first = review.comments.at(0);
  if (first !== undefined) {
    return first.body;
  }
  return review.verdict;
}
