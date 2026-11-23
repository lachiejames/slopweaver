/**
 * Review threads a HUMAN or a bot reviewer opened — read them, answer one, resolve one.
 *
 * Distinct from `./writeReview.ts`, which owns the SELF-review round: that file submits a whole new review
 * and resolves the threads Slopweaver itself owns. This one addresses a thread somebody else opened, which
 * is the only way to answer a reviewer without dismissing them.
 *
 * Split out of `./write.ts` to keep it under the repo's 700-code-line file-size ratchet
 * (`src/devLint/fileSizeRatchet.ts`).
 */
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { WriteCtx } from "./write.js";

/** One review thread as `github thread list` shows it — enough to recognise it and address it by id. */
export interface ReviewThreadDetail {
  readonly id: string;
  readonly isResolved: boolean;
  readonly path: string | undefined;
  readonly line: number | undefined;
  readonly author: string | undefined;
  readonly body: string;
}

/** What answering a review thread produced: the reply's URL, and the confirmed resolution. */
export interface ReviewThreadAnswer {
  readonly commentUrl: string | undefined;
  readonly isResolved: boolean | undefined;
}

/** One comment in a review thread: who wrote it, when, and where it lives. */
export interface ReviewThreadComment {
  /** Absent for a deleted account, which is somebody other than this token's identity. */
  readonly author: string | undefined;
  readonly createdAt: string;
  readonly url: string;
}

/** A review thread's comments, oldest first, read beside the login of the token that read them. */
export interface ReviewThreadComments {
  readonly viewer: string;
  readonly comments: readonly ReviewThreadComment[];
}

/** Read one string field from a GraphQL object, throwing on a broken response. */
function requiredString({ value, field, context }: { value: unknown; field: string; context: string }): string {
  if (!isRecord(value) || typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`GitHub returned no ${field} for ${context}`);
  }
  return value[field];
}

/** A GraphQL field that may legitimately be absent, narrowed to a string when it is present. */
function optionalString({ value, field }: { value: unknown; field: string }): string | undefined {
  return isRecord(value) && typeof value[field] === "string" ? value[field] : undefined;
}

/**
 * The first comment on a thread — who opened it and what they asked for.
 *
 * The AUTHOR is legitimately absent (a deleted account reads as null), so it stays optional. The BODY is
 * not: a review thread with no opening comment is a broken response, and a blank body would leave `list`
 * printing an unrecognisable row rather than saying the read failed.
 */
function firstCommentOf({ value }: { value: unknown }): { author: string | undefined; body: string } {
  if (!isRecord(value) || !isRecord(value["comments"]) || !Array.isArray(value["comments"]["nodes"])) {
    throw new Error("GitHub returned no comment connection for a review thread");
  }
  const first = value["comments"]["nodes"][0];
  return {
    author: isRecord(first) ? optionalString({ field: "login", value: first["author"] }) : undefined,
    body: requiredString({ context: "a review thread's opening comment", field: "body", value: first }),
  };
}

/** Parse one live review thread, treating a malformed node as a failure rather than as absent. */
function threadOf({ value, index }: { value: unknown; index: number }): ReviewThreadDetail {
  if (!isRecord(value) || typeof value["isResolved"] !== "boolean") {
    throw new Error(`GitHub returned an invalid review thread at index ${String(index)}`);
  }
  const comment = firstCommentOf({ value });
  return {
    author: comment.author,
    body: comment.body,
    id: requiredString({ context: `review thread ${String(index)}`, field: "id", value }),
    isResolved: value["isResolved"],
    line: typeof value["line"] === "number" ? value["line"] : undefined,
    path: optionalString({ field: "path", value }),
  };
}

/**
 * Every review thread on a pull request, with enough of each to recognise it and address it by id.
 *
 * Bounded at one page of 100 — the same ceiling `reviewThreadsVia` uses — because a caller reaching for one
 * thread to answer does not need an unbounded history, and an unbounded read here would be a surprise.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the pull request's GraphQL node id
 * @returns the review threads, newest last, or the provider failure
 */
export function reviewThreadDetailsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { pullRequestId: string };
}): ResultAsync<readonly ReviewThreadDetail[], IngestError> {
  return safeProviderCall({
    execute: async () => {
      const response = await ctx.client.graphql<Record<string, unknown>>(
        `query SlopweaverReviewThreadDetails($pullRequestId: ID!) {
          node(id: $pullRequestId) {
            ... on PullRequest {
              reviewThreads(last: 100) {
                nodes {
                  id
                  isResolved
                  path
                  line
                  comments(first: 1) { nodes { body author { login } } }
                }
              }
            }
          }
        }`,
        { pullRequestId: input.pullRequestId },
      );
      const node = response["node"];
      if (!isRecord(node) || !isRecord(node["reviewThreads"]) || !Array.isArray(node["reviewThreads"]["nodes"])) {
        throw new Error("GitHub returned no review-thread connection for the pull request");
      }
      return node["reviewThreads"]["nodes"].map((thread, index) => threadOf({ index, value: thread }));
    },
    operation: "github.pullRequest.reviewThreadDetails",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** Parse one thread comment, treating a missing time or URL as a broken response. */
function threadCommentOf({ value, index }: { value: unknown; index: number }): ReviewThreadComment {
  const context = `review-thread comment ${String(index)}`;
  return {
    author: isRecord(value) ? optionalString({ field: "login", value: value["author"] }) : undefined,
    createdAt: requiredString({ context, field: "createdAt", value }),
    url: requiredString({ context, field: "url", value }),
  };
}

/**
 * One review thread's comments and the reading token's own login, in one query — what a reply reads before
 * it writes, so it can see whether this identity already answered.
 *
 * Bounded at the last 100 comments: the question is only ever about the tail, and a thread longer than that
 * still has its tail read.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the review thread's node id
 * @returns the viewer's login and the thread's comments oldest first, or the provider failure
 */
export function reviewThreadCommentsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { threadId: string };
}): ResultAsync<ReviewThreadComments, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const response = await ctx.client.graphql<Record<string, unknown>>(
        `query SlopweaverReviewThreadComments($thread: ID!) {
          viewer { login }
          node(id: $thread) {
            ... on PullRequestReviewThread {
              comments(last: 100) { nodes { author { login } createdAt url } }
            }
          }
        }`,
        { thread: input.threadId },
      );
      const viewer = requiredString({ context: "the reading token", field: "login", value: response["viewer"] });
      const node = response["node"];
      if (!isRecord(node) || !isRecord(node["comments"]) || !Array.isArray(node["comments"]["nodes"])) {
        throw new Error(`GitHub returned no review thread for ${input.threadId}`);
      }
      const comments = node["comments"]["nodes"].map((comment, index) => threadCommentOf({ index, value: comment }));
      return { comments, viewer };
    },
    operation: "github.reviewThread.comments",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** Build the one GraphQL document and variables for answering, resolving, or both at once. */
