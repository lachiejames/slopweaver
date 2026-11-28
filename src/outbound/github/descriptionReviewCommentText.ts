/**
 * The exact text a description review's comments are carried and bound as: the comments the write posts, and the
 * comments already on the pull request, each in a canonical order so the same set given in another order is the same
 * manifest.
 *
 * The comments already on the pull request have TWO texts, and the split is the point. The digest text binds only
 * the fields a review has always bound, so a thread resolving, or the write resolving its own previous round, never
 * moves a manifest a CLEAN review is stored under. The evidence text adds each review thread's history, which the
 * reviewer reads (`./descriptionReviewHistory.ts`). Everything here is decided from values.
 */
import { stableStringify } from "#lib/stableStringify.js";

import type { DescriptionReviewComment, ExistingPullRequestComment } from "./descriptionReviewTypes.js";

/** A total order over strings, so a sort never depends on the locale. */
function compareText({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The comments a write posts, in canonical order (path, line, body), so the same set in another order is the same
 * manifest.
 *
 * @returns a sorted copy
 */
export function canonicalDescriptionComments({
  comments,
}: {
  comments: readonly DescriptionReviewComment[];
}): readonly DescriptionReviewComment[] {
  return comments
    .map(({ path, line, body }) => ({ body, line, path }))
    .toSorted(
      (left, right) =>
        compareText({ left: left.path, right: right.path }) ||
        left.line - right.line ||
        compareText({ left: left.body, right: right.body }),
    );
}

/**
 * The exact bytes `description/comments.json` carries, and the text its digest is taken over.
 *
 * @returns the canonical comments, stably serialised, with one trailing newline
 */
export function descriptionCommentsText({ comments }: { comments: readonly DescriptionReviewComment[] }): string {
  return `${stableStringify({ value: canonicalDescriptionComments({ comments }) })}\n`;
}

/**
 * The comments already on a pull request, in canonical order (kind, then GitHub id).
 *
 * @returns a sorted copy
 */
function canonicalExistingComments({
  comments,
}: {
  comments: readonly ExistingPullRequestComment[];
}): readonly ExistingPullRequestComment[] {
  return comments.toSorted(
    (left, right) =>
      compareText({ left: left.kind, right: right.kind }) || compareText({ left: left.id, right: right.id }),
  );
}

/**
 * An existing comment as its digest sees it: the fields the digest has always bound, named one by one so a field
 * added to the comment later reaches the reviewer's evidence without silently moving every stored manifest.
 */
function boundFieldsOf({ comment }: { comment: ExistingPullRequestComment }): Record<string, unknown> {
  const shared = {
    authorLogin: comment.authorLogin,
    body: comment.body,
    createdAtIso: comment.createdAtIso,
    id: comment.id,
    kind: comment.kind,
    updatedAtIso: comment.updatedAtIso,
    url: comment.url,
  };
  if (comment.kind === "issue-comment") {
    return shared;
  }
  return { ...shared, originalLine: comment.originalLine, path: comment.path };
}

/**
 * The text `existingCommentsSha256` is taken over: the canonical existing comments WITHOUT any thread's history, so
 * resolving a thread, or the write resolving its own previous round, never moves a manifest a CLEAN review is stored
 * under. These are the bytes the digest has always been taken over, so a receipt from before history was carried
 * still opens its write.
 *
 * @returns the canonical existing comments' bound fields, stably serialised, with one trailing newline
 */
export function existingCommentsDigestText({ comments }: { comments: readonly ExistingPullRequestComment[] }): string {
  const bound = canonicalExistingComments({ comments }).map((comment) => boundFieldsOf({ comment }));
  return `${stableStringify({ value: bound })}\n`;
}

/**
 * The exact bytes `evidence/pull-request-comments.json` carries: the canonical existing comments with each review
 * thread's history, which the reviewer reads and no digest binds ({@link existingCommentsDigestText}).
 *
 * @returns the canonical existing comments, stably serialised, with one trailing newline
 */
export function existingCommentsEvidenceText({
  comments,
}: {
  comments: readonly ExistingPullRequestComment[];
}): string {
  return `${stableStringify({ value: canonicalExistingComments({ comments }) })}\n`;
}
