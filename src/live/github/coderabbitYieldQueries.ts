/**
 * The GraphQL `github coderabbit-yield` sends, and the strict parsers over what comes back.
 *
 * A dedicated projection rather than `./reviewStateQueries.ts`'s, because that one answers a different
 * question: it reads checks, files and requests this audit never looks at, and only an opener and a
 * three-comment tail per thread, which loses an addressed marker sitting in the middle of a conversation.
 *
 * Every parser answers a `GithubLiveError` on a malformed shape rather than an empty list, because an empty
 * list is a real answer here — "no CodeRabbit findings" — and a broken response must never read as one.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { YieldPr, YieldThread } from "../../review/coderabbitYield.js";
import type { YieldComment } from "../../review/coderabbitYieldEvidence.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";

/** Comments read inline with each thread; a thread with more is re-read whole by {@link COMMENTS_QUERY}. */
const INLINE_COMMENTS = 10;

/** The most comments one thread is read to. A longer thread is `commentsComplete: false`, never truncated silently. */
const THREAD_COMMENT_CAP = 100;

const RATE_LIMIT = "rateLimit { cost remaining resetAt }";

const COMMENT_FIELDS = "author { login } body url";

const THREAD_FIELDS = `id isResolved isOutdated path resolvedBy { login }
  comments(first: ${String(INLINE_COMMENTS)}) { totalCount nodes { ${COMMENT_FIELDS} } }`;

export const VIEWER_QUERY = `query SlopweaverYieldViewer { viewer { login } ${RATE_LIMIT} }`;

export const COUNT_QUERY = `query SlopweaverYieldCount($q: String!) {
  search(query: $q, type: ISSUE, first: 1) { issueCount }
  ${RATE_LIMIT}
}`;

export const SEARCH_QUERY = `query SlopweaverYieldSearch($q: String!, $after: String, $pageSize: Int!) {
  search(query: $q, type: ISSUE, first: $pageSize, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id number url state createdAt author { login } repository { nameWithOwner }
        reviewThreads(first: 50) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } }
        reviews(first: 50) { pageInfo { hasNextPage endCursor } nodes { author { login } body } }
      }
    }
  }
  ${RATE_LIMIT}
}`;

export const THREADS_QUERY = `query SlopweaverYieldThreads($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } }
    }
  }
  ${RATE_LIMIT}
}`;

export const REVIEWS_QUERY = `query SlopweaverYieldReviews($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      reviews(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { author { login } body } }
    }
  }
  ${RATE_LIMIT}
}`;

export const COMMENTS_QUERY = `query SlopweaverYieldComments($id: ID!) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: ${String(THREAD_COMMENT_CAP)}) { totalCount nodes { ${COMMENT_FIELDS} } }
    }
  }
  ${RATE_LIMIT}
}`;

/** A connection's nodes and its next cursor, when it has one. */
export interface Page<T> {
  readonly nodes: readonly T[];
  readonly next: string | undefined;
}

/** What one response says about the budget left. */
export interface RateFacts {
  readonly cost: number;
  readonly remaining: number;
}

/** A named read failure. */
function broken({ what }: { what: string }): GithubLiveError {
  return GithubLiveErrors.readFailed({ message: `GitHub returned a malformed ${what} for the coderabbit-yield read` });
}

/** The login under an `author`/`resolvedBy` object, or null when GitHub reports none. */
function loginOf({ value }: { value: unknown }): string | null {
  return isRecord(value) && typeof value["login"] === "string" ? value["login"] : null;
}

/**
 * The rate-limit block every query selects.
 *
 * @param data the raw response
 * @returns the cost and remaining budget, or undefined when the response carried none
 */
export function rateOf({ data }: { data: unknown }): RateFacts | undefined {
  const rate = isRecord(data) ? data["rateLimit"] : undefined;
  if (!isRecord(rate) || typeof rate["cost"] !== "number" || typeof rate["remaining"] !== "number") {
    return undefined;
  }
  return { cost: rate["cost"], remaining: rate["remaining"] };
}

/**
 * One connection's nodes and cursor. A missing connection is malformed; `hasNextPage` with no cursor is too.
 *
 * @param connection the raw connection object
 * @param what the connection's name, for the failure message
 * @returns the raw nodes and next cursor
 */
