/** GitHub's idempotent draft-to-ready mutation and its inverse, adapted from the one sanctioned write client. */

import { introducedFilesVia } from "../../corpus/github/introducedFiles.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** The pull-request state this transition needs and later confirms. */
export interface ReadyPr {
  readonly draft: boolean;
  readonly nodeId: string;
  readonly number: number;
  readonly url: string;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubReadyApi {
  read(args: { owner: string; repo: string; number: number }): ResultAsync<ReadyPr, IngestError>;
  /** Every path the pull request adds, renames or copies in — the subject of the proof-path refusal. */
  introducedFiles(args: { owner: string; repo: string; number: number }): ResultAsync<readonly string[], IngestError>;
  markReady(args: { nodeId: string }): ResultAsync<void, IngestError>;
  markDraft(args: { nodeId: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the safe read, introduced-files, ready and back-to-draft mutation seams
 */
export function makeGithubReadyApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubReadyApi {
  const api = makeGithubWriteApi({ privacy, token });
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    introducedFiles: ({ owner, repo, number }) => introducedFilesVia({ ctx, input: { number, owner, repo } }),
    markDraft: ({ nodeId }) => api.markPrDraft({ nodeId }),
    markReady: ({ nodeId }) => api.markPrReady({ nodeId }),
    read: ({ owner, repo, number }) =>
      api.getPr({ number, owner, repo }).map((pr) => ({
        draft: pr.draft,
        nodeId: pr.nodeId,
        number: pr.number,
        url: pr.htmlUrl,
      })),
  };
}
