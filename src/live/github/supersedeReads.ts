/**
 * The two reads `github bump-drive`'s `close-superseded` act decides from: every open pull request of the owner's in
 * one repository, with GitHub's test merge, and every Renovate pull request merged into it since a given instant.
 *
 * **Its own read, not the fleet read's rows.** MEASURED, `slopweaver github bump-drive --repo
 * acme/acme-admin --dry-run` printed "4 dependency bump(s) of 100 open pull request(s)": the fleet read stops at
 * its `--limit` and that repository carries more open pull requests than that, so it saw two of the owner's five
 * open bumps. `viewer.pullRequests` reads the owner's whole list with an exact `totalCount` (a search index lags),
 * and the token's own account IS the owner's (`./ownOpenHeads.ts` makes the same identification), so no login is
 * written here. Ownership rests on that connection alone — no node's author is read back, because it cannot answer
 * with another user's pull request; that is the one input this read trusts GitHub for.
 *
 * **A list that does not add up to GitHub's count is a FAILED read**, and so is a node that will not parse
 * (`./supersedeNodes.ts`), so a pass never reports a short list as the whole one. Both directions of a failure are
 * safe — a failed open read closes nothing, a failed merged read leaves only the `no-diff` arm — and the caller
 * says which happened. The search index lags a pull request opened a minute ago; one that young is not superseded
 * yet either.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { MergedRenovatePr, OwnOpenPr } from "../../review/bumpSupersede.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";
import { mergedPrOf, OWN_PR_FIELDS, ownOpenPrOf } from "./supersedeNodes.js";

/** Search page size. Small, because every open node carries a test merge commit and its parent's tree. */
const PAGE_SIZE = 50;

/** The most pages one read takes. */
export const SUPERSEDE_READ_PAGE_CAP = 10;

/** Oldest first, so a pull request opened while the pages are read lands after the cursor. */
const OWN_OPEN_QUERY = `query SlopweaverOwnOpenBumps($after: String, $pageSize: Int!) {
  viewer {
    pullRequests(states: OPEN, first: $pageSize, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ${OWN_PR_FIELDS} }
    }
  }
}`;

const MERGED_QUERY = `query SlopweaverMergedRenovate($q: String!, $after: String, $pageSize: Int!) {
  search(type: ISSUE, query: $q, first: $pageSize, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title url mergedAt baseRefName repository { nameWithOwner } author { __typename login } } }
  }
}`;

/** One parsed page of a search. */
interface SearchPage<T> {
  readonly issueCount: number;
  readonly nextCursor: string | undefined;
  readonly items: readonly T[];
}

/** A read failure worded for one of these reads. */
function supersedeReadFailed({ what, why }: { what: string; why: string }): GithubLiveError {
  return GithubLiveErrors.readFailed({ message: `GitHub's ${what} ${why}` });
}

/** Where one read's connection sits in the response, and which field carries GitHub's own count of it. */
interface ConnectionShape {
  readonly at: (args: { data: unknown }) => unknown;
  readonly countKey: string;
}

/** `viewer.pullRequests`, counted by `totalCount`. */
const VIEWER_PULL_REQUESTS: ConnectionShape = {
  at: ({ data }) => {
    const viewer = isRecord(data) ? data["viewer"] : undefined;
    return isRecord(viewer) ? viewer["pullRequests"] : undefined;
  },
  countKey: "totalCount",
};

/** `search`, counted by `issueCount`. */
const SEARCH: ConnectionShape = {
  at: ({ data }) => (isRecord(data) ? data["search"] : undefined),
  countKey: "issueCount",
};

/**
 * Parse one raw connection page with a node parser.
 *
 * @param data the raw GraphQL response
 * @param shape where the connection sits and what counts it
 * @param what the read's name, for the failure
 * @param parse the node parser
 * @returns the page, or why it could not be read
 */
function parseConnectionPage<T>({
  data,
  shape,
  what,
  parse,
}: {
  data: unknown;
  shape: ConnectionShape;
  what: string;
  parse: (args: { node: unknown }) => T | undefined;
}): Result<SearchPage<T>, GithubLiveError> {
  const connection = shape.at({ data });
  if (!isRecord(connection)) {
    return err(supersedeReadFailed({ what, why: "came back without its connection" }));
  }
  const { nodes, pageInfo } = connection;
  const issueCount = connection[shape.countKey];
  if (typeof issueCount !== "number" || !Array.isArray(nodes) || !isRecord(pageInfo)) {
    return err(supersedeReadFailed({ what, why: `came back without a ${shape.countKey}, nodes or pageInfo` }));
  }
  const items: T[] = [];
  for (const node of nodes) {
    const item = parse({ node });
    if (item === undefined) {
      return err(
        supersedeReadFailed({
          what,
          why: "carried a node missing a field this decision reads, or one it did not ask for",
        }),
      );
    }
    items.push(item);
  }
  if (pageInfo["hasNextPage"] !== true) {
    return ok({ issueCount, items, nextCursor: undefined });
  }
  const cursor = pageInfo["endCursor"];
  return typeof cursor === "string"
    ? ok({ issueCount, items, nextCursor: cursor })
    : err(supersedeReadFailed({ what, why: "said there is a next page and gave no cursor to it" }));
}

