/**
 * The GraphQL text both review-state reads send, and the CODEOWNERS aliases one of them asks for.
 *
 * Split out of `./reviewState.ts` so the parser and the API in that file are what a reader opens it for.
 * These are strings GitHub reads, not logic this repository runs, and they are the half of that module that
 * grows whenever a new field is wanted.
 *
 * **One selection produces both reads, and that is the contract rather than a convenience.** The fleet read
 * and the single-pull-request read answer the SAME questions about different selections, and the two drifted
 * the moment they were two selections: the whole point of `--number` is that a reader sees exactly what the
 * table's row was computed from, which is only true while one string produces both.
 *
 * `body @include(if: $withBodies)` is the one conditional. See `./reviewState.ts`'s `PrReviewThread` for the
 * measurement that makes it conditional rather than always-on.
 */

import { REVIEW_REQUEST_EVENTS_SELECTION } from "./reviewRequestEvents.js";
import { REVIEW_REQUESTS_SELECTION } from "./reviewRequests.js";

/** Everything both reads select off one `PullRequest` node, written once. */
const PR_NODE_SELECTION = `
  number title url isDraft createdAt updatedAt reviewDecision baseRefName headRefName mergeable mergeStateStatus
  headRepository { nameWithOwner }
  author { login __typename }
  repository { nameWithOwner defaultBranchRef { name } }
  mergeQueueEntry { position state estimatedTimeToMerge }
  labels(first: $labelLimit) { nodes { name } pageInfo { hasNextPage } }
  files(first: $fileLimit) { nodes { path } pageInfo { hasNextPage } }
  ${REVIEW_REQUESTS_SELECTION}
  ${REVIEW_REQUEST_EVENTS_SELECTION}
  reviews(last: $reviewLimit) {
    nodes {
      author { login __typename } state submittedAt commit { oid }
      onBehalfOf(first: $onBehalfOfLimit) { nodes { combinedSlug } }
    }
    pageInfo { hasNextPage }
    totalCount
  }
  reviewThreads(first: $threadLimit) {
    nodes {
      id isResolved isOutdated path line resolvedBy { login }
      opener: comments(first: 1) {
        nodes { author { login __typename } createdAt body @include(if: $withBodies) }
      }
      tail: comments(last: $threadTailLimit) {
        nodes { author { login } createdAt body @include(if: $withBodies) }
        totalCount
      }
    }
    pageInfo { hasNextPage }
    totalCount
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: $checkLimit) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl checkSuite { createdAt workflowRun { databaseId } } }
              ... on StatusContext { context state targetUrl createdAt }
            }
            pageInfo { hasNextPage }
            totalCount
          }
        }
      }
    }
  }
`;

/** The variables {@link PR_NODE_SELECTION} needs, shared by both queries that embed it. */
const PR_NODE_VARIABLES = `$checkLimit: Int!, $fileLimit: Int!, $reviewLimit: Int!, $threadLimit: Int!,
  $threadTailLimit: Int!, $onBehalfOfLimit: Int!, $labelLimit: Int!, $requestLimit: Int!, $requestEventLimit: Int!,
  $withBodies: Boolean!`;

export const FLEET_QUERY = `query SlopweaverReviewState(
  $q: String!, $after: String, $pageSize: Int!, ${PR_NODE_VARIABLES}
) {
  search(query: $q, type: ISSUE, first: $pageSize, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {${PR_NODE_SELECTION}}
    }
  }
}`;

export const PR_BY_NUMBER_QUERY = `query SlopweaverReviewStatePr(
  $owner: String!, $repo: String!, $number: Int!, ${PR_NODE_VARIABLES}
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {${PR_NODE_SELECTION}}
  }
}`;

export const CODEOWNERS_QUERY = `query SlopweaverCodeowners($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    dotGithub: object(expression: "HEAD:.github/CODEOWNERS") { ... on Blob { text } }
    root: object(expression: "HEAD:CODEOWNERS") { ... on Blob { text } }
    docs: object(expression: "HEAD:docs/CODEOWNERS") { ... on Blob { text } }
  }
}`;

/** GitHub's documented CODEOWNERS precedence, as the aliases the query asks for them under. */
export const CODEOWNERS_ALIASES: readonly (readonly [string, string])[] = [
  ["dotGithub", ".github/CODEOWNERS"],
  ["root", "CODEOWNERS"],
  ["docs", "docs/CODEOWNERS"],
];
