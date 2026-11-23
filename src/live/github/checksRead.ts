/**
 * The live read behind a checks rollup: the GraphQL it sends, and the walk across however many pages one
 * head's contexts take. Everything it returns is parsed and counted by `./checks.ts`; this file only fetches.
 *
 * Its own module along the seam the two halves already had: the queries and the page walk talk to GitHub,
 * and nothing in `./checks.ts` does.
 */

import { err, ok } from "../../lib/result.js";
import { contextsView, type FetchGithubChecks, headContextsPageOf, parseChecksSnapshot } from "./checks.js";
import { GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/**
 * One page of rollup contexts, as every read of them selects it — the first page and each page after it alike,
 * so a paged read parses the same node shape `parseChecksForCommit` does.
 */
const CONTEXTS_PAGE_SELECTION = `nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion detailsUrl completedAt
                    checkSuite { createdAt workflowRun { databaseId } }
                  }
                  ... on StatusContext { context state targetUrl createdAt }
                }
                pageInfo { hasNextPage endCursor }
                totalCount`;

/**
 * The head-commit selection every rollup read shares, as one GraphQL fragment body.
 *
 * Exported so a sibling read composing its own query — `./mergeQueue.ts`, which needs the rollup alongside
 * fields this module never asks for — selects the SAME shape `parseChecksForCommit` parses. Two hand-copied
 * selections that drift are how one read starts answering a state the parser cannot see. `$limit` is the
 * caller's own variable, so any query embedding this must declare one.
 */
export const CHECKS_ROLLUP_SELECTION = `commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: $limit) {
                ${CONTEXTS_PAGE_SELECTION}
              }
            }
          }
        }
      }`;

const CHECKS_ROLLUP_QUERY = `query SlopweaverChecksRollup($owner: String!, $repo: String!, $number: Int!, $limit: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      baseRefName
      mergeable
      ${CHECKS_ROLLUP_SELECTION}
    }
  }
}`;

/** Every page of the head's contexts after the first, from the cursor the page before it ended on. */
const CHECKS_CONTEXTS_PAGE_QUERY = `query SlopweaverChecksRollupPage($owner: String!, $repo: String!, $number: Int!, $limit: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts(first: $limit, after: $after) {
                ${CONTEXTS_PAGE_SELECTION}
              }
            }
          }
        }
      }
    }
  }
}`;

/** GitHub's own ceiling on one connection page: a `first` above it is refused outright rather than clamped. */
const CONTEXTS_PAGE_MAX = 100;

/**
 * The most contexts a read that DECIDES on a head — a landing press, an enqueue — walks: five pages.
 *
 * A head past it stays truncated and so can never read green. MEASURED: acme-admin heads carry just
 * over 100 contexts, so a one-page read skipped three green bumps the owner had standing-ordered pressed
 * (`../../cli/commands/github/reviewStateChecksCompletion.ts` carries the repro).
 */
export const DECISION_CHECK_LIMIT = 500;

/**
 * Build the live checks-rollup seam over an already-safe-wrapped GraphQL transport.
 *
 * `limit` caps the contexts read in total, not per page. A head carrying more than one page holds is read page
 * by page from each page's end cursor until the cap or the last page, and every page is deduped as one list —
 * a re-run's two halves can land on different pages. MEASURED: one acme-admin pull request carried 100
 * distinct check names on one head, so a single page capped the vulnerability-fix digest's read and it withheld a line
 * whose every end-to-end leg had passed. A page read on a different head than the first is refused, because
 * a list stitched across two commits describes neither.
 *
 * @param graphql the safe-wrapped GraphQL seam — the same one `githubReadGraphql` builds for `github read`
 * @returns a checks fetcher, injectable so a test never touches Octokit
 */
export function makeFetchGithubChecks({ graphql }: { graphql: GithubReadGraphql }): FetchGithubChecks {
  return async ({ owner, repo, number, limit }) => {
    const response = await graphql({
      query: CHECKS_ROLLUP_QUERY,
      variables: { limit: Math.min(limit, CONTEXTS_PAGE_MAX), number, owner, repo },
    });
    if (response.isErr()) {
      return err(response.error);
    }
    const snapshot = parseChecksSnapshot({ data: response.value, identity: `${owner}/${repo}#${String(number)}` });
    const first = headContextsPageOf({ data: response.value });
    if (snapshot.isErr() || first === undefined || !first.page.hasNextPage) {
      return snapshot;
    }
    const nodes = [...first.page.nodes];
    let page = first.page;
    // An empty page claiming more past it would never advance the count, so it ends the read — still truncated.
    while (page.hasNextPage && page.endCursor !== undefined && page.nodes.length > 0 && nodes.length < limit) {
      const next = await graphql({
        query: CHECKS_CONTEXTS_PAGE_QUERY,
        variables: {
          after: page.endCursor,
          limit: Math.min(limit - nodes.length, CONTEXTS_PAGE_MAX),
          number,
          owner,
          repo,
        },
      });
      if (next.isErr()) {
        return err(next.error);
      }
      const read = headContextsPageOf({ data: next.value });
      if (read === undefined) {
        return err(
          GithubLiveErrors.readFailed({ message: "GitHub returned no checks rollup for a page past the first" }),
        );
      }
      if (read.headSha !== first.headSha) {
        return err(
          GithubLiveErrors.readFailed({
            message: `the head moved from ${first.headSha} to ${read.headSha} while its checks were read page by page`,
          }),
        );
      }
      nodes.push(...read.page.nodes);
      page = read.page;
    }
    return ok({ ...snapshot.value, ...contextsView({ hasNextPage: page.hasNextPage, nodes }) });
  };
}