function answerMutation({ input }: { input: { threadId: string; body: string | undefined; resolve: boolean } }): {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
} {
  const definitions = ["$thread: ID!", input.body === undefined ? "" : "$body: String!"].filter(
    (part) => part.length > 0,
  );
  const fields = [
    input.body === undefined
      ? ""
      : "reply: addPullRequestReviewThreadReply(" +
        "input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id url } }",
    input.resolve ? "resolve: resolveReviewThread(input: { threadId: $thread }) { thread { id isResolved } }" : "",
  ].filter((field) => field.length > 0);
  return {
    query: `mutation SlopweaverAnswerReviewThread(${definitions.join(", ")}) {\n${fields.join("\n")}\n}`,
    variables: input.body === undefined ? { thread: input.threadId } : { body: input.body, thread: input.threadId },
  };
}

/** Validate the mutation response, including the exact thread the resolution was asked for. */
function answerOf({
  response,
  input,
}: {
  response: Readonly<Record<string, unknown>>;
  input: { threadId: string; body: string | undefined; resolve: boolean };
}): ReviewThreadAnswer {
  let commentUrl: string | undefined;
  if (input.body !== undefined) {
    const reply = response["reply"];
    if (!isRecord(reply) || !isRecord(reply["comment"])) {
      throw new Error("GitHub returned no comment after accepting the reply");
    }
    commentUrl = requiredString({ context: "posted reply", field: "url", value: reply["comment"] });
  }
  let isResolved: boolean | undefined;
  if (input.resolve) {
    const resolved = response["resolve"];
    if (!isRecord(resolved) || !isRecord(resolved["thread"])) {
      throw new Error(`GitHub returned no resolved thread for ${input.threadId}`);
    }
    if (requiredString({ context: "resolved thread", field: "id", value: resolved["thread"] }) !== input.threadId) {
      throw new Error(`GitHub resolved a different thread than ${input.threadId}`);
    }
    if (resolved["thread"]["isResolved"] !== true) {
      throw new Error(`GitHub did not report thread ${input.threadId} as resolved`);
    }
    isResolved = true;
  }
  return { commentUrl, isResolved };
}

/**
 * Reply into one review thread and/or resolve it, in a single no-retry GraphQL operation.
 *
 * Top-level mutation fields execute serially and the reply is deliberately first, so a partial failure
 * leaves the reviewer's thread OPEN with the answer already on it — never resolved with nothing said.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the thread, the reply body if any, and whether to resolve
 * @returns the posted comment's URL and the confirmed resolution, or the provider failure
 */
export function answerReviewThreadVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { threadId: string; body: string | undefined; resolve: boolean };
}): ResultAsync<ReviewThreadAnswer, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const mutation = answerMutation({ input });
      const response = await ctx.client.graphql<Record<string, unknown>>(mutation.query, mutation.variables);
      return answerOf({ input, response });
    },
    operation: "github.addPullRequestReviewThreadReply+resolveReviewThread",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Reopen one resolved review thread, confirming GitHub reports that exact thread open again.
 *
 * The undo of a resolve: a landing verb that resolved a thread a colleague had just replied into puts it back
 * where a reader sees it, rather than leaving the reply collapsed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the thread to reopen
 * @returns nothing on a confirmed reopen, or the provider failure
 */
export function reopenReviewThreadVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { threadId: string };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const response = await ctx.client.graphql<Record<string, unknown>>(
        "mutation SlopweaverReopenReviewThread($thread: ID!) {\n" +
          "reopen: unresolveReviewThread(input: { threadId: $thread }) { thread { id isResolved } }\n}",
        { thread: input.threadId },
      );
      const reopened = response["reopen"];
      if (!isRecord(reopened) || !isRecord(reopened["thread"])) {
        throw new Error(`GitHub returned no reopened thread for ${input.threadId}`);
      }
      if (requiredString({ context: "reopened thread", field: "id", value: reopened["thread"] }) !== input.threadId) {
        throw new Error(`GitHub reopened a different thread than ${input.threadId}`);
      }
      if (reopened["thread"]["isResolved"] !== false) {
        throw new Error(`GitHub did not report thread ${input.threadId} as open`);
      }
    },
    operation: "github.unresolveReviewThread",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
