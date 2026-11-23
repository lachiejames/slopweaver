/**
 * GitHub's repository Actions switch — read, and switch OFF — over the sanctioned no-SDK-retry write context.
 *
 * There is no switch ON here: turning hosted Actions on spends runner minutes on every push, so it lives behind
 * `github repo --enable-actions`'s approved digest and stated policy (`./repoActionsPolicy.ts`).
 */

import { disableRepoActionsVia, getRepoActionsVia, type RepoActionsState } from "../../corpus/github/repoActions.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { RepoActionsState } from "../../corpus/github/repoActions.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoActionsApi {
  read(args: { owner: string; repo: string }): ResultAsync<RepoActionsState, IngestError>;
  disable(args: { owner: string; repo: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production client on the write lane's context: SDK retries off, so the switch-off is sent once.
 *
 * @param token the GitHub token
 * @returns the Actions read and the one-way switch-off
 */
export function makeGithubRepoActionsApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoActionsApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    disable: ({ owner, repo }) => disableRepoActionsVia({ ctx, input: { owner, repo } }),
    read: ({ owner, repo }) => getRepoActionsVia({ ctx, input: { owner, repo } }),
  };
}
