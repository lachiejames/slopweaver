/**
 * The read behind `hand post`'s check on a check-in's row: every pull request whose head is one of the row's branches,
 * from GitHub, through the door's GraphQL read. The verdict is `../../../hand/rowPullRequest.ts`'s.
 *
 * Asynchronous where `hand post` is not, so `./post.ts`'s command wrapper runs it BEFORE the verb and hands the
 * answer in through a synchronous seam — the verb, and every test driving it, stays synchronous.
 */
import { originRepositoryOf } from "../../../config.js";
import { type RowPullRequest, type RowPullRequests, rowBranchCandidates } from "../../../hand/rowPullRequest.js";
import { runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { lookupDocBySlug } from "../../../handover/store.js";
import { isRecord } from "../../../lib/parsers.js";
import type { GithubReadGraphql } from "../../../live/github/read.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The page size {@link PULLS_ON_HEAD} asks for — GitHub's GraphQL maximum. */
const PULLS_PER_HEAD = 100;

/**
 * Every pull request on one head branch, in every state, one page of {@link PULLS_PER_HEAD}. A branch carrying more
 * reads as UNREAD rather than as the page: an open one past it would otherwise read as none, which
 * `session close-done` takes as leave to park the seat landing it.
 */
const PULLS_ON_HEAD = `query($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $head, first: ${String(PULLS_PER_HEAD)}, states: [OPEN, MERGED, CLOSED]) {
      nodes { number url state }
      pageInfo { hasNextPage }
    }
  }
}`;

/**
 * Read the pull requests of the row a check-in names.
 *
 * @param home the state home the board and the run journals live under
 * @param row the slug `--row` named
 * @param graphql the door's GraphQL read
 * @returns every pull request on the row's branches, or why they could not be read
 */
export async function readRowPullRequests({
  home,
  row,
  graphql,
}: {
  home: string;
  row: string;
  graphql: GithubReadGraphql;
}): Promise<RowPullRequests> {
  const paths = stateHomePaths({ home });
  const doc = lookupDocBySlug({ handoverDir: paths.handovers, slug: row });
  if (doc === undefined) {
    return { kind: "unread", why: `no board row ${row} under ${paths.handovers}` };
  }
  if (doc.repo === undefined) {
    return { kind: "unread", why: `${row} names no checkout (\`repo:\`) to resolve its repository from` };
  }
  const repository = originRepositoryOf({ cwd: doc.repo });
  if (repository.isErr()) {
    return { kind: "unread", why: `${doc.repo}: ${repository.error.join("; ")}` };
  }
  const journal = readRunJournal({ runsDir: paths.runs, slug: row });
  const recorded = journal.isOk() ? runStateOf({ events: journal.value.events }).branch : undefined;
  const branches = rowBranchCandidates({ declared: doc.branch, recorded, slug: row });
  const { owner, repo } = repository.value;
  const pulls: RowPullRequest[] = [];
  for (const head of branches) {
    const read = await graphql({ query: PULLS_ON_HEAD, variables: { head, name: repo, owner } });
    if (read.isErr()) {
      return { kind: "unread", why: read.error.message };
    }
    const page = pullPageOf({ value: read.value });
    if (page === undefined) {
      return { kind: "unread", why: `GitHub's answer for ${owner}/${repo} head ${head} was not the shape asked for` };
    }
    if (page.more) {
      const why = `${owner}/${repo} head ${head} carries more than ${String(PULLS_PER_HEAD)} pull requests`;
      return { kind: "unread", why: `${why}, so the page read is not all of them` };
    }
    pulls.push(...page.pulls);
  }
  return { branches, kind: "read", pulls, repo: `${owner}/${repo}` };
}

/**
 * The pull requests one answer carries and whether GitHub holds more past the page, or `undefined` when it is not the
 * shape {@link PULLS_ON_HEAD} asks for — a page with no `hasNextPage` included, since silence there is no clearance.
 *
 * @param value GitHub's `data` for one head branch
 * @returns the page's pull requests and whether any lie past it, or `undefined` on any other shape
 */
export function pullPageOf({
  value,
}: {
  value: unknown;
}): { readonly pulls: readonly RowPullRequest[]; readonly more: boolean } | undefined {
  const repository = isRecord(value) ? value["repository"] : undefined;
  const connection = isRecord(repository) ? repository["pullRequests"] : undefined;
  const nodes = isRecord(connection) ? connection["nodes"] : undefined;
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  const more = isRecord(pageInfo) ? pageInfo["hasNextPage"] : undefined;
  if (!Array.isArray(nodes) || typeof more !== "boolean") {
    return undefined;
  }
  const pulls = pullNodesOf({ nodes });
  return pulls === undefined ? undefined : { more, pulls };
}

/** The pull requests a page's `nodes` carry, or `undefined` when one is not the shape {@link PULLS_ON_HEAD} asks for. */
function pullNodesOf({ nodes }: { nodes: readonly unknown[] }): readonly RowPullRequest[] | undefined {
  const pulls: RowPullRequest[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      return undefined;
    }
    const { number, url, state } = node;
    if (typeof number !== "number" || typeof url !== "string") {
      return undefined;
    }
    if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") {
      return undefined;
    }
    pulls.push({ number, state, url });
  }
  return pulls;
}
