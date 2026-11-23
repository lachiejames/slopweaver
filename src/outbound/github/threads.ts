/** GitHub's review-thread read and answer, adapted from the one sanctioned write client. */

import {
  type ReviewThreadAnswer,
  type ReviewThreadComments,
  type ReviewThreadDetail,
  reviewThreadCommentsVia,
} from "../../corpus/github/threads.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type {
  ReviewThreadAnswer,
  ReviewThreadComment,
  ReviewThreadComments,
  ReviewThreadDetail,
} from "../../corpus/github/threads.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubThreadApi {
  /** Resolve `--repo`/`--number` to the GraphQL node id every thread operation is addressed against. */
  pullRequestId(args: { owner: string; repo: string; number: number }): ResultAsync<string, IngestError>;
  list(args: { pullRequestId: string }): ResultAsync<readonly ReviewThreadDetail[], IngestError>;
  /** One thread's comments and this token's own login — what a reply reads before it writes. */
  comments(args: { threadId: string }): ResultAsync<ReviewThreadComments, IngestError>;
  answer(args: {
    threadId: string;
    body: string | undefined;
    resolve: boolean;
  }): ResultAsync<ReviewThreadAnswer, IngestError>;
  reopen(args: { threadId: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the node-id lookup, the thread reads, and the answer and reopen mutations
 */
export function makeGithubThreadApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubThreadApi {
  const api = makeGithubWriteApi({ privacy, token });
  // The pre-reply read sits outside `write.ts`, whose size ratchet is at its floor; `./ready.ts` is the precedent.
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    answer: ({ threadId, body, resolve }) => api.answerReviewThread({ body, resolve, threadId }),
    comments: ({ threadId }) => reviewThreadCommentsVia({ ctx, input: { threadId } }),
    list: ({ pullRequestId }) => api.reviewThreadDetails({ pullRequestId }),
    pullRequestId: ({ owner, repo, number }) => api.getPr({ number, owner, repo }).map((pr) => pr.nodeId),
    reopen: ({ threadId }) => api.reopenReviewThread({ threadId }),
  };
}
