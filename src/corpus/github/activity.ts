/**
 * The GitHub activity lane: one GraphQL call per item enriches a PR/issue with its reviews, comments,
 * review-thread comments, CI status, and lifecycle timeline. The runner is an injected seam
 * (`GraphqlRunner`) so tests drive it with canned responses and the live client is built once in
 * `fetch.ts`. `parseActivity` is a pure, defensive parse — a malformed field degrades to empty, never
 * throws, so one weird item can't sink a whole refresh. The two documents it sends, and the one rule that
 * bounds what they select, are in `activityQueries.ts`.
 */

import type { Repository } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { optStr } from "../slack/shape.js";
import { ISSUE_ACTIVITY_QUERY, PR_ACTIVITY_QUERY } from "./activityQueries.js";
import { type GithubActivityError, GithubActivityErrors } from "./errors.js";

export interface ActivityReview {
  readonly author?: string;
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING */
  readonly state: string;
  readonly tsIso: string;
  readonly url: string;
  readonly body: string;
  /** The head commit the review was submitted against — which commit was approved. */
  readonly commitOid?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface ActivityComment {
  readonly author?: string;
  readonly tsIso: string;
  readonly url: string;
  readonly body: string;
  /** Present only for review-thread comments: whether the thread is resolved. */
  readonly resolved?: boolean;
  /** Review-thread comments only: the file the comment is anchored to. */
  readonly path?: string;
  /**
   * Review-thread comments only: the line in that file. `line` is null on an OUTDATED comment — the diff
   * it was written against no longer exists — so this falls back to `originalLine`, which survives, and
   * `outdated` is what tells a reader which of the two they are looking at.
   */
  readonly line?: number;
  /** Review-thread comments only: whether the diff the comment was anchored to has been superseded. */
  readonly outdated?: boolean;
  /** Review-thread comments only: the diff the comment was written against — what "this" refers to. */
  readonly diffHunk?: string;
  /** Review-thread comments only: the commit the comment was anchored to. */
  readonly commitOid?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

interface ActivityStateEvent {
  /** Timeline `__typename` minus the trailing `Event` (e.g. `Merged`, `Closed`). */
  readonly type: string;
  readonly tsIso: string;
  readonly actor?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface GithubActivity {
  readonly state: string;
  readonly isDraft?: boolean;
  readonly reviewDecision?: string;
  readonly mergeable?: string;
  /** Aggregate CI status-check-rollup state, when the head commit has one. */
  readonly checks?: string;
  readonly updatedAtIso: string;
  /** PRs only: the branch the change was written on, and the exact commit at its head. */
  readonly headRefName?: string;
  readonly headRefOid?: string;
  /** PRs only: the branch it targets, and the commit it was diffed against. */
  readonly baseRefName?: string;
  readonly baseRefOid?: string;
  /** PRs only: `owner/repo` of the head — differs from the base on a fork PR. */
  readonly headRepository?: string;
  /** PRs only: who pressed merge, when, and the commit it produced. */
  readonly mergedBy?: string;
  readonly mergedAtIso?: string;
  readonly mergeCommitOid?: string;
  /** PRs only: the diff's size. */
  readonly additions?: number;
  readonly deletions?: number;
  readonly changedFiles?: number;
  readonly reviews: readonly ActivityReview[];
  readonly comments: readonly ActivityComment[];
  readonly timeline: readonly ActivityStateEvent[];
  /** Connections that came back FULL, so this capture may be cut short — see {@link saturatedConnections}. */
  readonly truncated: readonly string[];
  /**
   * The item node's OWN fields, with every connection (`reviews`, `comments`, `reviewThreads`,
   * `timelineItems`, `commits`) dropped — each of those is already kept verbatim on the record projected
   * from it, and carrying them here would store every comment body a second time on the atom.
   */
  readonly raw?: Readonly<Record<string, unknown>>;
}

/**
 * The injected GraphQL transport: `(query, variables) => data`. Throws on network / GraphQL error.
 *
 * Positional because it mirrors `@octokit/graphql`'s own `graphql(query, variables)`. Reshaping it into one
 * object would let an adapter silently drop `variables` and still compile, which is why the fake in the unit
 * suite asserts the exact query AND variables that cross this seam.
 */
// named-object-params-exempt: mirrors @octokit/graphql's own graphql(query, variables) signature
export type GraphqlRunner = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** Fetch one item's activity. Returns `err` (never throws) so a single bad item is skippable. */
export type FetchGithubActivity = (input: {
  repo: Repository;
  number: number;
  isPr: boolean;
}) => Promise<Result<GithubActivity, GithubActivityError>>;

/**
 * The `first:` every connection in both documents asks for. Named because it is also the SATURATION test:
 * neither document carries `pageInfo`/`after`, so a connection returning exactly this many nodes is one
 * that may have had more — see {@link saturatedConnections}.
 */
const CONNECTION_PAGE = 100;

/** Coerce an unknown to a string, or `''`. */
function str({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** The `.nodes` array of a GraphQL connection, as records; `[]` for anything unexpected. */
function nodesOf({ connection }: { connection: unknown }): readonly Record<string, unknown>[] {
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return [];
  }
  return connection["nodes"].filter(isRecord);
}

/** The `login` off a GraphQL actor/author object, when present. */
function login({ actor }: { actor: unknown }): string | undefined {
  return isRecord(actor) ? optStr({ value: actor["login"] }) : undefined;
}

/** Coerce an unknown to a finite number, or `undefined`. `null` is what GraphQL sends for an absent Int. */
function optNum({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The `oid` off a GraphQL `Commit` sub-selection, when present. */
function commitOid({ commit }: { commit: unknown }): string | undefined {
  return isRecord(commit) ? optStr({ value: commit["oid"] }) : undefined;
}

/** The first present value in a preference order, with each candidate NAMED by the caller. */
function firstPresent<T>({ candidates }: { candidates: readonly (readonly [string, T | undefined])[] }): T | undefined {
  for (const [, value] of candidates) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * One review-thread comment's anchor.
 *
 * `path` and `line` are asked for on BOTH the thread and its comments, because the comment's own pair is
 * the precise one while the thread's survives a comment that lost its anchor. `line` is null on an
 * OUTDATED comment, where `originalLine` is the one that still resolves.
 *
 * Spelled as a named preference order rather than a `??` chain: the substitution here is the whole point of
 * the field, so which source answered has to be legible at the site (`no-silent-fallback`).
 */
function commentAnchor({ comment, thread }: { comment: Record<string, unknown>; thread: Record<string, unknown> }): {
  path?: string;
  line?: number;
} {
  const path = firstPresent({
    candidates: [
      ["the comment's own path", optStr({ value: comment["path"] })],
      ["the thread's path", optStr({ value: thread["path"] })],
    ],
  });
  const line = firstPresent({
    candidates: [
      ["the comment's live line", optNum({ value: comment["line"] })],
      ["the line it was written on, when the diff has moved", optNum({ value: comment["originalLine"] })],
      ["the thread's line", optNum({ value: thread["line"] })],
    ],
  });
  return {
    ...(path !== undefined ? { path } : {}),
    ...(line !== undefined ? { line } : {}),
  };
}

function parseReviews({ node }: { node: Record<string, unknown> }): ActivityReview[] {
  return nodesOf({ connection: node["reviews"] }).map((r) => {
    const author = login({ actor: r["author"] });
    const oid = commitOid({ commit: r["commit"] });
    return {
      ...(author !== undefined ? { author } : {}),
      body: str({ value: r["body"] }),
      ...(oid !== undefined ? { commitOid: oid } : {}),
      raw: r,
      state: str({ value: r["state"] }),
      tsIso: str({ value: r["submittedAt"] }),
      url: str({ value: r["url"] }),
    };
  });
}

function parseComments({ node }: { node: Record<string, unknown> }): ActivityComment[] {
  const issueComments: ActivityComment[] = nodesOf({ connection: node["comments"] }).map((c) => {
    const author = login({ actor: c["author"] });
    return {
      ...(author !== undefined ? { author } : {}),
      body: str({ value: c["body"] }),
      raw: c,
      tsIso: str({ value: c["createdAt"] }),
      url: str({ value: c["url"] }),
    };
  });
  const threadComments: ActivityComment[] = nodesOf({ connection: node["reviewThreads"] }).flatMap((thread) => {
    const resolved = thread["isResolved"] === true;
    return nodesOf({ connection: thread["comments"] }).map((c) => {
      const author = login({ actor: c["author"] });
      const anchor = commentAnchor({ comment: c, thread });
      const diffHunk = optStr({ value: c["diffHunk"] });
      const oid = firstPresent({
        candidates: [
          ["the commit the comment is anchored to now", commitOid({ commit: c["commit"] })],
          ["the commit it was originally written against", commitOid({ commit: c["originalCommit"] })],
        ],
      });
      const outdated = c["outdated"] === true || thread["isOutdated"] === true;
      return {
        ...(author !== undefined ? { author } : {}),
        body: str({ value: c["body"] }),
        ...(oid !== undefined ? { commitOid: oid } : {}),
        ...(diffHunk !== undefined ? { diffHunk } : {}),
        ...anchor,
        outdated,
        raw: c,
        resolved,
        tsIso: str({ value: c["createdAt"] }),
        url: str({ value: c["url"] }),
      };
    });
  });
  return [...issueComments, ...threadComments];
}

function parseTimeline({ node }: { node: Record<string, unknown> }): ActivityStateEvent[] {
  return nodesOf({ connection: node["timelineItems"] })
    .map((e) => {
      const actor = login({ actor: e["actor"] });
      return {
        ...(actor !== undefined ? { actor } : {}),
        raw: e,
        tsIso: str({ value: e["createdAt"] }),
        type: str({ value: e["__typename"] }).replace(/Event$/, ""),
      };
    })
    .filter((e) => e.type.length > 0);
}

/** The connection fields on an item node, each of which is projected into its own record. */
const ITEM_CONNECTIONS = ["comments", "commits", "reviews", "reviewThreads", "timelineItems"] as const;

/**
 * The item node's own fields, with every connection dropped. `null` leaves — GraphQL's answer for an
 * absent scalar — are dropped too, so a `mergedAt: null` on an open PR never reads as a captured value.
 */
function ownFields({ node }: { node: Record<string, unknown> }): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const isConnection = (ITEM_CONNECTIONS as readonly string[]).includes(key);
    if (!isConnection && value !== null && value !== undefined) {
      own[key] = value;
    }
  }
  return own;
}

/**
 * Which of this item's connections came back FULL, and so may have been cut short. Pure.
 *
 * Neither document pages: every connection asks for {@link CONNECTION_PAGE} and takes what it gets. That
 * was recorded in `docs/connector-field-coverage.md` as a risk "never observed to overflow in this
 * workspace" — and it does. MEASURED over bronze before this refetch: a `#<n>:review:99` sourceId exists,
 * which is a `reviews(first:100)` returning its hundredth node, and four pull requests carry more than 174
 * comment records each. Reproduce:
 * `grep -o '"sourceId":"#[0-9]*:review:[0-9]*"' ~/.slopweaver/corpus/bronze/github/compact.jsonl | sed 's/.*:review://;s/"//' | sort -n | tail -1`.
 *
 * Saturation is not proof of loss — a connection with exactly 100 nodes is complete — which is why this
 * names the connections rather than claiming a count. What it ends is the SILENCE: the record says its own
 * capture may be partial, through the corpus-wide `capture` attr, so a later repaired row supersedes it
 * instead of tying with it. Paging these connections is the fix and is its own row; this is the witness
 * that says how often it matters.
 *
 * @param node the GraphQL item node
 * @returns the saturated connection names, sorted, or an empty list
 */
export function saturatedConnections({ node }: { node: Record<string, unknown> }): readonly string[] {
  const saturated: string[] = [];
  for (const name of ITEM_CONNECTIONS) {
    if (name !== "commits" && nodesOf({ connection: node[name] }).length >= CONNECTION_PAGE) {
      saturated.push(name);
    }
  }
  const threadOverflow = nodesOf({ connection: node["reviewThreads"] }).some(
    (thread) => nodesOf({ connection: thread["comments"] }).length >= CONNECTION_PAGE,
  );
  if (threadOverflow) {
    saturated.push("reviewThreadComments");
  }
  return saturated.toSorted();
}

/** The CI rollup state off the last commit, when present. */
function checksOf({ node }: { node: Record<string, unknown> }): string | undefined {
  const commit = nodesOf({ connection: node["commits"] })[0];
  if (commit === undefined || !isRecord(commit["commit"])) {
    return undefined;
  }
  const rollup = commit["commit"]["statusCheckRollup"];
  return isRecord(rollup) ? optStr({ value: rollup["state"] }) : undefined;
}

/**
 * The PR-only branch fields: which branch the change was written on, which it targets, the exact commits
 * on both sides, and who merged it into what. Empty for an issue node. Pure.
 */
function branchFields({ node }: { node: Record<string, unknown> }): Partial<GithubActivity> {
  const headRefName = optStr({ value: node["headRefName"] });
  const headRefOid = optStr({ value: node["headRefOid"] });
  const baseRefName = optStr({ value: node["baseRefName"] });
  const baseRefOid = optStr({ value: node["baseRefOid"] });
  const headRepository = isRecord(node["headRepository"])
    ? optStr({ value: node["headRepository"]["nameWithOwner"] })
    : undefined;
  const mergedBy = login({ actor: node["mergedBy"] });
  const mergedAtIso = optStr({ value: node["mergedAt"] });
  const mergeCommitOid = commitOid({ commit: node["mergeCommit"] });
  return {
    ...(baseRefName !== undefined ? { baseRefName } : {}),
    ...(baseRefOid !== undefined ? { baseRefOid } : {}),
    ...(headRefName !== undefined ? { headRefName } : {}),
    ...(headRefOid !== undefined ? { headRefOid } : {}),
    ...(headRepository !== undefined ? { headRepository } : {}),
    ...(mergeCommitOid !== undefined ? { mergeCommitOid } : {}),
    ...(mergedAtIso !== undefined ? { mergedAtIso } : {}),
    ...(mergedBy !== undefined ? { mergedBy } : {}),
  };
}

/** The PR-only diff-size fields. Empty for an issue node. Pure. */
function diffSizeFields({ node }: { node: Record<string, unknown> }): Partial<GithubActivity> {
  const additions = optNum({ value: node["additions"] });
  const changedFiles = optNum({ value: node["changedFiles"] });
  const deletions = optNum({ value: node["deletions"] });
  return {
    ...(additions !== undefined ? { additions } : {}),
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
  };
}

/**
 * Shape a `pullRequest`/`issue` GraphQL node into a `GithubActivity`. Pure; never throws.
 *
 * @param node the GraphQL item node
 * @param isPr whether the node is a pull request (adds PR-only fields)
 * @returns the parsed activity
 */
export function parseActivity({ node, isPr }: { node: Record<string, unknown>; isPr: boolean }): GithubActivity {
  const checks = checksOf({ node });
  const mergeable = optStr({ value: node["mergeable"] });
  const reviewDecision = optStr({ value: node["reviewDecision"] });
  return {
    state: str({ value: node["state"] }),
    ...(isPr ? { isDraft: node["isDraft"] === true } : {}),
    ...(checks !== undefined ? { checks } : {}),
    comments: parseComments({ node }),
    ...(mergeable !== undefined ? { mergeable } : {}),
    ...(reviewDecision !== undefined ? { reviewDecision } : {}),
    ...(isPr ? branchFields({ node }) : {}),
    ...(isPr ? diffSizeFields({ node }) : {}),
    raw: ownFields({ node }),
    reviews: isPr ? parseReviews({ node }) : [],
    timeline: parseTimeline({ node }),
    truncated: saturatedConnections({ node }),
    updatedAtIso: str({ value: node["updatedAt"] }),
  };
}

/** Pull the item node out of a `repository { pullRequest|issue }` GraphQL response. */
function pickNode({ data, isPr }: { data: unknown; isPr: boolean }): Record<string, unknown> | undefined {
  if (!isRecord(data) || !isRecord(data["repository"])) {
    return undefined;
  }
  const node = isPr ? data["repository"]["pullRequest"] : data["repository"]["issue"];
  return isRecord(node) ? node : undefined;
}

/**
 * Build a `FetchGithubActivity` over an injected GraphQL runner.
 *
 * @param graphql the GraphQL transport
 * @returns a function that fetches one item's activity
 */
export function makeFetchGithubActivity({ graphql }: { graphql: GraphqlRunner }): FetchGithubActivity {
  return async ({ repo, number, isPr }) => {
    try {
      const data = await graphql(isPr ? PR_ACTIVITY_QUERY : ISSUE_ACTIVITY_QUERY, {
        number,
        owner: repo.owner,
        repo: repo.repo,
      });
      const node = pickNode({ data, isPr });
      if (node === undefined) {
        return err(GithubActivityErrors.nodeNotFound({ isPr, number }));
      }
      return ok(parseActivity({ isPr, node }));
    } catch (error: unknown) {
      return err(GithubActivityErrors.fetchFailed({ cause: error, number }));
    }
  };
}
