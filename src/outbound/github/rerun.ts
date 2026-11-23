/** GitHub's workflow-run read and failed-job re-run, adapted from the one sanctioned write client. */

import {
  rerunFailedJobsVia,
  runsForHeadVia,
  type WorkflowRunState,
  workflowRunVia,
} from "../../corpus/github/workflowRuns.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { WorkflowRunState } from "../../corpus/github/workflowRuns.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRerunApi {
  run(args: { owner: string; repo: string; runId: number }): ResultAsync<WorkflowRunState, IngestError>;
  /** The commit a pull request's head points at now — the runs `--number` re-runs are that commit's. */
  prHeadSha(args: { owner: string; repo: string; number: number }): ResultAsync<string, IngestError>;
  runsForHead(args: {
    owner: string;
    repo: string;
    headSha: string;
  }): ResultAsync<{ readonly runs: readonly WorkflowRunState[]; readonly truncated: boolean }, IngestError>;
  rerunFailed(args: { owner: string; repo: string; runId: number }): ResultAsync<void, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the run read, head-SHA read, per-commit run list and failed-job re-run seams
 */
export function makeGithubRerunApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubRerunApi {
  const api = makeGithubWriteApi({ privacy, token });
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    prHeadSha: ({ owner, repo, number }) => api.getPr({ number, owner, repo }).map((pr) => pr.head.sha),
    rerunFailed: ({ owner, repo, runId }) => rerunFailedJobsVia({ ctx, input: { owner, repo, runId } }),
    run: ({ owner, repo, runId }) => workflowRunVia({ ctx, input: { owner, repo, runId } }),
    runsForHead: ({ owner, repo, headSha }) => runsForHeadVia({ ctx, input: { headSha, owner, repo } }),
  };
}
