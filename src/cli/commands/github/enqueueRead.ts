/**
 * `github enqueue`'s two GitHub reads: the pull request, then its LANDING branch's queue and required contexts.
 *
 * Its own module because the reads decide nothing — `./enqueueRun.ts` holds the verdict and the press, and a
 * reader following those should not have to page past the reads first.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { MergeQueuePrState, MergeQueueState } from "../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
import { type EnqueueTarget, enqueueTarget } from "./enqueueTarget.js";

/** The pull request and its landing branch's queue, as the reads found them. */
export interface EnqueueState {
  readonly pr: MergeQueuePrState;
  readonly target: EnqueueTarget;
  readonly queue: MergeQueueState | undefined;
  readonly requiredContexts: readonly string[];
  readonly requiresCodeOwnerReviews: boolean | undefined;
}

/**
 * Read the pull request and its landing branch's queue, or every reason the reads failed.
 *
 * @param api the merge-queue client
 * @param args the parsed invocation, for the repository and number it names
 * @returns the state, or why a read failed
 */
export async function readEnqueueState({
  api,
  args,
}: {
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
}): Promise<Result<EnqueueState>> {
  const read = await api.read({ number: args.number, owner: args.owner, repo: args.repo });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  // The EFFECTIVE landing branch, not the pull request's own base. A native-stack member above the bottom
  // targets the branch of the member below it, which has no queue, no protection rule and no required
  // contexts — reading those against it would answer a question about the wrong branch. See
  // `./enqueueTarget.ts` for the measurement.
  const target = enqueueTarget({ pr: read.value });
  const queue = await api.queue({ branch: target.branch, owner: args.owner, repo: args.repo });
  if (queue.isErr()) {
    return err([queue.error.message]);
  }
  if (queue.value === undefined) {
    return ok({
      pr: read.value,
      queue: queue.value,
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
      target,
    });
  }
  // Read the base's required contexts only when there IS a queue to gate. With no queue the verb already
  // refuses on that, and an unmeasurable rules read must fail rather than default to "gated" — a silent
  // empty here would restore exactly the ungated press this refusal exists to stop.
  const contexts = await api.requiredContexts({ branch: target.branch, owner: args.owner, repo: args.repo });
  if (contexts.isErr()) {
    return err([contexts.error.message]);
  }
  return ok({
    pr: read.value,
    queue: queue.value,
    requiredContexts: contexts.value.contexts,
    requiresCodeOwnerReviews: contexts.value.requiresCodeOwnerReviews,
    target,
  });
}
