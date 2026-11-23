/**
 * The GitHub surface `slopweaver github review-draft` touches, adapted from the one sanctioned write client — and
 * the door gate that stands between a parked review and GitHub.
 */

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";
import { makeGithubWriteApi, type PrRef, type PullRequestDiffFile } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import {
  createReviewVia,
  type ExistingReview,
  getReviewVia,
  listReviewsVia,
  type PostedReview,
  type ReviewPostComment,
  type ReviewTarget,
  reviewTargetVia,
} from "../../corpus/github/writeReviewDraft.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { ReviewVerdict } from "./reviewDraft.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable reads and the one write; a test provides plain fakes. */
export interface GithubReviewDraftApi {
  readonly target: (input: PrRef) => ResultAsync<ReviewTarget, IngestError>;
  readonly diffFiles: (input: PrRef) => ResultAsync<readonly PullRequestDiffFile[], IngestError>;
  readonly viewerId: () => ResultAsync<number, IngestError>;
  readonly createReview: (
    input: PrRef & {
      commitId: string;
      event: ReviewVerdict;
      body: string;
      comments: readonly ReviewPostComment[];
    },
  ) => ResultAsync<PostedReview, IngestError>;
  readonly readReview: (input: PrRef & { reviewId: number }) => ResultAsync<PostedReview, IngestError>;
  readonly reviews: (input: PrRef) => ResultAsync<readonly ExistingReview[], IngestError>;
}

/**
 * Build the production surface.
 *
 * @param token the GitHub token
 * @returns the reads and the one write
 */
export function makeGithubReviewDraftApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubReviewDraftApi {
  const api = makeGithubWriteApi({ privacy, token });
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    createReview: ({ owner, repo, number, commitId, event, body, comments }) =>
      createReviewVia({ ctx, input: { body, comments, commitId, event, number, owner, repo } }),
    diffFiles: ({ owner, repo, number }) => api.diffFiles({ number, owner, repo }),
    readReview: ({ owner, repo, number, reviewId }) => getReviewVia({ ctx, input: { number, owner, repo, reviewId } }),
    reviews: ({ owner, repo, number }) => listReviewsVia({ ctx, input: { number, owner, repo } }),
    target: ({ owner, repo, number }) => reviewTargetVia({ ctx, input: { number, owner, repo } }),
    viewerId: () => api.authenticatedUserId(),
  };
}

/** The finding code an unapproved or mismatched review post fires. */
const REVIEW_POST_UNAPPROVED_CODE = "github.review-unapproved";

/**
 * The door gate for one review post: it HOLDS unless the digest supplied with `--approve` is the digest of the
 * review as it stands now.
 *
 * What it does not do, stated as `../../admit/approval.ts` states it: it does not authenticate a human. It makes
 * the post a second deliberate step, against content that cannot have moved since the card showed it, and it
 * records an unapproved attempt in the ledger. The owner's yes reaches it as the digest a session is handed.
 *
 * @param expected the digest recomputed from the row's stored content
 * @param supplied what the caller passed to `--approve`, absent when they passed nothing
 * @param id the draft, for the correction line
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function reviewPostApprovalGate({
  expected,
  supplied,
  id,
}: {
  expected: string;
  supplied: string | undefined;
  id: string;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    const summary =
      supplied === undefined
        ? "this review goes out under the owner's name on somebody else's pull request and has not been approved"
        : `the approval ${supplied} does not match this review (${expected}) — it names different content`;
    return [
      {
        code: REVIEW_POST_UNAPPROVED_CODE,
        correction:
          `show the owner the card, then on the owner's word run: slopweaver github review-draft post ${id} --approve ${expected}. ` +
          "That digest covers the pull request, its head commit, the verdict, the body and every comment; any change " +
          "invalidates it. There is no override — this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
