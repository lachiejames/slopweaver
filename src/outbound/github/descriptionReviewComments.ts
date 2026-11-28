/**
 * The comments already on a pull request, read whole for the description review.
 *
 * A description answers to what reviewers have already said on the pull request: a claim a reviewer's comment
 * refutes is wrong however well it matches the diff. So the review packet carries every conversation comment and
 * every inline review comment at its base (`./descriptionReviewPacket.ts`), and the manifest binds their digest, so
 * a comment added, edited or deleted since the review closes the write.
 *
 * The read goes through the same typed live reader `slopweaver github read` uses (`../../live/github/read.ts`), so
 * this adds no egress and no second GitHub client. That query is bounded at `$limit` nodes per connection; a page
 * that reports more refuses rather than hashing part of the conversation as the whole of it. Review SUMMARY bodies
 * (a review's own top-level text) are not read here: they are neither conversation comments nor inline ones.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { githubToken } from "../../config.js";
import { githubReadGraphql, readGithubObject } from "../../live/github/read.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import type {
  ExistingIssueComment,
  ExistingPullRequestComment,
  ExistingReviewComment,
} from "./descriptionReviewTypes.js";

/** The node count requested per connection; a connection reporting more refuses. */
export const DESCRIPTION_COMMENTS_READ_LIMIT = 100;

/** What one read of a pull request's comments answers: its node id, which a self-review ledger binds, and its comments. */
export interface DescriptionReviewCommentsReading {
  /** The pull request's GraphQL node id. */
  readonly pullRequestId: string;
  /** Every conversation and inline review comment; `supersededByThisWrite` is false on each, being intent. */
  readonly comments: readonly ExistingPullRequestComment[];
}

/** Reads the comments already on one pull request. Production reads GitHub; a test passes a plain function. */
export type DescriptionReviewCommentsReader = (args: {
  home: string;
  owner: string;
  repo: string;
  number: number;
}) => Promise<Result<DescriptionReviewCommentsReading, DescriptionReviewError>>;

/** A connection's nodes, refusing one that reports another page. */
function wholeConnection({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): Result<readonly unknown[], DescriptionReviewError> {
  if (!isRecord(value) || !Array.isArray(value["nodes"]) || !isRecord(value["pageInfo"])) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: `${label} is not a connection` }));
  }
  if (value["pageInfo"]["hasNextPage"] !== false) {
    return err(
      DescriptionReviewErrors.commentsReadFailed({
        detail: `${label} has more than ${String(DESCRIPTION_COMMENTS_READ_LIMIT)} nodes; a partial conversation is never reviewed as the whole`,
      }),
    );
  }
  return ok(value["nodes"]);
}

/** The author login, or the explicit null GitHub reports for a deleted account. */
function authorLoginOf({ value }: { value: unknown }): Result<string | null, DescriptionReviewError> {
  if (value === null) {
    return ok(null);
  }
  if (isRecord(value) && typeof value["login"] === "string") {
    return ok(value["login"]);
  }
  return err(DescriptionReviewErrors.commentsReadFailed({ detail: "author is neither null nor { login }" }));
}

/** The fields every comment carries, or which one is malformed. */
function commonFields({ node }: { node: unknown }): Result<Omit<ExistingIssueComment, "kind">, DescriptionReviewError> {
  if (!isRecord(node)) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: "a comment node is not an object" }));
  }
  const { id, body, url, createdAt, updatedAt } = node;
  if (
    typeof id !== "string" ||
    typeof body !== "string" ||
    typeof url !== "string" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return err(
      DescriptionReviewErrors.commentsReadFailed({
        detail: "a comment's id, body, url, createdAt or updatedAt is not a string",
      }),
    );
  }
  const author = authorLoginOf({ value: node["author"] });
  if (author.isErr()) {
    return err(author.error);
  }
  return ok({ authorLogin: author.value, body, createdAtIso: createdAt, id, updatedAtIso: updatedAt, url });
}

