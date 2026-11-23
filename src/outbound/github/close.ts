/** GitHub's close-without-merge mutation, adapted from the one sanctioned write client. */

import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** The pull-request state a close checks, refuses on, and confirms by. */
export interface ClosePr {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  /** GitHub's own merge time — the field that tells a merged pull request apart from a closed one. */
  readonly mergedAtIso: string | undefined;
  /** The head commit this read saw — what `--expect-head` is compared against. */
  readonly headSha: string;
}

/** One comment's id and creation time — enough to judge whether it satisfies the recency gate. */
export interface RecentComment {
  readonly id: number;
  readonly createdAtIso: string;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubCloseApi {
  read(args: { owner: string; repo: string; number: number }): ResultAsync<ClosePr, IngestError>;
  recentComments(args: {
    owner: string;
    repo: string;
    number: number;
    sinceIso: string;
  }): ResultAsync<readonly RecentComment[], IngestError>;
  comment(args: { owner: string; repo: string; number: number; body: string }): ResultAsync<void, IngestError>;
  close(args: { owner: string; repo: string; number: number }): ResultAsync<ClosePr, IngestError>;
}

/** Narrow a full pull-request read down to what a close decision needs. */
function toClosePr(pr: {
  number: number;
  htmlUrl: string;
  state: string;
  mergedAtIso: string | undefined;
  head: { sha: string };
}): ClosePr {
  return { headSha: pr.head.sha, mergedAtIso: pr.mergedAtIso, number: pr.number, state: pr.state, url: pr.htmlUrl };
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the read, recency-check, comment and close mutation seams
 */
export function makeGithubCloseApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubCloseApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    close: ({ owner, repo, number }) => api.closePr({ number, owner, repo }).map(toClosePr),
    comment: ({ owner, repo, number, body }) =>
      api.createIssueComment({ body, number, owner, repo }).map(() => undefined),
    read: ({ owner, repo, number }) => api.getPr({ number, owner, repo }).map(toClosePr),
    recentComments: ({ owner, repo, number, sinceIso }) => api.listIssueComments({ number, owner, repo, sinceIso }),
  };
}
