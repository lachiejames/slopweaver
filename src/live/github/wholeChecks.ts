/**
 * Completing a head whose one-page check read was truncated, for the two reads a PRESS is judged on.
 *
 * MEASURED: `acme/acme-admin` heads carry more than the 100 contexts one GraphQL page holds, so
 * nine of the owner's open pull requests read `checksTruncated`, their CI `unknown`, their dispatch `unread`, and the
 * press skipped every one of them — a standing-ordered merge that never happened. The fleet read completes them
 * in `../../cli/commands/github/reviewStateChecksCompletion.ts`; this module holds the ONE acceptance rule that
 * completion shares with the single-pull-request read the press re-judges against, and the merge guard's
 * re-read, so the three cannot drift apart.
 *
 * Accepted only on the same head and only when the list is whole. A re-read landing on a different head is
 * never stitched onto the first: the row stays as read (truncated, so `unknown`, never green), and the merge
 * guard's own read fails by name rather than pressing on half a list.
 */

import { err, ok, type Result } from "../../lib/result.js";
import type { GithubChecksSnapshot } from "./checks.js";
import { DECISION_CHECK_LIMIT, makeFetchGithubChecks } from "./checksRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { MergeQueuePrState } from "./mergeQueue.js";
import type { GithubReadGraphql } from "./read.js";
import type { PrLiveState } from "./reviewState.js";

/** What a head's paged re-read did to a pull request the one-page read saw truncated. */
export type WholeChecksOutcome =
  | { readonly kind: "complete"; readonly pr: PrLiveState }
  | { readonly kind: "head-moved"; readonly readHead: string }
  | { readonly kind: "still-truncated" };

/**
 * Judge a head's paged check list against the pull request its one-page read produced.
 *
 * @param pr the pull request as the one-page read shaped it
 * @param whole the same head's checks, read past the first page
 * @returns the completed pull request, or why it stays as read
 */
export function wholeChecksOutcome({
  pr,
  whole,
}: {
  pr: PrLiveState;
  whole: GithubChecksSnapshot;
}): WholeChecksOutcome {
  if (whole.headSha !== pr.headOid) {
    return { kind: "head-moved", readHead: whole.headSha };
  }
  if (whole.truncated) {
    return { kind: "still-truncated" };
  }
  return {
    kind: "complete",
    pr: {
      ...pr,
      checks: { ...whole, baseRef: pr.checks.baseRef, mergeable: pr.checks.mergeable },
      checksTruncated: false,
    },
  };
}

/**
 * The single-pull-request read's completion: re-read a truncated head whole, or return it exactly as read.
 *
 * A re-read that fails or moves leaves it truncated, which the dispatch gate already holds as unread rather
 * than green — so this never fails the read it completes.
 *
 * @param pr the pull request as the one-page read shaped it
 * @param graphql the same transport the one-page read used
 * @returns the pull request with its whole check list, or as it was read
 */
export async function completedPr({
  pr,
  graphql,
  owner,
  repo,
}: {
  pr: PrLiveState;
  graphql: GithubReadGraphql;
  owner: string;
  repo: string;
}): Promise<PrLiveState> {
  if (!pr.checksTruncated) {
    return pr;
  }
  const whole = await makeFetchGithubChecks({ graphql })({
    limit: DECISION_CHECK_LIMIT,
    number: pr.number,
    owner,
    repo,
  });
  if (whole.isErr()) {
    return pr;
  }
  const outcome = wholeChecksOutcome({ pr, whole: whole.value });
  return outcome.kind === "complete" ? outcome.pr : pr;
}

/**
 * Fold a head's whole paged check list onto a merge-guard read whose one page was truncated.
 *
 * @param state the pull request as its one-page read shaped it
 * @param whole the same head's checks, read past the first page
 * @param identity the `owner/name#number` address, named in a head-moved error
 * @returns the pull request carrying the whole list, or the typed read failure when the head moved between reads
 */
export function withWholeChecks({
  state,
  whole,
  identity,
}: {
  state: MergeQueuePrState;
  whole: GithubChecksSnapshot;
  identity: string;
}): Result<MergeQueuePrState, GithubLiveError> {
  if (whole.headSha !== state.headOid) {
    return err(
      GithubLiveErrors.readFailed({
        message: `${identity}'s head moved from ${state.headOid} to ${whole.headSha} while its checks were read past the first page`,
      }),
    );
  }
  return ok({ ...state, checks: { ...whole, mergeable: state.checks.mergeable } });
}

/**
 * The merge guard's completion: re-read a truncated head whole, refusing by name when it cannot.
 *
 * @param state the pull request as its one-page read shaped it
 * @param graphql the same transport the one-page read used
 * @param identity the `owner/name#number` address, named in a failure
 * @returns the pull request with its whole check list, or the read failure that stops the guard
 */
export async function wholeMergeQueuePr({
  state,
  graphql,
  owner,
  repo,
  number,
  identity,
}: {
  state: MergeQueuePrState;
  graphql: GithubReadGraphql;
  owner: string;
  repo: string;
  number: number;
  identity: string;
}): Promise<Result<MergeQueuePrState, GithubLiveError>> {
  if (!state.checks.truncated) {
    return ok(state);
  }
  const whole = await makeFetchGithubChecks({ graphql })({ limit: DECISION_CHECK_LIMIT, number, owner, repo });
  return whole.isErr() ? err(whole.error) : withWholeChecks({ identity, state, whole: whole.value });
}
