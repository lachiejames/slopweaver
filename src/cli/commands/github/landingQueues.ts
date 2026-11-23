/**
 * Whether each base branch in a `github landing` read has a merge queue — the one read the verb makes per
 * BRANCH rather than per pull request, so it sits beside `./landingRun.ts` rather than inside it.
 */

import { parseRepositorySlug } from "../../../config.js";
import type { Result } from "../../../lib/result.js";
import type { QueueAvailability } from "../../../review/landing.js";
import type { PrReviewState } from "../../../review/reviewState.js";

/** Whether one base branch has a merge queue at all. */
export type QueueFor = (args: {
  home: string | undefined;
  owner: string;
  repo: string;
  branch: string;
}) => Promise<Result<QueueAvailability>>;

/** The key one base branch's queue answer is cached under: `owner/name#branch`. */
function branchKey({ repoSlug, branch }: { repoSlug: string; branch: string }): string {
  return `${repoSlug}#${branch}`;
}

/**
 * Whether each distinct base branch in the read has a merge queue — one call per BRANCH, never per pull
 * request.
 *
 * A failed read becomes `unread` for that branch rather than a failed run, exactly as the required-context
 * read does: losing one test must never cost a reader the twenty-eight answers that did arrive, and an
 * `unread` can only ever hold a row back.
 *
 * @param queueFor the one provider edge, asked once per branch
 * @param home the state home whose credential the read uses
 * @param states every pull request in this run
 * @returns one availability per {@link branchKey}
 */
export async function readQueues({
  queueFor,
  home,
  states,
}: {
  queueFor: QueueFor;
  home: string | undefined;
  states: readonly Pick<PrReviewState, "baseRefName" | "repoSlug">[];
}): Promise<ReadonlyMap<string, QueueAvailability>> {
  const answers = new Map<string, QueueAvailability>();
  const seen = new Map<string, Pick<PrReviewState, "baseRefName" | "repoSlug">>();
  for (const state of states) {
    const key = branchKey({ branch: state.baseRefName, repoSlug: state.repoSlug });
    if (state.repoSlug !== "" && state.baseRefName !== "" && !seen.has(key)) {
      seen.set(key, state);
    }
  }
  for (const [key, state] of seen) {
    const parsed = parseRepositorySlug({ slug: state.repoSlug });
    if (parsed.isErr()) {
      answers.set(key, { kind: "unread", why: `${state.repoSlug} is not an owner/name slug` });
      continue;
    }
    const answered = await queueFor({
      branch: state.baseRefName,
      home,
      owner: parsed.value.owner,
      repo: parsed.value.repo,
    });
    answers.set(key, answered.isErr() ? { kind: "unread", why: answered.error.join("; ") } : answered.value);
  }
  return answers;
}

/**
 * One pull request's queue availability, as {@link readQueues} answered for its base branch.
 *
 * A branch this run never asked about — a pull request with no base branch or no repository slug, which
 * `readQueues` skips — is `unread` rather than a failure: an `unread` can only ever hold a row back, so it is
 * the honest state for a question nobody asked.
 *
 * @param queues every answer `readQueues` produced
 * @param state the pull request whose base branch is looked up
 * @returns the availability, or `unread` when this run made no read for that branch
 */
export function queueAvailabilityOf({
  queues,
  state,
}: {
  queues: ReadonlyMap<string, QueueAvailability>;
  state: Pick<PrReviewState, "baseRefName" | "repoSlug">;
}): QueueAvailability {
  const answered = queues.get(branchKey({ branch: state.baseRefName, repoSlug: state.repoSlug }));
  if (answered === undefined) {
    return { kind: "unread", why: "this run made no queue read for that base branch" };
  }
  return answered;
}
