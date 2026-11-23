/**
 * The two GraphQL documents `./read.ts`'s single-object read sends: one for an issue or pull request, one for a
 * discussion. Every field is selected raw; `./read.ts` validates none of them bar `__typename`, refusing an `Issue`
 * that answered a pull-request address.
 */

/**
 * Every connection below is capped with `first: $limit` except `reviews`, deliberately `last: $limit`.
 * GitHub's `reviews` connection carries no `orderBy` and is always oldest-first, so a PR's approvals —
 * which land at the end of its review history — are exactly what a `first`-capped page drops on any PR
 * with more review events than `$limit`. `last` keeps the newest `$limit` instead, matching
 * `reviewState.ts`'s own reviews read.
 *
 * A pull request's ORDER is load-bearing too, because `data` is this node verbatim and GitHub answers fields
 * in the order they are selected. So its state and CI rollup come first, then `body`, then every activity
 * connection. The console voice reads this verb through `talk verb`, which keeps the first
 * `VERB_OUTPUT_MAX_BYTES` (20 KiB) of stdout. When the rollup was selected last, a busy PR's CI state fell
 * past that cut, and the voice could not say whether a PR was green. MEASURED: an acme-admin pull request
 * printed 273,990 bytes (`slopweaver github read https://github.com/acme/acme-admin/pull/<number> --json | wc -c`).
 * Under `--files`, `diffOnBase.ts` places its receipt ahead of `commits`, and its per-file list last, for the same reason.
 */
export const ISSUE_OR_PULL_REQUEST_QUERY = `query SlopweaverReadIssueOrPullRequest(
  $owner: String!, $repo: String!, $number: Int!, $limit: Int!
) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        id number title body url state createdAt updatedAt closedAt
        author { login }
        labels(first: $limit) { nodes { name color } pageInfo { hasNextPage endCursor } totalCount }
        comments(first: $limit) {
          nodes { id author { login } body url createdAt updatedAt }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
      ... on PullRequest {
        id number title url state isDraft merged mergedAt createdAt updatedAt closedAt
        author { login }
        baseRefName headRefName isCrossRepository mergeable mergeStateStatus reviewDecision
        additions deletions changedFiles
        commits(last: 1) {
          nodes {
            commit {
              oid committedDate url
              statusCheckRollup {
                state
                contexts(first: $limit) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt }
                    ... on StatusContext { context state targetUrl description createdAt }
                  }
                  pageInfo { hasNextPage endCursor }
                  totalCount
                }
              }
            }
          }
          totalCount
        }
        body
        stack {
          number baseRefName size
          entries(first: $limit) {
            nodes { position pullRequest { number title state } }
            pageInfo { hasNextPage endCursor }
            totalCount
          }
        }
        stackEntry { position }
        labels(first: $limit) { nodes { name color } pageInfo { hasNextPage endCursor } totalCount }
        comments(first: $limit) {
          nodes { id author { login } body url createdAt updatedAt }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
        reviewRequests(first: $limit) {
          nodes {
            asCodeOwner
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Team { slug combinedSlug }
            }
          }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
        reviews(last: $limit) {
          nodes {
            id author { login } body url state submittedAt updatedAt
            onBehalfOf(first: $limit) {
              nodes { slug combinedSlug }
              pageInfo { hasNextPage endCursor }
              totalCount
            }
          }
          pageInfo { hasPreviousPage startCursor }
          totalCount
        }
        reviewThreads(first: $limit) {
          nodes {
            id isResolved isOutdated path line diffSide
            comments(first: $limit) {
              nodes { id author { login } body url createdAt updatedAt diffHunk originalLine }
              pageInfo { hasNextPage endCursor }
              totalCount
            }
          }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    }
  }
}`;

/** A discussion with its comments and each comment's replies, every connection capped at `$limit`. */
export const DISCUSSION_QUERY = `query SlopweaverReadDiscussion($owner: String!, $repo: String!, $number: Int!, $limit: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id number title body url createdAt updatedAt closedAt isAnswered
      author { login }
      category { name slug }
      answer { id url }
      comments(first: $limit) {
        nodes {
          id author { login } body url createdAt updatedAt
          replies(first: $limit) {
            nodes { id author { login } body url createdAt updatedAt }
            pageInfo { hasNextPage endCursor }
            totalCount
          }
        }
        pageInfo { hasNextPage endCursor }
        totalCount
      }
    }
  }
}`;