/** One inline review comment, anchored by its thread's path and its own original line, with its thread's history. */
function reviewCommentOf({
  node,
  path,
  threadId,
  threadResolved,
}: {
  node: unknown;
  path: string;
  threadId: string;
  threadResolved: boolean;
}): Result<ExistingReviewComment, DescriptionReviewError> {
  const common = commonFields({ node });
  if (common.isErr()) {
    return err(common.error);
  }
  const originalLine = isRecord(node) ? node["originalLine"] : undefined;
  if (originalLine !== null && !(typeof originalLine === "number" && Number.isInteger(originalLine))) {
    return err(
      DescriptionReviewErrors.commentsReadFailed({
        detail: "a review comment's originalLine is neither null nor an integer",
      }),
    );
  }
  return ok({
    ...common.value,
    kind: "review-comment",
    originalLine,
    path,
    supersededByThisWrite: false,
    threadId,
    threadResolved,
  });
}

/** Every conversation comment on the pull request, read whole. */
function conversationCommentsOf({
  data,
}: {
  data: Record<string, unknown>;
}): Result<readonly ExistingPullRequestComment[], DescriptionReviewError> {
  const conversation = wholeConnection({ label: "the conversation comments", value: data["comments"] });
  if (conversation.isErr()) {
    return err(conversation.error);
  }
  const out: ExistingPullRequestComment[] = [];
  for (const node of conversation.value) {
    const common = commonFields({ node });
    if (common.isErr()) {
      return err(common.error);
    }
    out.push({ ...common.value, kind: "issue-comment" });
  }
  return ok(out);
}

/** Every inline review comment on one review thread, read whole. */
function threadCommentsOf({
  thread,
}: {
  thread: unknown;
}): Result<readonly ExistingPullRequestComment[], DescriptionReviewError> {
  if (!isRecord(thread) || typeof thread["path"] !== "string") {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: "a review thread carries no path" }));
  }
  const path = thread["path"];
  const threadId = thread["id"];
  const threadResolved = thread["isResolved"];
  if (typeof threadId !== "string" || threadId.length === 0 || typeof threadResolved !== "boolean") {
    return err(
      DescriptionReviewErrors.commentsReadFailed({
        detail: `a review thread in ${path} carries no id or no boolean isResolved`,
      }),
    );
  }
  const comments = wholeConnection({ label: `the comments on a thread in ${path}`, value: thread["comments"] });
  if (comments.isErr()) {
    return err(comments.error);
  }
  const out: ExistingPullRequestComment[] = [];
  for (const node of comments.value) {
    const comment = reviewCommentOf({ node, path, threadId, threadResolved });
    if (comment.isErr()) {
      return err(comment.error);
    }
    out.push(comment.value);
  }
  return ok(out);
}

/**
 * Every comment already on a pull request, from the node the typed live reader selected.
 *
 * @param data the pull-request node `readGithubObject` answered (its document's `data`)
 * @returns the pull request's node id and every conversation and inline review comment, or why they could not be
 *   read whole
 */
export function existingDescriptionCommentsOf({
  data,
}: {
  data: unknown;
}): Result<DescriptionReviewCommentsReading, DescriptionReviewError> {
  if (!isRecord(data)) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: "the pull request read back is not an object" }));
  }
  const pullRequestId = data["id"];
  if (typeof pullRequestId !== "string" || pullRequestId.length === 0) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: "the pull request read back carries no node id" }));
  }
  const conversation = conversationCommentsOf({ data });
  if (conversation.isErr()) {
    return err(conversation.error);
  }
  const threads = wholeConnection({ label: "the review threads", value: data["reviewThreads"] });
  if (threads.isErr()) {
    return err(threads.error);
  }
  const out: ExistingPullRequestComment[] = [...conversation.value];
  for (const thread of threads.value) {
    const comments = threadCommentsOf({ thread });
    if (comments.isErr()) {
      return err(comments.error);
    }
    out.push(...comments.value);
  }
  return ok({ comments: out, pullRequestId });
}

/**
 * The production reader: the pull request read through the typed live reader, under the home's GitHub token.
 *
 * @returns the pull request's node id and every comment already on it, or why they could not be read whole
 */
export const readDescriptionComments: DescriptionReviewCommentsReader = async ({ home, owner, repo, number }) => {
  const read = await readGithubObject({
    address: `https://github.com/${owner}/${repo}/pull/${String(number)}`,
    graphql: githubReadGraphql({ token: githubToken({ home }) }),
    limit: DESCRIPTION_COMMENTS_READ_LIMIT,
    nowIso: () => new Date().toISOString(),
  });
  if (read.isErr()) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: read.error.message }));
  }
  return existingDescriptionCommentsOf({ data: read.value.data });
};
