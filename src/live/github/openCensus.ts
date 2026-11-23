/**
 * GitHub's own list of every OPEN pull request on one repository — every author, drafts included — which is
 * the population `github.com/<owner>/<repo>/pulls` counts.
 *
 * The console's pull-requests page must show the same number as GitHub's own page, never ONE open
 * slopweaver pull request of the owner's while GitHub's own page shows 17. The landing read cannot be that
 * number: it is scoped `--author @me` because `--press` and `--register` act only on the owner's, and the supervisor
 * tick leaves drafts out because `--press` refuses them. So the census is a SEPARATE, cheap read beside it —
 * number, title, address, draft flag and author, nothing a landing test needs — and the page counts what the
 * census counts and names every pull request the landing rows do not carry.
 *
 * It reads `repository.pullRequests(states: OPEN)` rather than a search: that connection's `totalCount` is the
 * repository's open count, where a search is a relevance-ranked index with its own lag and the REST search
 * budget is 30 an hour shared by every agent on the token. Oldest first, so a pull request opened while the
 * pages are read lands after the cursor instead of shifting one across a page boundary.
 *
 * **The count and the list must agree, or the census is `unread`.** A list shorter than GitHub's count cannot
 * satisfy "open = placed + named not placed", so a census whose unique nodes do not number `totalCount` — the
 * connection moved while it was paged — is refused rather than published as an exact-looking partial; the next
 * reading retries. MEASURED with `slopweaver github search "is:pr is:open" --repo
 * acme/acme-admin --json` (refused as a sample naming 403 matches): the busiest repository here needs five
 * pages, so {@link CENSUS_PAGE_CAP} is headroom and a repository past it is `unread`, said in its own words.
 */

import { parseRepositorySlug } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** GitHub's own maximum page size for a connection. */
const CENSUS_PAGE_SIZE = 100;

/** The most pages one repository's census reads — a thousand open pull requests. */
export const CENSUS_PAGE_CAP = 10;

/** One open pull request, as much of it as the census needs to name it. */
interface CensusPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly isDraft: boolean;
  /** The author's login; absent when GitHub reports a deleted account. */
  readonly author: string | undefined;
}

/**
 * One repository's census: GitHub's own open list, or why it could not be read.
 *
 * `viewer` is the login the token reads as — what `--author @me` resolved to on the same read — so a consumer
 * can tell the owner's pull requests from everyone else's without a login ever being a constant.
 */
export type RepoCensus =
  | {
      readonly kind: "read";
      readonly repo: string;
      /**
       * When the census's first page was asked for — no later than any datum in it, so a consumer ageing the
       * census from here never calls it younger than it is (the reading's own instant is taken after it).
       */
      readonly startedAtIso: string;
      readonly totalCount: number;
      readonly viewer: string;
      readonly pullRequests: readonly CensusPullRequest[];
    }
  | { readonly kind: "unread"; readonly repo: string; readonly why: string };

/** One page of the census, parsed. */
export interface CensusPage {
  readonly viewer: string;
  readonly totalCount: number;
  readonly nextCursor: string | undefined;
  readonly pullRequests: readonly CensusPullRequest[];
}

/** One page of the census, oldest first; `viewer` is read on every page so the last one names it. */
const OPEN_CENSUS_QUERY = `query SlopweaverOpenCensus($owner: String!, $repo: String!, $after: String, $pageSize: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: $pageSize, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number title url isDraft author { login } }
    }
  }
}`;

/** One raw node, or `undefined` when it lacks the number, title or address a page names it by. */
function censusNodeOf({ node }: { node: unknown }): CensusPullRequest | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const { number, title, url, isDraft, author } = node;
  if (!Number.isInteger(number) || typeof number !== "number" || number <= 0) {
    return undefined;
  }
  if (typeof title !== "string" || typeof url !== "string" || typeof isDraft !== "boolean") {
    return undefined;
  }
  let login: string | undefined;
  if (isRecord(author) && typeof author["login"] === "string") {
    login = author["login"];
  }
  return { author: login, isDraft, number, title, url };
}

/** A read failure worded for the census, so every refusal names the read it came from. */
function censusFailed({ why }: { why: string }): GithubLiveError {
  return GithubLiveErrors.readFailed({ message: `GitHub's open-pull-request census ${why}` });
}

/** The viewer's login and the pull-request connection, or `undefined` when the response lacks either. */
function envelopeOf({ data }: { data: unknown }): { viewer: string; connection: Record<string, unknown> } | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const { viewer, repository } = data;
  if (!isRecord(viewer) || typeof viewer["login"] !== "string" || !isRecord(repository)) {
    return undefined;
  }
  const connection = repository["pullRequests"];
  if (!isRecord(connection)) {
    return undefined;
  }
  return { connection, viewer: viewer["login"] };
}

