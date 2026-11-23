/**
 * Whether one pull request has ENDED, as GitHub says now: its state, and the commit or instant that ended it.
 *
 * The landing read only ever sees OPEN pull requests, so a board row it registered about one that has since
 * merged was settled by nothing — the landing row for a slopweaver pull request sat ready for ten
 * hours after it merged, and a seat was spent finding that out. This read is the
 * witness the settle carries (`../../review/landingClosure.ts`): a merge commit, or a close instant, never an
 * inference from a pull request's absence from the open list.
 *
 * One small GraphQL query per pull request, asked only for a row the open census no longer lists.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** One pull request's ending, or that it has none yet. */
export type PrClosure =
  | { readonly state: "OPEN"; readonly url: string }
  | { readonly state: "MERGED"; readonly url: string; readonly mergeCommitOid: string; readonly mergedAt: string }
  | { readonly state: "CLOSED"; readonly url: string; readonly closedAt: string };

/** The injected closure seam. Production wraps the same safe GraphQL transport `github read` uses. */
export type FetchPrClosure = (args: {
  owner: string;
  repo: string;
  number: number;
}) => Promise<Result<PrClosure, GithubLiveError>>;

const PR_CLOSURE_QUERY = `query SlopweaverPrClosure($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      url
      mergedAt
      closedAt
      mergeCommit { oid }
    }
  }
}`;

/**
 * Parse one raw closure response into a typed {@link PrClosure}.
 *
 * A MERGED pull request with no merge commit, or a CLOSED one with no close instant, is a read failure rather
 * than an ending with a blank witness: the settle this feeds is only as good as what it names.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/repo#number` this read was for, folded into a failure message
 * @returns the typed closure, or a named read failure
 */
export function parsePrClosure({
  data,
  identity,
}: {
  data: unknown;
  identity: string;
}): Result<PrClosure, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "pull request" }));
  }
  const state = optStr({ value: pullRequest["state"] });
  const url = optStr({ value: pullRequest["url"] });
  if (url === undefined) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned ${identity} with no url` }));
  }
  if (state === "OPEN") {
    return ok({ state, url });
  }
  return endedClosure({ identity, pullRequest, state, url });
}

/** The MERGED or CLOSED half of {@link parsePrClosure}, each refused without the field its witness names. */
function endedClosure({
  pullRequest,
  state,
  url,
  identity,
}: {
  pullRequest: Record<string, unknown>;
  state: string | undefined;
  url: string;
  identity: string;
}): Result<PrClosure, GithubLiveError> {
  if (state === "MERGED") {
    const commit = pullRequest["mergeCommit"];
    const mergeCommitOid = isRecord(commit) ? optStr({ value: commit["oid"] }) : undefined;
    const mergedAt = optStr({ value: pullRequest["mergedAt"] });
    if (mergeCommitOid === undefined || mergedAt === undefined) {
      return err(GithubLiveErrors.readFailed({ message: `GitHub reads ${identity} MERGED with no merge commit` }));
    }
    return ok({ mergeCommitOid, mergedAt, state, url });
  }
  if (state === "CLOSED") {
    const closedAt = optStr({ value: pullRequest["closedAt"] });
    if (closedAt === undefined) {
      return err(GithubLiveErrors.readFailed({ message: `GitHub reads ${identity} CLOSED with no close instant` }));
    }
    return ok({ closedAt, state, url });
  }
  return err(GithubLiveErrors.readFailed({ message: `GitHub returned ${identity} with no state it names` }));
}

/**
 * Build the live closure seam over an already-safe-wrapped GraphQL transport.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @returns a closure fetcher, injectable so a test never touches Octokit
 */
export function makeFetchPrClosure({ graphql }: { graphql: GithubReadGraphql }): FetchPrClosure {
  return async ({ owner, repo, number }) => {
    const response = await graphql({ query: PR_CLOSURE_QUERY, variables: { number, owner, repo } });
    if (response.isErr()) {
      return err(response.error);
    }
    return parsePrClosure({ data: response.value, identity: `${owner}/${repo}#${String(number)}` });
  };
}
