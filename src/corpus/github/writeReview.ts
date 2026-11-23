/**
 * Self-review round operations for the GitHub write lane — split out of `./write.ts` (file-size ratchet).
 * Everything here is a plain move: same bodies, same JSDoc, same `safeProviderCall` posture per operation.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type {
  GithubWriteApi,
  PrRef,
  PullRequestDiffFile,
  ReviewThreadDraft,
  ReviewThreadSnapshot,
  WriteCtx,
  WrittenReviewRound,
} from "./write.js";

/**
 * Read one string field from a GitHub response object, throwing on a broken response.
 *
 * @param context what the object is, for the error a reader sees
 * @returns the non-empty string
 */
export function requiredString({ value, field, context }: { value: unknown; field: string; context: string }): string {
  if (!isRecord(value) || typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`GitHub returned no ${field} for ${context}`);
  }
  return value[field];
}

/** Parse a GraphQL connection's node ids without dropping malformed entries. */
function nodeIds({ value, context }: { value: unknown; context: string }): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value["nodes"])) {
    throw new Error(`GitHub returned no nodes for ${context}`);
  }
  return value["nodes"].map((node, index) =>
    requiredString({ context: `${context}[${String(index)}]`, field: "id", value: node }),
  );
}

/** Build the one GraphQL document and variables for a replacement self-review round. */
function selfReviewMutation({ input }: { input: Parameters<GithubWriteApi["submitReviewRound"]>[0] }): {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
} {
  const variableDefinitions = input.resolveThreadIds
    .map((_threadId, index) => `$thread${String(index)}: ID!`)
    .join(", ");
  const resolutions = input.resolveThreadIds
    .map(
      (_threadId, index) =>
        `resolve${String(index)}: resolveReviewThread(input: { threadId: $thread${String(index)} }) { ` +
        "thread { id isResolved } }",
    )
    .join("\n");
  const variables: Record<string, unknown> = {
    review: {
      commitOID: input.commitOid,
      event: "COMMENT",
      pullRequestId: input.pullRequestId,
      threads: input.comments.map((comment) => ({
        body: comment.body,
        line: comment.line,
        path: comment.path,
        side: "RIGHT",
      })),
    },
  };
  input.resolveThreadIds.forEach((threadId, index) => {
    variables[`thread${String(index)}`] = threadId;
  });
  const definitions = ["$review: AddPullRequestReviewInput!", variableDefinitions]
    .filter((part) => part.length > 0)
    .join(", ");
  return {
    query: `mutation SlopweaverReplaceSelfReview(${definitions}) {
          review: addPullRequestReview(input: $review) {
            pullRequestReview { id comments(first: 100) { nodes { id } } }
          }
          ${resolutions}
        }`,
    variables,
  };
}

/** Validate the mutation response, including every requested exact resolution. */
function writtenReviewRoundOf({
  response,
  input,
}: {
  response: Readonly<Record<string, unknown>>;
  input: Parameters<GithubWriteApi["submitReviewRound"]>[0];
}): WrittenReviewRound {
  const reviewPayload = response["review"];
  if (!isRecord(reviewPayload) || !isRecord(reviewPayload["pullRequestReview"])) {
    throw new Error("GitHub returned no pull-request review after accepting the mutation");
  }
  const review = reviewPayload["pullRequestReview"];
  const reviewId = requiredString({ context: "submitted review", field: "id", value: review });
  const commentIds = nodeIds({ context: "submitted review comments", value: review["comments"] });
  if (commentIds.length !== input.comments.length) {
    throw new Error(
      `GitHub returned ${String(commentIds.length)} comment ids for ${String(input.comments.length)} submitted threads`,
    );
  }
  input.resolveThreadIds.forEach((threadId, index) => {
    const payload = response[`resolve${String(index)}`];
    if (!isRecord(payload) || !isRecord(payload["thread"])) {
      throw new Error(`GitHub returned no resolved thread for ${threadId}`);
    }
    const resolved = payload["thread"];
    if (requiredString({ context: "resolved thread", field: "id", value: resolved }) !== threadId) {
      throw new Error(`GitHub resolved a different thread than ${threadId}`);
    }
    if (resolved["isResolved"] !== true) {
      throw new Error(`GitHub did not report thread ${threadId} as resolved`);
    }
  });
  return { commentIds, reviewId };
}