/**
 * Read every page of one connection, refusing one whose count moved between pages, which repeats an entry, or
 * which does not add up to GitHub's own count.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param query the paged query
 * @param variables what the query takes besides its cursor and page size
 * @param shape where the connection sits and what counts it
 * @param what the read's name, for the failure
 * @param parse the node parser
 * @returns every entry, or why the list could not be read whole
 */
async function readWholeConnection<T extends { readonly url: string }>({
  graphql,
  query,
  variables,
  shape,
  what,
  parse,
}: {
  graphql: GithubReadGraphql;
  query: string;
  variables: Readonly<Record<string, unknown>>;
  shape: ConnectionShape;
  what: string;
  parse: (args: { node: unknown }) => T | undefined;
}): Promise<Result<readonly T[], GithubLiveError>> {
  const pages: SearchPage<T>[] = [];
  let cursor: string | undefined;
  do {
    if (pages.length === SUPERSEDE_READ_PAGE_CAP) {
      return err(supersedeReadFailed({ what, why: `ran past ${String(SUPERSEDE_READ_PAGE_CAP * PAGE_SIZE)} entries` }));
    }
    const response = await graphql({ query, variables: { ...variables, after: cursor, pageSize: PAGE_SIZE } });
    const page = response.andThen((data) => parseConnectionPage({ data, parse, shape, what }));
    if (page.isErr()) {
      return err(page.error);
    }
    pages.push(page.value);
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);
  const count = pages[0]!.issueCount;
  if (pages.some((page) => page.issueCount !== count)) {
    return err(
      supersedeReadFailed({ what, why: "changed its count between pages — the list moved while it was paged" }),
    );
  }
  // Keyed the way every identity check here compares a url, case-insensitively, so two spellings of one pull
  // request count once and cannot stand in for one the list left out.
  const byUrl = new Map(pages.flatMap((page) => page.items).map((item) => [item.url.toLowerCase(), item]));
  if (byUrl.size !== count) {
    return err(
      supersedeReadFailed({ what, why: `listed ${String(byUrl.size)} against its count of ${String(count)}` }),
    );
  }
  return ok([...byUrl.values()]);
}

/**
 * Every open pull request of the owner's in one repository, off the owner's WHOLE open list so the count GitHub
 * gives is exact.
 *
 * @param graphql the safe-wrapped GraphQL seam, authenticated as the owner
 * @param repoSlug `owner/name`
 * @returns each pull request with its test merge, or why the list could not be read whole
 */
export async function readOwnOpenPrs({
  graphql,
  repoSlug,
}: {
  graphql: GithubReadGraphql;
  repoSlug: string;
}): Promise<Result<readonly OwnOpenPr[], GithubLiveError>> {
  const all = await readWholeConnection({
    graphql,
    parse: ownOpenPrOf,
    query: OWN_OPEN_QUERY,
    shape: VIEWER_PULL_REQUESTS,
    variables: {},
    what: "list of the owner's open pull requests",
  });
  return all.map((prs) => prs.filter((pr) => pr.repoSlug.toLowerCase() === repoSlug.toLowerCase()));
}

/*
 * Every Renovate identity is searched as GitHub SEARCH spells it: each is a GitHub App, so `app/<name>` — the
 * `renovateSearchAuthors` of `../../organisation/dependencyBots.ts`, built from the generic App and the
 * organisation's own `dependencyBots`, and passed in by the caller.
 *
 * MEASURED against the team repository's self-hosted Renovate App: the bare `author:<login>` through
 * `slopweaver github search "is:pr is:merged author:<login>"` is a 422 ("The listed users cannot be searched … do
 * not exist"), while `author:app/<login>` listed its merges. Through GraphQL the bare login answered an EMPTY list
 * rather than an error, so a wrong spelling here reads as "Renovate merged nothing" — which is why the spelling is
 * built in one place and pinned by its test.
 */

/**
 * Every pull request one Renovate identity merged into one repository since an instant.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param repoSlug `owner/name`
 * @param author one Renovate identity as search spells it, `app/<login>`
 * @param sinceIso the earliest merge instant asked about
 * @returns each merged pull request, or why the list could not be read whole
 */
export async function readMergedRenovatePrs({
  graphql,
  repoSlug,
  author,
  sinceIso,
}: {
  graphql: GithubReadGraphql;
  repoSlug: string;
  author: string;
  sinceIso: string;
}): Promise<Result<readonly MergedRenovatePr[], GithubLiveError>> {
  return readWholeConnection({
    graphql,
    parse: ({ node }) => mergedPrOf({ author, node, repoSlug, sinceIso }),
    query: MERGED_QUERY,
    shape: SEARCH,
    variables: { q: mergedSearchTerm({ author, repoSlug, sinceIso }) },
    what: `list of ${author}'s pull requests merged into ${repoSlug}`,
  });
}

/**
 * The search term for one identity's merges, to the second: search reads a bare date as a whole day.
 *
 * @param repoSlug `owner/name`
 * @param author one Renovate identity as search spells it, `app/<login>`
 * @param sinceIso the earliest merge instant asked about
 * @returns the `q` the merged read sends
 */
export function mergedSearchTerm({
  repoSlug,
  author,
  sinceIso,
}: {
  repoSlug: string;
  author: string;
  sinceIso: string;
}): string {
  return `repo:${repoSlug} is:pr is:merged author:${author} merged:>=${sinceIso.slice(0, 19)}Z`;
}
