/**
 * The read behind `slopweaver github coderabbit-yield`: every pull request one author opened in a window,
 * in each repository, with every review thread and every review body on it.
 *
 * ## Why the window is split
 *
 * GitHub search returns at most 1,000 results per query, and the owner's slopweaver pull requests alone passed that
 * in 60 days (MEASURED: `slopweaver github search 'is:pr author:@me created:>=<iso-date>'`
 * reported 1,113). So a window whose count is over the ceiling is bisected by creation time until every
 * piece fits, and a piece that cannot be split further is a named failure — never its first 1,000 reported
 * as the whole.
 *
 * ## Why the details ride the search page
 *
 * Most of those pull requests carry no CodeRabbit thread at all, so one request per pull request would
 * spend most of the budget learning nothing. Each search page selects its pull requests' first 50 threads
 * (ten comments each) and first 50 reviews inline, and only a connection that has MORE is followed up —
 * so the request count scales with the conversation, not the cohort.
 */

import { err, ok, type Result } from "../../lib/result.js";
import type { YieldPrFacts } from "../../review/coderabbitYield.js";
import { prFacts } from "./coderabbitYieldPr.js";
import { COUNT_QUERY, pageOf, SEARCH_QUERY, VIEWER_QUERY } from "./coderabbitYieldQueries.js";
import { callWalk, fieldOf, type Walk } from "./coderabbitYieldWalk.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** GitHub search's own ceiling on results per query. */
const SEARCH_CEILING = 1000;

/** Pull requests per search page — small, because each carries its threads and review bodies inline. */
const SEARCH_PAGE = 10;

/** The selection one read covers. */
export interface YieldSelection {
  readonly repos: readonly string[];
  readonly author: string;
  readonly sinceIso: string;
  readonly untilIso: string;
}

/** Everything one read gathered, and what it could not. */
export interface YieldDataset {
  readonly prs: readonly YieldPrFacts[];
  /** Each gap in coverage, as a sentence. Empty only when every connection was read to its end. */
  readonly gaps: readonly string[];
  readonly requests: number;
  readonly cost: number;
  readonly remaining: number | undefined;
}

/** GitHub's search timestamp form, seconds precision. */
function stamp({ ms }: { ms: number }): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/u, "+00:00");
}

/** The search string for one repository, author and inclusive creation range. */
function searchString({
  repo,
  author,
  fromMs,
  toMs,
}: {
  repo: string;
  author: string;
  fromMs: number;
  toMs: number;
}): string {
  return `is:pr repo:${repo} author:${author} created:${stamp({ ms: fromMs })}..${stamp({ ms: toMs })}`;
}

/**
 * The creation ranges that each fit under the search ceiling, bisected until they do.
 *
 * @internal
 * @returns inclusive `[fromMs, toMs]` ranges covering the window with no gap and no overlap
 */
