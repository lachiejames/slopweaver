/**
 * Which inline review comments on a pull request are HISTORY to a description review, and the one-way check that
 * a thread a CLEAN review read as history has not come back to life.
 *
 * Why it exists: a self-review comment, once posted, has no verb that edits it. The next round posts a corrected
 * comment and resolves the old round's threads in the same mutation (`../../cli/commands/github/selfReviewRun.ts`),
 * but the review packet used to show the old comment as plain evidence, so the corrected one read as contradicting
 * it, and the review came back BROKEN on that alone, two passes running.
 *
 * A thread is history when GitHub reports it resolved, or when the write under review resolves it: the previous
 * round a self-review ledger owns (`./selfReviewRound.ts`). Neither fact is bound into any digest, because resolving
 * a thread or posting the round would then void the very review that let it go out. What the reviewer was told is
 * history is recorded on the receipt instead, and {@link reactivatedHistoryThreadIds} refuses a write when one of
 * those threads is unresolved again and this write does not resolve it. A thread reviewed as live that resolves
 * later never refuses: the reviewer weighed more than it had to.
 *
 * The rule holds whoever wrote the comment. A reviewer who wants a resolved point heard again unresolves the thread,
 * and that is exactly the transition this check catches. Residue, stated: a thread unresolved between the write's
 * last read and its mutation is not seen, the same window a newly arriving comment has.
 *
 * Everything here is decided from values.
 */
import type { ExistingPullRequestComment } from "./descriptionReviewTypes.js";

/**
 * Mark every inline comment in a thread this write resolves as superseded by it.
 *
 * @param supersededThreadIds the review threads the write resolves: a self-review round's previously owned threads
 * @returns a copy in the same order, every other comment unchanged
 */
export function markSupersededReviewComments({
  comments,
  supersededThreadIds,
}: {
  comments: readonly ExistingPullRequestComment[];
  supersededThreadIds: readonly string[];
}): readonly ExistingPullRequestComment[] {
  const superseded = new Set(supersededThreadIds);
  return comments.map((comment) =>
    comment.kind === "review-comment" && superseded.has(comment.threadId)
      ? { ...comment, supersededByThisWrite: true }
      : comment,
  );
}

/** Whether an inline comment sits in a thread a description review reads as history. */
function isHistory({ comment }: { comment: ExistingPullRequestComment }): boolean {
  return comment.kind === "review-comment" && (comment.threadResolved || comment.supersededByThisWrite);
}

/**
 * The review threads a packet shows as history, which its receipt records.
 *
 * @returns the thread node ids, sorted and distinct
 */
export function historicalReviewThreadIds({
  comments,
}: {
  comments: readonly ExistingPullRequestComment[];
}): readonly string[] {
  const ids = new Set<string>();
  for (const comment of comments) {
    if (comment.kind === "review-comment" && isHistory({ comment })) {
      ids.add(comment.threadId);
    }
  }
  return [...ids].toSorted();
}

/**
 * The threads a CLEAN review read as history that are live now: present on the pull request, unresolved, and not
 * resolved by this write. A thread no longer on the pull request is not live, so it never counts.
 *
 * @param reviewedHistoricalThreadIds the threads the receipt says its reviewer was told are history
 * @param currentComments the comments as the write reads them now, superseded marks applied
 * @returns the reactivated thread ids, sorted; empty when the review still describes the conversation
 */
export function reactivatedHistoryThreadIds({
  reviewedHistoricalThreadIds,
  currentComments,
}: {
  reviewedHistoricalThreadIds: readonly string[];
  currentComments: readonly ExistingPullRequestComment[];
}): readonly string[] {
  const reviewed = new Set(reviewedHistoricalThreadIds);
  const live = new Set<string>();
  for (const comment of currentComments) {
    if (comment.kind === "review-comment" && reviewed.has(comment.threadId) && !isHistory({ comment })) {
      live.add(comment.threadId);
    }
  }
  return [...live].toSorted();
}
