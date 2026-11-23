/**
 * GitHub's repository lifecycle writes — create, and make public — over the sanctioned no-SDK-retry write context.
 * Neither is reversible from this side in any way that matters: a created name is claimed, and code once public has
 * been readable by anyone. So `github repo --create` and `--set-public` preview first and send only on the preview's
 * digest (`../../cli/commands/github/repoCreateRun.ts`, `../../cli/commands/github/repoVisibilityRun.ts`).
 */

import {
  createRepoVia,
  type GithubAccount,
  getAccountVia,
  getAuthenticatedAccountVia,
  getRepoLifecycleVia,
  type RepoLifecycleState,
  setRepoPublicVia,
} from "../../corpus/github/repoLifecycle.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { GithubAccount, RepoLifecycleState } from "../../corpus/github/repoLifecycle.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoLifecycleApi {
  authenticatedAccount(): ResultAsync<GithubAccount, IngestError>;
  account(args: { login: string }): ResultAsync<GithubAccount, IngestError>;
  read(args: { owner: string; repo: string }): ResultAsync<RepoLifecycleState, IngestError>;
  create(args: { org: string | undefined; name: string; private: boolean }): ResultAsync<{ id: number }, IngestError>;
  setPublic(args: { owner: string; repo: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production client on the write lane's context: SDK retries off, so each write is sent once.
 *
 * @param privacy the outbound privacy check every write is judged by before it is sent
 * @param token the GitHub token
 * @returns the reads and the two lifecycle writes
 */
export function makeGithubRepoLifecycleApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoLifecycleApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    account: ({ login }) => getAccountVia({ ctx, login }),
    authenticatedAccount: () => getAuthenticatedAccountVia({ ctx }),
    create: (input) => createRepoVia({ ctx, input }),
    read: ({ owner, repo }) => getRepoLifecycleVia({ ctx, input: { owner, repo } }),
    setPublic: ({ owner, repo }) => setRepoPublicVia({ ctx, input: { owner, repo } }),
  };
}
