/**
 * The merge-queue surface `slopweaver github enqueue` is built on — the same shape `./adminMerge.ts` uses,
 * and for the same reason: the command keeps one small injectable seam it can fake in a unit test, and the
 * two transports stay where they belong.
 *
 * ## Why the reads and the writes come from different clients
 *
 * The reads are ordinary GraphQL queries and ride the retrying READ client (`../../live/github/read.ts`),
 * because a repeated query is free. The three mutations ride the no-retry WRITE lane
 * (`../../corpus/github/writeQueue.ts`), because enqueuing twice is not: a re-sent enqueue is a second
 * entry's worth of queue churn on somebody else's branch. That split is the whole reason this file exists
 * rather than the command wiring both itself.
 *
 * The asynchronous merge request's POLL sits on the read side of that line for the same reason everything
 * else there does — repeating a GET is free — even though its subject is a write already in flight.
 *
 * **Two clients are not two connections.** Both ride the global `fetch`, so both draw on ONE undici
 * dispatcher pool per origin: MEASURED with `diagnostics_channel`'s `undici:client:connected`, the three
 * reads and the `enqueuePullRequest` mutation below opened a single socket between them. The split keeps
 * the RETRY POLICIES apart, which is what it was for; it does not isolate the transport, and the mutation
 * inherits whatever socket the retrying read client last parked. What that costs is asymmetric and is the
 * whole of the finding: the read client's own retry plugin absorbs a dropped connection
 * invisibly, while the write lane — `retries: 0` and `retryMode: "never"` — has it as a fatal error. The
 * recovery is in `../../cli/commands/github/enqueueFailure.ts`, not here: the lane stays blind and
 * single-shot, and the SHELL decides what to do about it with the witness read in hand.
 *
 * Nothing here DECIDES anything. Whether the pull request may be queued at all is judged by the pure core in
 * `../../cli/commands/github/enqueueCore.ts`, which refuses with the exact reason that failed.
 */

import type { GithubAsyncMergeState } from "../../corpus/github/mergeAsync.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { Result, ResultAsync } from "../../lib/result.js";
import type { RequiredCheckContexts } from "../../live/github/branchProtection.js";
import type { GithubLiveError } from "../../live/github/errors.js";
import { type FetchGithubAsyncMerge, makeFetchGithubAsyncMerge } from "../../live/github/mergeAsync.js";
import {
  type GithubMergeQueueReads,
  type MergeQueuePrState,
  type MergeQueueState,
  makeGithubMergeQueueReads,
} from "../../live/github/mergeQueue.js";
import { githubReadGraphql, githubReadRest } from "../../live/github/read.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable read/enqueue/dequeue surface; tests provide plain fakes. */
export interface GithubMergeQueueApi {
  /** The pull request's queue-relevant state — the guard's whole input, and the witness's read-back. */
  read(args: { owner: string; repo: string; number: number }): Promise<Result<MergeQueuePrState, GithubLiveError>>;
  /** The merge queue on one branch, or `undefined` when that branch has none. */
  queue(args: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<Result<MergeQueueState | undefined, GithubLiveError>>;
  /** The status-check contexts the base branch requires — empty means its queue gates on nothing. */
  requiredContexts(args: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<Result<RequiredCheckContexts, GithubLiveError>>;
  enqueue(args: { nodeId: string; expectedHeadOid: string }): ResultAsync<void, IngestError>;
  /**
   * The one enqueue a NATIVE-STACK member can take — GitHub's asynchronous merge request, `merge_queue`
   * action. Its answer reports what GitHub accepted, never that the entry exists; `read` is still the
   * witness.
   */
  enqueueStack(args: {
    owner: string;
    repo: string;
    number: number;
    expectedHeadOid: string;
  }): ResultAsync<GithubAsyncMergeState, IngestError>;
  /** One in-flight asynchronous merge request's current state, by the uuid its acceptance named. */
  asyncMergeResult: FetchGithubAsyncMerge;
  dequeue(args: { nodeId: string }): ResultAsync<void, IngestError>;
}

/**
 * Build the production merge-queue client.
 *
 * @param token the GitHub token
 * @returns the safe read, enqueue and dequeue seams
 */
export function makeGithubMergeQueueApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubMergeQueueApi {
  const rest = githubReadRest({ token });
  const reads: GithubMergeQueueReads = makeGithubMergeQueueReads({
    graphql: githubReadGraphql({ token }),
    rest,
  });
  const writes = makeGithubWriteApi({ privacy, token });
  return {
    asyncMergeResult: makeFetchGithubAsyncMerge({ rest }),
    dequeue: ({ nodeId }) => writes.dequeuePr({ nodeId }),
    enqueue: ({ nodeId, expectedHeadOid }) => writes.enqueuePr({ expectedHeadOid, nodeId }),
    enqueueStack: ({ owner, repo, number, expectedHeadOid }) =>
      writes.enqueueStackPr({ expectedHeadOid, number, owner, repo }),
    queue: ({ owner, repo, branch }) => reads.queue({ branch, owner, repo }),
    read: ({ owner, repo, number }) => reads.pr({ number, owner, repo }),
    requiredContexts: ({ owner, repo, branch }) => reads.requiredContexts({ branch, owner, repo }),
  };
}