/**
 * Parse one raw census response.
 *
 * A node that will not parse FAILS the page rather than being dropped: a census that silently lost a pull
 * request is the exact miscount it exists to end.
 *
 * @param data the raw GraphQL response
 * @returns the page, or a read failure naming what was missing
 */
export function parseCensusPage({ data }: { data: unknown }): Result<CensusPage, GithubLiveError> {
  const envelope = envelopeOf({ data });
  if (envelope === undefined) {
    return err(censusFailed({ why: "came back without a viewer or a repository" }));
  }
  const { viewer, connection } = envelope;
  const { totalCount, nodes, pageInfo } = connection;
  if (typeof totalCount !== "number" || !Array.isArray(nodes) || !isRecord(pageInfo)) {
    return err(censusFailed({ why: "came back without a totalCount, nodes or pageInfo" }));
  }
  const pullRequests: CensusPullRequest[] = [];
  for (const node of nodes) {
    const parsed = censusNodeOf({ node });
    if (parsed === undefined) {
      return err(censusFailed({ why: "carried a node with no number, title, url or draft flag" }));
    }
    pullRequests.push(parsed);
  }
  const { hasNextPage, endCursor } = pageInfo;
  if (hasNextPage === true && typeof endCursor !== "string") {
    return err(censusFailed({ why: "said there is a next page and gave no cursor to it" }));
  }
  let nextCursor: string | undefined;
  if (hasNextPage === true && typeof endCursor === "string") {
    nextCursor = endCursor;
  }
  return ok({ nextCursor, pullRequests, totalCount, viewer });
}

/**
 * Join every page of one repository's census, refusing one whose pages do not describe one list.
 *
 * @param repo the `owner/name` the pages were read from
 * @param pages every page, in the order read
 * @param startedAtIso when the first page was asked for
 * @returns the census, or why its pages do not add up
 */
export function joinCensusPages({
  repo,
  pages,
  startedAtIso,
}: {
  repo: string;
  pages: readonly CensusPage[];
  startedAtIso: string;
}): Result<Extract<RepoCensus, { readonly kind: "read" }>, GithubLiveError> {
  const last = pages.at(-1);
  if (last === undefined) {
    return err(censusFailed({ why: "read no page" }));
  }
  if (pages.some((page) => page.totalCount !== last.totalCount || page.viewer !== last.viewer)) {
    return err(censusFailed({ why: "changed its count between pages — the open list moved while it was paged" }));
  }
  const byNumber = new Map<number, CensusPullRequest>();
  for (const page of pages) {
    for (const pr of page.pullRequests) {
      byNumber.set(pr.number, pr);
    }
  }
  if (byNumber.size !== last.totalCount) {
    return err(
      censusFailed({
        why:
          `listed ${String(byNumber.size)} pull request(s) against GitHub's count of ${String(last.totalCount)} — ` +
          "the open list moved while it was paged, so no count is claimed from it",
      }),
    );
  }
  return ok({
    kind: "read",
    pullRequests: [...byNumber.values()],
    repo,
    startedAtIso,
    totalCount: last.totalCount,
    viewer: last.viewer,
  });
}

/**
 * Read one repository's census to its last page.
 *
 * Never throws and never fails the caller: an unreadable census is an `unread` value naming why, because the
 * landing read it rides beside is still worth recording without it.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param repo the `owner/name` to read
 * @param startedAtIso the instant taken before the first page is asked for, carried as the census's own age
 * @returns the census
 */
export async function readOpenCensus({
  graphql,
  repo,
  startedAtIso,
}: {
  graphql: GithubReadGraphql;
  repo: string;
  startedAtIso: string;
}): Promise<RepoCensus> {
  const slug = parseRepositorySlug({ slug: repo });
  if (slug.isErr()) {
    return { kind: "unread", repo, why: slug.error.join("; ") };
  }
  const pages: CensusPage[] = [];
  let cursor: string | undefined;
  do {
    if (pages.length === CENSUS_PAGE_CAP) {
      return {
        kind: "unread",
        repo,
        why: `more than ${String(CENSUS_PAGE_CAP * CENSUS_PAGE_SIZE)} open pull requests — past the census's page cap`,
      };
    }
    const response = await graphql({
      query: OPEN_CENSUS_QUERY,
      variables: { after: cursor, owner: slug.value.owner, pageSize: CENSUS_PAGE_SIZE, repo: slug.value.repo },
    });
    const parsed = response.andThen((data) => parseCensusPage({ data }));
    if (parsed.isErr()) {
      return { kind: "unread", repo, why: parsed.error.message };
    }
    pages.push(parsed.value);
    cursor = parsed.value.nextCursor;
  } while (cursor !== undefined);
  const joined = joinCensusPages({ pages, repo, startedAtIso });
  if (joined.isErr()) {
    return { kind: "unread", repo, why: joined.error.message };
  }
  return joined.value;
}
