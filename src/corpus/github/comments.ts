/**
 * A top-level comment on an issue or pull request — GitHub treats both as one `issues` endpoint, so this is
 * the one write every plain PR/issue comment goes through, split out of `./write.ts` to keep it under the
 * repo's 700-code-line file-size ratchet (`src/devLint/fileSizeRatchet.ts`).
 *
 * Distinct from `./threads.ts`, which answers a review THREAD via GraphQL: a thread reply is pinned to a
 * diff line and lives inside the review conversation, while this is the plain activity-feed comment a caller
 * reaches for to address the whole pull request — asking for a re-review, say, rather than one finding.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, RepoRef, WriteCtx } from "./write.js";

/** How many recent comments one page holds — the boolean "is there one in the window" question needs no more. */
const RECENT_COMMENTS_PAGE_SIZE = 100;

/** One comment as GitHub confirms it, by create or by edit. */
export interface WrittenComment {
  readonly id: number;
  readonly htmlUrl: string;
  /** The body as GitHub STORED it — read back so a caller can confirm the write rather than trust the echo. */
  readonly body: string;
}

/** One top-level comment as `listIssueComments` reads it — enough to judge recency, by any author. */
export interface IssueCommentSummary {
  readonly id: number;
  readonly createdAtIso: string;
}

/**
 * The stored body, refusing an absent one rather than coalescing it to an empty string.
 *
 * Octokit types `body` optional because GitHub's schema allows it on a few read paths, but every one of
 * create/update/get for a comment we just sent (or are reading back for one) MUST carry it — an absent body
 * here is a broken response, not a comment with no text, and failing loud is what `no-empty-string-coalesce`
 * (`src/devLint/houseRules.ts`) exists to force.
 *
 * @param body the field as Octokit returned it
 * @param operation which call this came from, for the thrown message
 * @returns the body, or throws
 */
function requiredBody({ body, operation }: { body: string | undefined; operation: string }): string {
  if (body === undefined) {
    throw new Error(`GitHub returned no body for ${operation}`);
  }
  return body;
}

/**
 * Post a new top-level comment on an issue or pull request. Sent once; the caller confirms it separately.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the issue or pull request, and the rendered comment body
 * @returns the created comment's id, URL and stored body, or the provider failure
 */
export function createIssueCommentVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { body: string };
}): ResultAsync<WrittenComment, IngestError> {
  const { owner, repo, number, body } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.createComment({ body, issue_number: number, owner, repo });
      return {
        body: requiredBody({ body: res.data.body, operation: "github.issues.createComment" }),
        htmlUrl: res.data.html_url,
        id: res.data.id,
      };
    },
    operation: "github.issues.createComment",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Edit a comment already posted, by its numeric id. Sent once; the caller confirms it separately.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository, the comment's id, and its new rendered body
 * @returns the edited comment's id, URL and stored body, or the provider failure
 */
export function updateIssueCommentVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { commentId: number; body: string };
}): ResultAsync<WrittenComment, IngestError> {
  const { owner, repo, commentId, body } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.updateComment({ body, comment_id: commentId, owner, repo });
      return {
        body: requiredBody({ body: res.data.body, operation: "github.issues.updateComment" }),
        htmlUrl: res.data.html_url,
        id: res.data.id,
      };
    },
    operation: "github.issues.updateComment",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one comment back by id — the confirmation a create or edit is checked against.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the comment's id
 * @returns the comment's id, URL and stored body, or the provider failure
 */
export function getIssueCommentVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { commentId: number };
}): ResultAsync<WrittenComment, IngestError> {
  const { owner, repo, commentId } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.getComment({ comment_id: commentId, owner, repo });
      return {
        body: requiredBody({ body: res.data.body, operation: "github.issues.getComment" }),
        htmlUrl: res.data.html_url,
        id: res.data.id,
      };
    },
    operation: "github.issues.getComment",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Up to the first 100 top-level comments posted on an issue or pull request on or after `sinceIso`, by any
 * author — one page, with no signal when more than that matched.
 *
 * GitHub filters server-side on `since`, so one page is enough to answer the boolean question this exists
 * for — "did anyone comment recently" — without paginating a whole comment history.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the issue or pull request, and the ISO-8601 cutoff
 * @returns the first page's comments, each as its id and creation time, or the provider failure
 */
export function listIssueCommentsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { sinceIso: string };
}): ResultAsync<readonly IssueCommentSummary[], IngestError> {
  const { owner, repo, number, sinceIso } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.listComments({
        issue_number: number,
        owner,
        per_page: RECENT_COMMENTS_PAGE_SIZE,
        repo,
        since: sinceIso,
      });
      return res.data.map((comment) => ({ createdAtIso: comment.created_at, id: comment.id }));
    },
    operation: "github.issues.listComments",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
