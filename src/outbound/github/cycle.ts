/** GitHub's test-merge reads and the close-then-reopen behind `github cycle`, from the one sanctioned write client. */

import {
  commitParentsVia,
  mergeQueuedVia,
  mergeRefVia,
  type PullMergeState,
  pullMergeStateVia,
  reopenVia,
} from "../../corpus/github/prCycle.js";
import { branchTipVia } from "../../corpus/github/refs.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** The pull-request state a cycle refuses on, judges freshness by, and confirms with. */
export interface CyclePr {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  /** GitHub's own merge time — the field that tells a merged pull request apart from a closed one. */
  readonly mergedAtIso: string | undefined;
  readonly headSha: string;
  /** Undefined once the fork the head came from is deleted, when a reopen can never succeed. */
  readonly headRepoFullName: string | undefined;
  readonly baseRef: string;
  /** Whether the pull request is a member of a native GitHub stack. */
  readonly stacked: boolean;
  readonly mergeable: boolean | null;
  readonly mergeCommitSha: string | null;
  readonly autoMerge: boolean;
  /** Whether GitHub reports a merge-queue entry, which closing the pull request drops. */
  readonly inMergeQueue: boolean;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubCycleApi {
  read(args: { owner: string; repo: string; number: number }): ResultAsync<CyclePr, IngestError>;
  /** The commit `refs/pull/N/merge` names, or undefined when there is no such ref. */
  mergeRef(args: { owner: string; repo: string; number: number }): ResultAsync<string | undefined, IngestError>;
  parents(args: { owner: string; repo: string; sha: string }): ResultAsync<readonly string[], IngestError>;
  /** The base branch's live tip, or undefined when the branch is gone. */
  baseTip(args: { owner: string; repo: string; branch: string }): ResultAsync<string | undefined, IngestError>;
  close(args: { owner: string; repo: string; number: number }): ResultAsync<void, IngestError>;
  /** The state GitHub's own answer to the reopen carries — `open` when it landed. */
  reopen(args: { owner: string; repo: string; number: number }): ResultAsync<string, IngestError>;
}

/** Narrow a pull request and its merge fields down to what a cycle decides on. */
function toCyclePr({ state, inMergeQueue }: { state: PullMergeState; inMergeQueue: boolean }): CyclePr {
  const { pr } = state;
  return {
    autoMerge: state.autoMerge,
    baseRef: pr.baseRef,
    headRepoFullName: pr.head.repoFullName,
    headSha: pr.head.sha,
    inMergeQueue,
    mergeCommitSha: state.mergeCommitSha,
    mergeable: state.mergeable,
    mergedAtIso: pr.mergedAtIso,
    number: pr.number,
    stacked: pr.stack !== undefined,
    state: pr.state,
    url: pr.htmlUrl,
  };
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the pull-request (with its merge-queue entry), merge-ref, parent and base-tip reads, and the close
 *   and reopen mutations
 */
export function makeGithubCycleApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubCycleApi {
  const api = makeGithubWriteApi({ privacy, token });
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    baseTip: ({ owner, repo, branch }) => branchTipVia({ ctx, input: { branch, owner, repo } }),
    close: ({ owner, repo, number }) => api.closePr({ number, owner, repo }).map(() => undefined),
    mergeRef: ({ owner, repo, number }) => mergeRefVia({ ctx, input: { number, owner, repo } }),
    parents: ({ owner, repo, sha }) => commitParentsVia({ ctx, input: { owner, repo, sha } }),
    read: ({ owner, repo, number }) =>
      pullMergeStateVia({ ctx, input: { number, owner, repo } }).andThen((state) =>
        mergeQueuedVia({ ctx, input: { number, owner, repo } }).map((inMergeQueue) =>
          toCyclePr({ inMergeQueue, state }),
        ),
      ),
    reopen: ({ owner, repo, number }) => reopenVia({ ctx, input: { number, owner, repo } }).map((pr) => pr.state),
  };
}
