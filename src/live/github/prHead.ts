/**
 * One pull request's state and head branch, as GitHub says now — what `handover park --wake-on-checks` reads to
 * tell a seat waiting on its OWN pull request's CI (which keeps its seat) from one waiting on somebody else's.
 *
 * One small GraphQL query, asked once per park. A node with no state or no head branch is a FAILED read, never a
 * blank head: a blank would read as somebody else's pull request and let the seat close mid-landing, which is the
 * exact defect the read exists to stop.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** One pull request's state and the branch its head commits are pushed to (bare, never `refs/heads/…`). */
export interface PrHead {
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly headRefName: string;
  /**
   * The `owner/repo` that branch lives in, which a bare branch name never says: absent when GitHub names none, as
   * for a deleted fork. `handover wake`'s question pass needs it to call a merged pull request the run's OWN.
   */
  readonly headRepository?: string;
  /**
   * The commit the head branch pointed at, frozen at the merge for a merged pull request: absent when GitHub names
   * none. The question pass holds a parked worktree to it, since a branch name outlives the merge.
   */
  readonly headRefOid?: string;
}

/** The injected head seam. Production wraps the same safe GraphQL transport `github read` uses. */
export type FetchPrHead = (args: {
  owner: string;
  repo: string;
  number: number;
}) => Promise<Result<PrHead, GithubLiveError>>;

const PR_HEAD_QUERY = `query SlopweaverPrHead($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      headRefName
      headRefOid
      headRepository {
        nameWithOwner
      }
    }
  }
}`;

/**
 * Parse one raw head response into a typed {@link PrHead}.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/repo#number` this read was for, folded into a failure message
 * @returns the state and head branch, or a named read failure
 */
export function parsePrHead({ data, identity }: { data: unknown; identity: string }): Result<PrHead, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "pull request" }));
  }
  const state = optStr({ value: pullRequest["state"] });
  const headRefName = optStr({ value: pullRequest["headRefName"] });
  if (headRefName === undefined || headRefName.length === 0) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned ${identity} with no head branch` }));
  }
  const headRepo = pullRequest["headRepository"];
  const headRepository = isRecord(headRepo) ? optStr({ value: headRepo["nameWithOwner"] }) : undefined;
  const headRefOid = optStr({ value: pullRequest["headRefOid"] });
  if (state === "OPEN" || state === "MERGED" || state === "CLOSED") {
    return ok({
      headRefName,
      state,
      ...(headRepository === undefined ? {} : { headRepository }),
      ...(headRefOid === undefined ? {} : { headRefOid }),
    });
  }
  return err(GithubLiveErrors.readFailed({ message: `GitHub returned ${identity} with no state it names` }));
}

/**
 * Build the live head seam over an already-safe-wrapped GraphQL transport.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @returns a head fetcher, injectable so a test never touches Octokit
 */
export function makeFetchPrHead({ graphql }: { graphql: GithubReadGraphql }): FetchPrHead {
  return async ({ owner, repo, number }) => {
    const response = await graphql({ query: PR_HEAD_QUERY, variables: { number, owner, repo } });
    if (response.isErr()) {
      return err(response.error);
    }
    return parsePrHead({ data: response.value, identity: `${owner}/${repo}#${String(number)}` });
  };
}