export async function fittingRanges({
  walk,
  repo,
  author,
  fromMs,
  toMs,
}: {
  walk: Walk;
  repo: string;
  author: string;
  fromMs: number;
  toMs: number;
}): Promise<Result<readonly (readonly [number, number])[], GithubLiveError>> {
  const response = await callWalk({
    query: COUNT_QUERY,
    variables: { q: searchString({ author, fromMs, repo, toMs }) },
    walk,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const count = fieldOf({ key: "issueCount", value: fieldOf({ key: "search", value: response.value }) });
  if (typeof count !== "number") {
    return err(GithubLiveErrors.readFailed({ message: "GitHub returned no issueCount for a coderabbit-yield window" }));
  }
  if (count <= SEARCH_CEILING) {
    return ok(count === 0 ? [] : [[fromMs, toMs]]);
  }
  if (toMs - fromMs < 2000) {
    return err(
      GithubLiveErrors.readFailed({
        message: `${String(count)} pull requests in one second of ${repo}: cannot split under the search ceiling`,
      }),
    );
  }
  const midMs = Math.floor((fromMs + toMs) / 2000) * 1000;
  const left = await fittingRanges({ author, fromMs, repo, toMs: midMs, walk });
  if (left.isErr()) {
    return left;
  }
  const right = await fittingRanges({ author, fromMs: midMs + 1000, repo, toMs, walk });
  return right.isErr() ? right : ok([...left.value, ...right.value]);
}

/** Read one search page into the sink, and answer the cursor to the next one. */
async function readSearchPage({
  walk,
  query,
  cursor,
  sink,
}: {
  walk: Walk;
  query: string;
  cursor: string | undefined;
  sink: Map<string, YieldPrFacts>;
}): Promise<Result<{ next: string | undefined; read: readonly string[]; count: unknown }, GithubLiveError>> {
  const response = await callWalk({
    query: SEARCH_QUERY,
    variables: { after: cursor, pageSize: SEARCH_PAGE, q: query },
    walk,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const search = fieldOf({ key: "search", value: response.value });
  const page = pageOf({ connection: search, what: "search" });
  if (page.isErr()) {
    return err(page.error);
  }
  const read: string[] = [];
  for (const node of page.value.nodes) {
    const facts = await prFacts({ value: node, walk });
    if (facts.isErr()) {
      return err(facts.error);
    }
    sink.set(facts.value.pr.url, facts.value);
    read.push(facts.value.pr.url);
  }
  walk.progress(`coderabbit-yield: ${String(sink.size)} pull request(s) read, ${String(walk.requests)} request(s)`);
  return ok({
    count: fieldOf({ key: "issueCount", value: search }),
    next: page.value.next,
    read,
  });
}

/** Every pull request in one fitting range, page by page. */
async function readRange({
  walk,
  query,
  sink,
}: {
  walk: Walk;
  query: string;
  sink: Map<string, YieldPrFacts>;
}): Promise<Result<void, GithubLiveError>> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  // Distinct pull requests, so a result GitHub repeats across pages cannot stand in for one it skipped.
  const read = new Set<string>();
  let count: unknown;
  do {
    const page = await readSearchPage({ cursor, query, sink, walk });
    if (page.isErr()) {
      return err(page.error);
    }
    for (const url of page.value.read) {
      read.add(url);
    }
    count = page.value.count;
    if (page.value.next !== undefined && seen.has(page.value.next)) {
      walk.gaps.push(`${query}: GitHub repeated a search cursor instead of advancing`);
      return ok(undefined);
    }
    cursor = page.value.next;
    if (cursor !== undefined) {
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  reconcileRange({ count, query, read: read.size, walk });
  return ok(undefined);
}

/** The search says how many it matched, so a range that ends short of that is unread, not empty. */
function reconcileRange({
  walk,
  query,
  read,
  count,
}: {
  walk: Walk;
  query: string;
  read: number;
  count: unknown;
}): void {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || read < count) {
    walk.gaps.push(`${query}: read ${String(read)} of ${String(count)} matching pull requests`);
  }
}

/**
 * The login the token belongs to — the default author, so an omitted `--author` never widens the search.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @returns the viewer's login, or a read failure
 */
export async function viewerLogin({
  graphql,
}: {
  graphql: GithubReadGraphql;
}): Promise<Result<string, GithubLiveError>> {
  const response = await graphql({ query: VIEWER_QUERY, variables: {} });
  if (response.isErr()) {
    return err(response.error);
  }
  const login = fieldOf({ key: "login", value: fieldOf({ key: "viewer", value: response.value }) });
  return typeof login === "string"
    ? ok(login)
    : err(GithubLiveErrors.readFailed({ message: "GitHub returned no viewer login" }));
}

/**
 * Read every pull request the selection names, with every review thread and CodeRabbit review body on it.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param selection repositories, author and creation window
 * @param progress a sink for one line per page, so a long read is visibly moving
 * @returns the dataset, or the first read failure — a failure is never a short dataset
 */
export async function readCoderabbitYield({
  graphql,
  selection,
  progress,
}: {
  graphql: GithubReadGraphql;
  selection: YieldSelection;
  progress: (line: string) => void;
}): Promise<Result<YieldDataset, GithubLiveError>> {
  const walk: Walk = { cost: 0, gaps: [], graphql, progress, remaining: undefined, requests: 0 };
  const sink = new Map<string, YieldPrFacts>();
  for (const repo of selection.repos) {
    const ranges = await fittingRanges({
      author: selection.author,
      fromMs: Date.parse(selection.sinceIso),
      repo,
      toMs: Date.parse(selection.untilIso),
      walk,
    });
    if (ranges.isErr()) {
      return err(ranges.error);
    }
    for (const [fromMs, toMs] of ranges.value) {
      const read = await readRange({
        query: searchString({ author: selection.author, fromMs, repo, toMs }),
        sink,
        walk,
      });
      if (read.isErr()) {
        return err(read.error);
      }
    }
  }
  return ok({
    cost: walk.cost,
    gaps: walk.gaps,
    prs: [...sink.values()],
    remaining: walk.remaining,
    requests: walk.requests,
  });
}
