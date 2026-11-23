/*
 * The fixture pull request every `pullView` test file beside this one reads: a `github read <pr> --files --json`
 * document whose every drawn field is present, and the view the reader makes of it. These lived in one test file;
 * each behaviour's tests now sit in a file of their own, and only what two or more of them share lives here.
 */

import { type PullView, readPullDocument } from "../../../lib/pullView";

export const PR = "https://github.com/lachiejames/slopweaver/pull/9";

/**
 * A connection of nodes, as GraphQL writes one.
 *
 * @returns the connection wrapping `items`
 */
export const nodes = (...items: readonly object[]): { nodes: readonly object[] } => ({ nodes: items });

/**
 * A comment by `login` at `at`.
 *
 * @returns the comment node, as GitHub's GraphQL writes one
 */
export const comment = ({
  id,
  login,
  at,
  body = "a note",
}: {
  id: string;
  login: string | null;
  at: string;
  body?: string;
}): {
  author: { login: string } | null;
  body: string;
  createdAt: string;
  diffHunk: string;
  id: string;
  url: string;
} => ({
  author: login === null ? null : { login },
  body,
  createdAt: at,
  diffHunk: "@@ -1,2 +1,2 @@\n a\n+b",
  id,
  url: `${PR}#${id}`,
});

/**
 * A submitted review.
 *
 * @returns the review node, as GitHub's GraphQL writes one
 */
export const review = ({
  id,
  login,
  state,
  at,
  body = "",
}: {
  id: string;
  login: string;
  state: string;
  at: string;
  body?: string;
}): {
  author: { login: string };
  body: string;
  id: string;
  onBehalfOf: { nodes: readonly object[] };
  state: string;
  submittedAt: string;
  url: string;
} => ({
  author: { login },
  body,
  id,
  onBehalfOf: nodes(),
  state,
  submittedAt: at,
  url: `${PR}#${id}`,
});

/** The pull request's `data`, every field the reader draws present. */
export const DATA = {
  __typename: "PullRequest",
  additions: 12,
  author: { login: "author" },
  baseRefName: "main",
  body: "the change ![shot](https://x/y.png)",
  changedFiles: 2,
  closedAt: null,
  comments: nodes(comment({ at: "2026-09-29T01:00:00Z", id: "c1", login: "carol" })),
  commits: nodes({
    commit: {
      oid: "abcdef1234",
      statusCheckRollup: {
        contexts: {
          nodes: [
            {
              __typename: "CheckRun",
              conclusion: "SUCCESS",
              detailsUrl: "https://ci/1",
              name: "lint",
              status: "COMPLETED",
            },
            { __typename: "StatusContext", context: "codeowners", state: "PENDING", targetUrl: null },
          ],
          totalCount: 2,
        },
        state: "PENDING",
      },
    },
  }),
  createdAt: "2026-09-29T00:00:00Z",
  deletions: 3,
  files: nodes(
    { additions: 10, deletions: 3, filename: "a.ts", patch: "@@ -1 +1 @@\n-x\n+y", status: "modified" },
    { additions: 2, deletions: 0, filename: "logo.png", previous_filename: "old.png", status: "renamed" },
  ),
  headRefName: "topic",
  isDraft: false,
  labels: nodes({ color: "ededed", name: "dx" }),
  mergeStateStatus: "BLOCKED",
  mergedAt: null,
  number: 9,
  reviewDecision: "REVIEW_REQUIRED",
  reviewRequests: nodes(
    { asCodeOwner: true, requestedReviewer: { __typename: "User", login: "dave" } },
    { asCodeOwner: true, requestedReviewer: { __typename: "Team", combinedSlug: "acme/eng" } },
  ),
  reviewThreads: nodes({
    comments: nodes(comment({ at: "2026-09-29T02:00:00Z", id: "t1c1", login: "bob" })),
    diffSide: "RIGHT",
    id: "t1",
    isOutdated: false,
    isResolved: true,
    line: 1,
    path: "a.ts",
  }),
  reviews: nodes(
    review({ at: "2026-09-29T02:00:00Z", id: "r1", login: "bob", state: "COMMENTED" }),
    review({ at: "2026-09-29T03:00:00Z", body: "looks right", id: "r2", login: "bob", state: "APPROVED" }),
    review({ at: "2026-09-29T04:00:00Z", body: "one more", id: "r3", login: "bob", state: "COMMENTED" }),
  ),
  state: "OPEN",
  title: "A title",
  url: PR,
};

/**
 * A whole document around `data`.
 *
 * @returns the `github read --files --json` document carrying `data`, read at a fixed instant
 */
export const document = (data: object): object => ({
  coverage: { residue: ["data.files has another provider page"] },
  data,
  readAtIso: "2026-09-29T05:00:00Z",
});

/** The fixture read, which every behaviour test starts from. */
export const VIEW: PullView = readPullDocument({ payload: document(DATA) })!;