export function pageOf({
  connection,
  what,
}: {
  connection: unknown;
  what: string;
}): Result<Page<unknown>, GithubLiveError> {
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return err(broken({ what: `${what} connection` }));
  }
  // Every query asks for pageInfo, so its absence is a broken page, never the last one.
  const info = connection["pageInfo"];
  if (!isRecord(info) || typeof info["hasNextPage"] !== "boolean") {
    return err(broken({ what: `${what} page (no pageInfo.hasNextPage)` }));
  }
  if (!info["hasNextPage"]) {
    return ok({ next: undefined, nodes: connection["nodes"] });
  }
  const cursor = info["endCursor"];
  if (typeof cursor !== "string") {
    return err(broken({ what: `${what} page (hasNextPage without a cursor)` }));
  }
  return ok({ next: cursor, nodes: connection["nodes"] });
}

/**
 * Parse one comment node.
 *
 * @param value the raw comment
 * @returns the comment, or a read failure when it carries no body or url
 */
function commentOf({ value }: { value: unknown }): Result<YieldComment, GithubLiveError> {
  if (!isRecord(value) || typeof value["body"] !== "string" || typeof value["url"] !== "string") {
    return err(broken({ what: "review comment" }));
  }
  return ok({ authorLogin: loginOf({ value: value["author"] }), body: value["body"], url: value["url"] });
}

/**
 * Parse a comment connection with its total, so a caller can tell whether it read them all.
 *
 * @param connection the raw `comments` connection
 * @returns the comments and GitHub's total
 */
export function commentsOf({
  connection,
}: {
  connection: unknown;
}): Result<{ comments: readonly YieldComment[]; total: number }, GithubLiveError> {
  if (!isRecord(connection) || typeof connection["totalCount"] !== "number" || !Array.isArray(connection["nodes"])) {
    return err(broken({ what: "comment connection" }));
  }
  const comments: YieldComment[] = [];
  for (const node of connection["nodes"]) {
    const comment = commentOf({ value: node });
    if (comment.isErr()) {
      return err(comment.error);
    }
    comments.push(comment.value);
  }
  return ok({ comments, total: connection["totalCount"] });
}

/**
 * Parse one thread node, its inline comments included.
 *
 * @param value the raw thread
 * @returns the thread, complete only when every comment it has was on the inline page
 */
export function threadOf({ value }: { value: unknown }): Result<YieldThread, GithubLiveError> {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["isResolved"] !== "boolean" ||
    typeof value["isOutdated"] !== "boolean"
  ) {
    return err(broken({ what: "review thread" }));
  }
  const comments = commentsOf({ connection: value["comments"] });
  if (comments.isErr()) {
    return err(comments.error);
  }
  return ok({
    comments: comments.value.comments,
    commentsComplete: comments.value.comments.length >= comments.value.total,
    id: value["id"],
    isOutdated: value["isOutdated"],
    isResolved: value["isResolved"],
    path: typeof value["path"] === "string" ? value["path"] : "",
    resolvedByLogin: loginOf({ value: value["resolvedBy"] }),
  });
}

/**
 * Parse one search-result pull request's identity.
 *
 * @param value the raw pull-request node
 * @returns the node id and identity, or a read failure naming the missing field
 */
export function prOf({ value }: { value: unknown }): Result<{ id: string; pr: YieldPr }, GithubLiveError> {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["number"] !== "number" ||
    typeof value["url"] !== "string" ||
    typeof value["state"] !== "string" ||
    typeof value["createdAt"] !== "string" ||
    !isRecord(value["repository"]) ||
    typeof value["repository"]["nameWithOwner"] !== "string"
  ) {
    return err(broken({ what: "pull request" }));
  }
  return ok({
    id: value["id"],
    pr: {
      authorLogin: loginOf({ value: value["author"] }),
      createdAtIso: value["createdAt"],
      number: value["number"],
      repo: value["repository"]["nameWithOwner"],
      state: value["state"],
      url: value["url"],
    },
  });
}

/**
 * Parse one review node to its author and body.
 *
 * @param value the raw review
 * @returns the author login and body
 */
export function reviewOf({
  value,
}: {
  value: unknown;
}): Result<{ authorLogin: string | null; body: string }, GithubLiveError> {
  if (!isRecord(value) || typeof value["body"] !== "string") {
    return err(broken({ what: "review" }));
  }
  return ok({ authorLogin: loginOf({ value: value["author"] }), body: value["body"] });
}
