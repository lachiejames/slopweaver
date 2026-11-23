/**
 * The GitHub surface `slopweaver github lap` reads and writes, adapted from the one sanctioned write client and
 * the commit-status seams beside it — small and injectable, so the verb's unit test passes plain fakes.
 */

import type { GithubProtectionReadError } from "../../corpus/github/protectionRead.js";
import { type BranchProtection, makeGithubWriteApi } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import {
  type CommitStatus,
  commitStatusesVia,
  createCommitStatusVia,
  type LapStatusState,
  type RequiredCheckSources,
  requiredCheckSourcesVia,
} from "../../corpus/github/writeStatus.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import { type AdminMergePr, makeGithubAdminMergeApi } from "./adminMerge.js";
import { boundedLapApi, LAP_GITHUB_CALL_TIMEOUT_MS, realLapDeadlineTimer } from "./lapApiDeadline.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable read/write surface; tests provide plain fakes. */
export interface GithubLapApi {
  /** The pull request with its head and GitHub's own base commit, read as one consistent pair. */
  read(args: { owner: string; repo: string; number: number }): ResultAsync<AdminMergePr, IngestError>;
  /**
   * GitHub's merge record of a pull request from the REST read ALONE: its state, and its merge time when it
   * merged. Kept apart from `read` because that one pairs a second, GraphQL read, whose failure would throw away
   * a merge record already read.
   */
  mergeRecord(args: {
    owner: string;
    repo: string;
    number: number;
  }): ResultAsync<{ readonly state: string; readonly mergedAtIso: string | undefined }, IngestError>;
  isAdmin(args: { owner: string; repo: string }): ResultAsync<boolean, IngestError>;
  protection(args: {
    owner: string;
    repo: string;
    branch: string;
  }): ResultAsync<BranchProtection, GithubProtectionReadError | IngestError>;
  /** Each required context and the app it is pinned to — whether a posted status can count for GitHub itself. */
  requiredSources(args: {
    owner: string;
    repo: string;
    branch: string;
  }): ResultAsync<RequiredCheckSources, GithubProtectionReadError | IngestError>;
  postStatus(args: {
    owner: string;
    repo: string;
    sha: string;
    context: string;
    state: LapStatusState;
    description: string;
  }): ResultAsync<CommitStatus, IngestError>;
  statuses(args: { owner: string; repo: string; sha: string }): ResultAsync<readonly CommitStatus[], IngestError>;
}

/**
 * Build the production client, every call behind its own wall deadline (`./lapApiDeadline.ts` says why).
 *
 * @param token the GitHub token
 * @returns the pull-request read, the preflight reads and the status write with its read-back
 */
export function makeGithubLapApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubLapApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  const write = makeGithubWriteApi({ privacy, token });
  const admin = makeGithubAdminMergeApi({ privacy, token });
  const unbounded: GithubLapApi = {
    isAdmin: ({ owner, repo }) => write.canAdmin({ owner, repo }),
    mergeRecord: ({ owner, repo, number }) =>
      write.getPr({ number, owner, repo }).map((pr) => ({ mergedAtIso: pr.mergedAtIso, state: pr.state })),
    postStatus: ({ owner, repo, sha, context, state, description }) =>
      createCommitStatusVia({ ctx, input: { context, description, owner, repo, sha, state } }),
    protection: ({ owner, repo, branch }) => write.branchProtection({ branch, owner, repo }),
    read: ({ owner, repo, number }) => admin.read({ number, owner, repo }),
    requiredSources: ({ owner, repo, branch }) => requiredCheckSourcesVia({ ctx, input: { branch, owner, repo } }),
    statuses: ({ owner, repo, sha }) => commitStatusesVia({ ctx, input: { owner, repo, sha } }),
  };
  return boundedLapApi({ api: unbounded, ms: LAP_GITHUB_CALL_TIMEOUT_MS, timer: realLapDeadlineTimer });
}
