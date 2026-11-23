/**
 * GitHub's repository administration — read, rename, transfer, archive — over the sanctioned no-SDK-retry write
 * context. Every write here is irreversible from this side (there is no unarchive, and a transfer out may not be
 * transferable back), so the verb previews first and sends only on the preview's digest
 * (`../../cli/commands/github/repoAdministrationRun.ts`).
 */

import {
  archiveRepoVia,
  getRepoAdministrationVia,
  type RepoAdministrationState,
  renameRepoVia,
  transferRepoVia,
} from "../../corpus/github/repoAdministration.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { RepoAdministrationState } from "../../corpus/github/repoAdministration.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoAdministrationApi {
  read(args: { owner: string; repo: string }): ResultAsync<RepoAdministrationState, IngestError>;
  rename(args: { owner: string; repo: string; newName: string }): ResultAsync<void, IngestError>;
  transfer(args: { owner: string; repo: string; newOwner: string }): ResultAsync<void, IngestError>;
  archive(args: { owner: string; repo: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production client on the write lane's context: SDK retries off, so each write is sent once.
 *
 * @param token the GitHub token
 * @returns the state read and the three administration writes
 */
export function makeGithubRepoAdministrationApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoAdministrationApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    archive: ({ owner, repo }) => archiveRepoVia({ ctx, input: { owner, repo } }),
    read: ({ owner, repo }) => getRepoAdministrationVia({ ctx, input: { owner, repo } }),
    rename: ({ owner, repo, newName }) => renameRepoVia({ ctx, input: { newName, owner, repo } }),
    transfer: ({ owner, repo, newOwner }) => transferRepoVia({ ctx, input: { newOwner, owner, repo } }),
  };
}
