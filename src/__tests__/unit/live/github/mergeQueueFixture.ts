/**
 * The GraphQL payload `parseMergeQueuePr` reads, as one builder the merge-queue tests share: every field a
 * case is not about defaults to an unqueued, approved, green pull request.
 */
/** The pull request every payload describes, as a read names it. */
export const IDENTITY = "acme/widget#9";

/**
 * One merge-queue read's payload, with only the fields a case overrides changed.
 *
 * @param pageInfo the contexts page's own paging, so a head past one page can be stood up
 * @param oid the head commit, so a re-read landing on a moved head can be stood up
 * @returns the shaped payload, as GitHub's GraphQL answer would decode
 */
export function prData({
  entry = null,
  reviews = [],
  reviewDecision = "APPROVED",
  mergeStateStatus = "CLEAN",
  contexts = [],
  rollupState = "SUCCESS",
  state = "OPEN",
  isDraft = false,
  stack = null,
  stackEntry = null,
  pageInfo = { hasNextPage: false },
  oid = "cafe1234",
}: {
  entry?: Record<string, unknown> | null;
  reviews?: readonly Record<string, unknown>[];
  reviewDecision?: string | null;
  mergeStateStatus?: string | null;
  contexts?: readonly Record<string, unknown>[];
  rollupState?: string;
  state?: string;
  isDraft?: boolean;
  stack?: unknown;
  stackEntry?: unknown;
  pageInfo?: { hasNextPage: boolean; endCursor?: string };
  oid?: string;
}): unknown {
  const rollup = { contexts: { nodes: contexts, pageInfo }, state: rollupState };
  return {
    repository: {
      pullRequest: {
        baseRefName: "main",
        baseRefOid: "ba5e0000",
        body: "Fixes the widget.",
        headRefName: "feature",
        commits: { nodes: [{ commit: { oid, statusCheckRollup: rollup } }] },
        id: "PR_kwabc",
        isDraft,
        latestOpinionatedReviews: { nodes: reviews },
        mergeQueueEntry: entry,
        mergeStateStatus,
        mergeable: "MERGEABLE",
        number: 9,
        reviewDecision,
        stack,
        stackEntry,
        state,
        url: "https://example.invalid/pr/9",
      },
    },
  };
}
