/**
 * The GitHub write lane's MERGE-QUEUE mutations — `slopweaver github enqueue`'s two writes, in their own
 * file so `./write.ts` stays under the file-size ratchet rather than growing past it.
 *
 * Same lane, same `WriteCtx`, same rules: every `client.graphql` token sits LEXICALLY inside
 * `safeProviderCall(...)`, both mutations are `retryMode: "never"`, and nothing here constructs a second
 * Octokit — the context is passed in.
 *
 * ## Neither mutation's own payload is the confirmation
 *
 * Both return `mergeQueueEntry`, and both discard it. The verb's witness is a SEPARATE read of
 * `PullRequest.mergeQueueEntry` afterwards (`../../live/github/mergeQueue.ts`), for the reason
 * `./writeCrud.ts`'s ready/draft pair states: a mutation that reports its own success is the class of claim
 * this repository refuses, and a queue entry read back through the ordinary read path is the same fact the
 * next invocation would see.
 *
 * That witness is also what the verb does with a FAILURE, and it is why `retryMode: "never"` here stays
 * right rather than becoming an obstacle. This lane would be retrying BLIND, and a blind re-send of an
 * enqueue is a second entry's worth of churn on somebody else's branch. The shell re-sends SIGHTED — only
 * once the witness read has proven no entry exists, so a second send can duplicate nothing. The rule is
 * about what a re-send can DUPLICATE, and `../../cli/commands/github/enqueueFailure.ts` carries the whole
 * argument, the bound of one further send, and the residual race it does not claim to close.
 *
 * ## The THIRD write here is REST, and it is the only one a native-stack member can use
 *
 * {@link enqueueStackPrVia} sends GitHub's asynchronous merge request, because GraphQL's
 * `enqueuePullRequest` refuses a member of a native stack outright — *"This pull request is part of a stack
 * and must be enqueued using the asynchronous merge REST API"*. Its answer IS consumed, unlike the two
 * mutations above, and that is not a departure from the paragraph above: it is consumed for PROGRESS and
 * for FAILURE (`status: "failed"` arrives under an HTTP 200, so the status code alone would report a
 * refusal as a success). The enqueue is still reported successful only by the separate `mergeQueueEntry`
 * read-back.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { type GithubAsyncMergeState, parseGithubAsyncMergeState } from "./mergeAsync.js";
import type { PrRef, WriteCtx } from "./write.js";

/**
 * Add one pull request to its base branch's merge queue — GitHub's own "Merge when ready" button.
 *
 * `expectedHeadOid` is GitHub's optimistic-concurrency guard, exactly as `sha` is on `./writeMerge.ts`'s
 * squash merge: the server refuses the enqueue when the head has moved since it was read, so a force-push
 * landing between the guard's measurement and this call can never be queued unseen.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the pull request's GraphQL node id and the head commit the enqueue is pinned to
 * @returns nothing, or the provider failure; the caller confirms with its own `mergeQueueEntry` read
 */
export function enqueuePrVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { nodeId: string; expectedHeadOid: string };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      await ctx.client.graphql(
        `mutation SlopweaverEnqueuePullRequest($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
          enqueuePullRequest(input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid }) {
            mergeQueueEntry { id position state }
          }
        }`,
        { expectedHeadOid: input.expectedHeadOid, pullRequestId: input.nodeId },
      );
    },
    operation: "github.enqueuePullRequest",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Remove one pull request from its merge queue — the exact inverse of {@link enqueuePrVia}.
 *
 * `DequeuePullRequestInput` names its field `id` rather than `pullRequestId`, and it is still the PULL
 * REQUEST's node id, not the queue entry's. Stated here because the asymmetry with the enqueue mutation
 * directly above reads like a copy error and is not one.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the pull request's GraphQL node id
 * @returns nothing, or the provider failure; the caller confirms with its own `mergeQueueEntry` read
 */
export function dequeuePrVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { nodeId: string };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      await ctx.client.graphql(
        `mutation SlopweaverDequeuePullRequest($id: ID!) {
          dequeuePullRequest(input: { id: $id }) {
            mergeQueueEntry { id }
          }
        }`,
        { id: input.nodeId },
      );
    },
    operation: "github.dequeuePullRequest",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Ask GitHub to put one NATIVE-STACK pull request into its stack's base branch's merge queue.
 *
 * The one write a stack member can take. `merge_action: "merge_queue"` is explicit rather than left to the
 * endpoint's own action selection, since the queue is the whole point of this verb and a `direct_merge`
 * chosen on our behalf would bypass the gate `enqueue` exists to press. `merge_method` is deliberately NOT
 * sent: the queue owns the method, and naming one here would silently override a repository's setting.
 *
 * `sha` is GitHub's optimistic-concurrency guard, the REST spelling of GraphQL's `expectedHeadOid` — the
 * server refuses the request when the head has moved since the guard measured it, so a force-push landing
 * mid-flight can never be queued unseen.
 *
 * `retryMode: "never"`, as both mutations above are: this starts a background job that queues real pull
 * requests, and a re-sent request is a second job's worth of churn on somebody else's stack.
 *
 * Neither this route nor its polling companion has a generated Octokit type yet, so `client.request` is the
 * sanctioned escape hatch (`boundaryResidue`'s `octokit-call` token covers it), exactly as `./writeStack.ts`
 * reaches the native-stack endpoints.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the pull request, and the head commit the request is pinned to
 * @returns the request's accepted state — pending with a uuid to poll, or a terminal status
 */
export function enqueueStackPrVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { readonly expectedHeadOid: string };
}): ResultAsync<GithubAsyncMergeState, IngestError> {
  const { owner, repo, number, expectedHeadOid } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async", {
        merge_action: "merge_queue",
        owner,
        pull_number: number,
        repo,
        sha: expectedHeadOid,
      });
      const state = parseGithubAsyncMergeState({ data: res.data });
      if (state.isErr()) {
        throw new Error(state.error.message);
      }
      return state.value;
    },
    operation: "github.enqueueStackPullRequest",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
