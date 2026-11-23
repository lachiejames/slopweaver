/** GitHub's repository-description read/write, adapted from the one sanctioned write client. */

import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** A repository's description, as read or as GitHub confirmed storing it. */
export interface RepoDescription {
  readonly description: string | undefined;
  readonly htmlUrl: string;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoDescriptionApi {
  read(args: { owner: string; repo: string }): ResultAsync<RepoDescription, IngestError>;
  setDescription(args: { owner: string; repo: string; description: string }): ResultAsync<RepoDescription, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the safe read and description-mutation seams
 */
export function makeGithubRepoDescriptionApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoDescriptionApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    read: ({ owner, repo }) => api.getRepoDescription({ owner, repo }),
    setDescription: ({ owner, repo, description }) => api.setRepoDescription({ description, owner, repo }),
  };
}
