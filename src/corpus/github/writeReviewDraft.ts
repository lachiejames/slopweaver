/**
 * Submitting a whole pull-request review in ONE call, and reading it back — the transport under
 * `slopweaver github review-draft post`.
 *
 * Its own module rather than a method on `./write.ts`'s `GithubWriteApi`, which sits at its file-size ratchet;
 * it takes the same `WriteCtx`, so it is the same lane and the same no-retry client (`./writeCtx.ts`).
 *
 * Deliberately NOT `./writeReview.ts`'s `submitReviewRoundVia`: that is the self-review round, a GraphQL
 * mutation with the event fixed at COMMENT and prior-thread resolutions riding in the same request. A review of
 * somebody else's pull request carries its own verdict and resolves nothing.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, WriteCtx } from "./write.js";

/** One line comment as the review POST carries it — always on the head side of the diff. */
export interface ReviewPostComment {
  readonly path: string;
  readonly line: number;
  readonly startLine?: number | undefined;
  readonly body: string;
}

/** A submitted review, as GitHub reported it. */
export interface PostedReview {
  readonly reviewId: number;
  readonly url: string;
  /** GitHub's own word for what was submitted: `APPROVED`, `COMMENTED` or `CHANGES_REQUESTED`. */
  readonly state: string;
  /** The commit GitHub attached the review to, `null` when GitHub names none. */
  readonly commitId: string | null;
}

/** The pull request a review is about, narrowed to what recording and posting one check. */
export interface ReviewTarget {
  readonly title: string;
  readonly url: string;
  /** `open` or `closed`. */
  readonly state: string;
  readonly merged: boolean;
  readonly headSha: string;
  /** The author's immutable id, compared with the viewer's so the viewer's own pull request is refused. */
  readonly authorId: number | undefined;
  readonly authorLogin: string | undefined;
}

/**
 * Read the pull request a review is about.
 *
 * @returns the target, or the provider failure
 */
export function reviewTargetVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<ReviewTarget, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      return {
        authorId: res.data.user.id,
        authorLogin: res.data.user.login,
        headSha: res.data.head.sha,
        merged: res.data.merged,
        state: res.data.state,
        title: res.data.title,
        url: res.data.html_url,
      };
    },
    operation: "github.pulls.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Submit one review — verdict, body and every line comment — in a single `pulls.createReview` call.
 *
 * `commitId` pins the review to the head the owner approved: GitHub resolves each comment's line against that
 * commit's diff, not whatever the branch has moved to. `retryMode: "never"`, because a second attempt after a
 * lost response would post the review twice under the owner's name.
 *
 * @returns the submitted review, or the provider failure
 */
export function createReviewVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & {
    commitId: string;
    event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
    body: string;
    comments: readonly ReviewPostComment[];
  };
}): ResultAsync<PostedReview, IngestError> {
  const { owner, repo, number, commitId, event, body, comments } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.createReview({
        body,
        comments: comments.map((comment) => ({
          body: comment.body,
          line: comment.line,
          path: comment.path,
          side: "RIGHT",
          ...(comment.startLine === undefined ? {} : { start_line: comment.startLine, start_side: "RIGHT" }),
        })),
        commit_id: commitId,
        event,
        owner,
        pull_number: number,
        repo,
      });
      return {
        commitId: res.data.commit_id,
        reviewId: res.data.id,
        state: res.data.state,
        url: res.data.html_url,
      };
    },
    operation: "github.pulls.createReview",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/** A review already on the pull request, with what a post compares before sending its own. */
export interface ExistingReview extends PostedReview {
  readonly authorId: number | undefined;
  readonly body: string;
}

/** Reviews read per page, and the most pages read before giving up rather than judging a partial list. */
const REVIEWS_PAGE_SIZE = 100;
const REVIEWS_MAX_PAGES = 10;

/**
 * Every review on a pull request, read to completion — a post asks it whether this review is already there.
 *
 * A pull request with more reviews than the ceiling fails rather than answering with the ones it saw: a partial
 * list could leave out the very review a post is checking for.
 *
 * @returns every review, or the provider failure
 */
export function listReviewsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<readonly ExistingReview[], IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const reviews: ExistingReview[] = [];
      for (let page = 1; page <= REVIEWS_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.pulls.listReviews({
          owner,
          page,
          per_page: REVIEWS_PAGE_SIZE,
          pull_number: number,
          repo,
        });
        for (const review of res.data) {
          reviews.push({
            authorId: review.user === null ? undefined : review.user.id,
            body: review.body,
            commitId: review.commit_id,
            reviewId: review.id,
            state: review.state,
            url: review.html_url,
          });
        }
        if (res.data.length < REVIEWS_PAGE_SIZE) {
          return reviews;
        }
      }
      throw new Error(
        `more than ${String(REVIEWS_PAGE_SIZE * REVIEWS_MAX_PAGES)} reviews, so whether this one is among them is unknown`,
      );
    },
    operation: "github.pulls.listReviews",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one submitted review back — the confirmation a post reports, never the POST's own answer alone.
 *
 * @returns the review as GitHub now holds it, or the provider failure
 */
export function getReviewVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { reviewId: number };
}): ResultAsync<PostedReview, IngestError> {
  const { owner, repo, number, reviewId } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.getReview({ owner, pull_number: number, repo, review_id: reviewId });
      return {
        commitId: res.data.commit_id,
        reviewId: res.data.id,
        state: res.data.state,
        url: res.data.html_url,
      };
    },
    operation: "github.pulls.getReview",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
