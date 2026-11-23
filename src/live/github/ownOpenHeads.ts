/**
 * The head branch of every OPEN pull request the token's own account authored, across every repository —
 * what `worktree prune` reads so that a tree whose branch is still under review is never cold.
 *
 * The fleet pushes and opens the owner's pull requests as the token's account, so `viewer.pullRequests` IS their list
 * (`./landedCount.ts` makes the same identification for `author:@me`), and no login is ever written here.
 *
 * It reads the viewer's own `pullRequests(states: OPEN)` connection rather than a search, for the reason
 * `./openCensus.ts` gives: the connection's `totalCount` is exact, where a search index lags a pull request
 * opened a minute ago. **A list that does not add up to that count is a FAILED read, never a short one**: a
 * branch missing from it would read as having no open pull request, which is the exact removal this read
 * exists to stop. The same goes for a node that will not parse and a list past the page cap.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** GitHub's own maximum page size for a connection. */
const PAGE_SIZE = 100;

/** The most pages one read takes — a thousand open pull requests, far past any one account's. */
export const OWN_OPEN_HEADS_PAGE_CAP = 10;

/** One open pull request of the owner's, as much of it as a worktree hold names. */
export interface OpenHead {
  /** `owner/name` of the repository the pull request is open against. */
  readonly repo: string;
  readonly number: number;
  /** The head branch, bare (`fix-x`, never `refs/heads/fix-x`), as git names the branch a tree has out. */
  readonly branch: string;
}

/** One page of the read, parsed. */
export interface OwnOpenHeadsPage {
  readonly totalCount: number;
  readonly nextCursor: string | undefined;
  readonly heads: readonly OpenHead[];
}

/** One page, oldest first, so a pull request opened while the pages are read lands after the cursor. */
const OWN_OPEN_HEADS_QUERY = `query SlopweaverOwnOpenHeads($after: String, $pageSize: Int!) {
  viewer {
    pullRequests(states: OPEN, first: $pageSize, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number headRefName repository { nameWithOwner } }
    }
  }
}`;

/** A read failure worded for this read, so every refusal names where it came from. */
function headsFailed({ why }: { why: string }): GithubLiveError {
  return GithubLiveErrors.readFailed({ message: `GitHub's list of the owner's open pull requests ${why}` });
}

/** One raw node, or `undefined` when it lacks the number, head branch or repository a hold names. */
function headOf({ node }: { node: unknown }): OpenHead | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const { number, headRefName, repository } = node;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return undefined;
  }
  if (typeof headRefName !== "string" || headRefName.length === 0 || !isRecord(repository)) {
    return undefined;
  }
  const repo = repository["nameWithOwner"];
  return typeof repo === "string" && repo.length > 0 ? { branch: headRefName, number, repo } : undefined;
}

/**
 * Parse one raw page.
 *
 * @param data the raw GraphQL response
 * @returns the page, or a read failure naming what was missing
 */
export function parseOwnOpenHeadsPage({ data }: { data: unknown }): Result<OwnOpenHeadsPage, GithubLiveError> {
  const viewer = isRecord(data) ? data["viewer"] : undefined;
  const connection = isRecord(viewer) ? viewer["pullRequests"] : undefined;
  if (!isRecord(connection)) {
    return err(headsFailed({ why: "came back without a viewer or its pull requests" }));
  }
  const { totalCount, nodes, pageInfo } = connection;
  if (typeof totalCount !== "number" || !Array.isArray(nodes) || !isRecord(pageInfo)) {
    return err(headsFailed({ why: "came back without a totalCount, nodes or pageInfo" }));
  }
  const heads: OpenHead[] = [];
  for (const node of nodes) {
    const head = headOf({ node });
    if (head === undefined) {
      return err(headsFailed({ why: "carried a node with no number, head branch or repository" }));
    }
    heads.push(head);
  }
  const { hasNextPage, endCursor } = pageInfo;
  if (hasNextPage !== true) {
    return ok({ heads, nextCursor: undefined, totalCount });
  }
  return typeof endCursor === "string"
    ? ok({ heads, nextCursor: endCursor, totalCount })
    : err(headsFailed({ why: "said there is a next page and gave no cursor to it" }));
}

/**
 * Join every page, refusing pages that do not describe one list.
 *
 * @param pages every page, in the order read
 * @returns each open pull request once, or why the pages do not add up
 */
export function joinOwnOpenHeads({
  pages,
}: {
  pages: readonly OwnOpenHeadsPage[];
}): Result<readonly OpenHead[], GithubLiveError> {
  const last = pages.at(-1);
  if (last === undefined) {
    return err(headsFailed({ why: "read no page" }));
  }
  if (pages.some((page) => page.totalCount !== last.totalCount)) {
    return err(headsFailed({ why: "changed its count between pages — the list moved while it was paged" }));
  }
  const byKey = new Map<string, OpenHead>();
  for (const head of pages.flatMap((page) => page.heads)) {
    byKey.set(`${head.repo}#${String(head.number)}`, head);
  }
  if (byKey.size !== last.totalCount) {
    return err(
      headsFailed({
        why: `listed ${String(byKey.size)} pull request(s) against GitHub's count of ${String(last.totalCount)}`,
      }),
    );
  }
  return ok([...byKey.values()]);
}

/**
 * Read every open pull request of the owner's to its last page.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @returns each open pull request's repository, number and head branch, or why the list could not be read whole
 */
export async function readOwnOpenHeads({
  graphql,
}: {
  graphql: GithubReadGraphql;
}): Promise<Result<readonly OpenHead[], GithubLiveError>> {
  const pages: OwnOpenHeadsPage[] = [];
  let cursor: string | undefined;
  do {
    if (pages.length === OWN_OPEN_HEADS_PAGE_CAP) {
      return err(headsFailed({ why: `ran past ${String(OWN_OPEN_HEADS_PAGE_CAP * PAGE_SIZE)} entries` }));
    }
    const response = await graphql({
      query: OWN_OPEN_HEADS_QUERY,
      variables: { after: cursor, pageSize: PAGE_SIZE },
    });
    const parsed = response.andThen((data) => parseOwnOpenHeadsPage({ data }));
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    pages.push(parsed.value);
    cursor = parsed.value.nextCursor;
  } while (cursor !== undefined);
  return joinOwnOpenHeads({ pages });
}