/**
 * Submit a fresh review before resolving the previous Slopweaver-owned threads.
 *
 * One GraphQL request is one irreversible send. Top-level mutation fields execute serially: the submitted
 * review is deliberately first, then each prior thread resolution. Any transport or GraphQL error is carried
 * as unconfirmed by the caller and is never retried.
 *
 * @returns the submitted round, or the provider failure
 */
export function submitReviewRoundVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: {
    pullRequestId: string;
    commitOid: string;
    comments: readonly ReviewThreadDraft[];
    resolveThreadIds: readonly string[];
  };
}): ResultAsync<WrittenReviewRound, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const mutation = selfReviewMutation({ input });
      const response = await ctx.client.graphql<Record<string, unknown>>(mutation.query, mutation.variables);
      return writtenReviewRoundOf({ input, response });
    },
    operation: "github.addPullRequestReview+resolveReviewThread",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/** Parse one live review thread without treating malformed nodes as absent. */
function reviewThreadOf({ value, index }: { value: unknown; index: number }): ReviewThreadSnapshot {
  if (!isRecord(value) || typeof value["isResolved"] !== "boolean") {
    throw new Error(`GitHub returned an invalid review thread at index ${String(index)}`);
  }
  return {
    commentIds: nodeIds({ context: `review thread ${String(index)} comments`, value: value["comments"] }),
    id: requiredString({ context: `review thread ${String(index)}`, field: "id", value }),
    isResolved: value["isResolved"],
  };
}

/**
 * Read the newest bounded thread window after a write, so comment ids can be mapped to exact thread ids.
 *
 * @returns the review threads, or the provider failure
 */
export function reviewThreadsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { pullRequestId: string };
}): ResultAsync<readonly ReviewThreadSnapshot[], IngestError> {
  return safeProviderCall({
    execute: async () => {
      const response = await ctx.client.graphql<Record<string, unknown>>(
        `query SlopweaverReviewThreads($pullRequestId: ID!) {
          node(id: $pullRequestId) {
            ... on PullRequest {
              reviewThreads(last: 100) {
                nodes { id isResolved comments(first: 100) { nodes { id } } }
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
      return node["reviewThreads"]["nodes"].map((thread, index) => reviewThreadOf({ index, value: thread }));
    },
    operation: "github.pullRequest.reviewThreads",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** How many pages `diffFilesVia` will fetch before stopping — a sane ceiling, never unbounded. */
const DIFF_FILES_MAX_PAGES = 5;
/** GitHub's largest page size for a pull request's file list, shared with `./introducedFiles.ts`. */
export const DIFF_FILES_PAGE_SIZE = 100;

/**
 * The unified diff patch of each of a pull request's first 500 changed files at its current head, paginated
 * client-side.
 *
 * Capped at {@link DIFF_FILES_MAX_PAGES} pages (500 changed files) rather than left unbounded — a self-review
 * round is bounded at `MAX_SELF_REVIEW_COMMENTS` comments, so a pull request with more changed files
 * than this ceiling exceeds anything a round could ever need to validate against. Past the ceiling the list
 * comes back partial, with no signal that it was cut short.
 *
 * @returns up to 500 changed files' diffs, or the provider failure
 */
export function diffFilesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<readonly PullRequestDiffFile[], IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const files: PullRequestDiffFile[] = [];
      for (let page = 1; page <= DIFF_FILES_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.pulls.listFiles({
          owner,
          page,
          per_page: DIFF_FILES_PAGE_SIZE,
          pull_number: number,
          repo,
        });
        for (const file of res.data) {
          files.push({ patch: file.patch, path: file.filename });
        }
        if (res.data.length < DIFF_FILES_PAGE_SIZE) {
          break;
        }
      }
      return files;
    },
    operation: "github.pulls.listFiles",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
