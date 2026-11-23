/** The narrow ref surface `github branch delete` and `github tag create` read and write through. */

import {
  branchTipVia,
  commitExistsVia,
  createTagVia,
  defaultBranchVia,
  deleteBranchAtTipVia,
  openPrsOnBranchVia,
  tagCommitVia,
} from "../../corpus/github/refs.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRefsApi {
  branchTip(args: { owner: string; repo: string; branch: string }): ResultAsync<string | undefined, IngestError>;
  defaultBranch(args: { owner: string; repo: string }): ResultAsync<string, IngestError>;
  openPrsOnBranch(args: { owner: string; repo: string; branch: string }): ResultAsync<readonly number[], IngestError>;
  commitExists(args: { owner: string; repo: string; sha: string }): ResultAsync<boolean, IngestError>;
  tagCommit(args: { owner: string; repo: string; tag: string }): ResultAsync<string | undefined, IngestError>;
  createTag(args: {
    owner: string;
    repo: string;
    tag: string;
    sha: string;
    message: string | undefined;
  }): ResultAsync<string | undefined, IngestError>;
  /** Delete the branch only if still at `tip`, creating `createTag` there if absent or holding `holdTag` there — atomically. */
  deleteBranchAtTip(args: {
    owner: string;
    repo: string;
    branch: string;
    tip: string;
    createTag: string | undefined;
    holdTag: string | undefined;
  }): ResultAsync<void, IngestError>;
}

/**
 * Build the production ref surface over the write lane's one no-SDK-retry client.
 *
 * @param token the GitHub token
 * @param baseUrl override the API origin, for the local-server transport test only; production never passes it
 * @returns the ref read and mutation seams
 */
export function makeGithubRefsApi({
  token,
  baseUrl,
  privacy,
}: {
  token: string;
  baseUrl?: string;
  privacy: GithubWritePrivacy;
}): GithubRefsApi {
  const ctx = makeGithubWriteCtx(baseUrl === undefined ? { privacy, token } : { baseUrl, privacy, token });
  return {
    branchTip: ({ owner, repo, branch }) => branchTipVia({ ctx, input: { branch, owner, repo } }),
    commitExists: ({ owner, repo, sha }) => commitExistsVia({ ctx, input: { owner, repo, sha } }),
    createTag: ({ owner, repo, tag, sha, message }) => createTagVia({ ctx, input: { message, owner, repo, sha, tag } }),
    defaultBranch: ({ owner, repo }) => defaultBranchVia({ ctx, input: { owner, repo } }),
    deleteBranchAtTip: ({ owner, repo, branch, tip, createTag, holdTag }) =>
      deleteBranchAtTipVia({ ctx, input: { branch, createTag, holdTag, owner, repo, tip } }),
    openPrsOnBranch: ({ owner, repo, branch }) => openPrsOnBranchVia({ ctx, input: { branch, owner, repo } }),
    tagCommit: ({ owner, repo, tag }) => tagCommitVia({ ctx, input: { owner, repo, tag } }),
  };
}
