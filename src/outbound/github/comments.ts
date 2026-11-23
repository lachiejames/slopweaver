/** GitHub's top-level issue/pull-request comment create/edit/read-back, adapted from the one sanctioned write client. */

import type { WrittenComment } from "../../corpus/github/write.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { WrittenComment } from "../../corpus/github/write.js";

/** Injectable write/read-back surface; tests provide plain fakes. */
export interface GithubCommentApi {
  create(args: { owner: string; repo: string; number: number; body: string }): ResultAsync<WrittenComment, IngestError>;
  edit(args: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): ResultAsync<WrittenComment, IngestError>;
  read(args: { owner: string; repo: string; commentId: number }): ResultAsync<WrittenComment, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the create, edit and read-back mutations
 */
export function makeGithubCommentApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubCommentApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    create: ({ owner, repo, number, body }) => api.createIssueComment({ body, number, owner, repo }),
    edit: ({ owner, repo, commentId, body }) => api.updateIssueComment({ body, commentId, owner, repo }),
    read: ({ owner, repo, commentId }) => api.getIssueComment({ commentId, owner, repo }),
  };
}
