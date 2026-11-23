/**
 * The reads and the one write behind `slopweaver github cycle` — a pull request's test-merge state, the
 * `refs/pull/N/merge` ref and its parents, and the reopen that follows `closeVia`. Held in this lane beside
 * `./refs.ts` for the reason that file's header gives: NOT members of `GithubWriteApi` (`./write.ts`), whose
 * every test fake would otherwise have to grow members it never touches.
 *
 * Why the merge ref is read at all: a `pull_request` run checks out `refs/pull/N/merge`, and GitHub recomputes
 * that ref lazily. On a real acme-admin pull request a re-run and a
 * first close-and-reopen both ran the merge onto a stale base long after staging had moved on; after
 * that reopen a `GET pulls/<n>` showed the recomputed merge commit, and the second reopen ran on it. Re-check any open
 * pull request with `slopweaver github cycle --repo <owner/name> --number <n> --dry-run`, which prints the
 * merge ref, its parents and the base tip side by side.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, RepoRef, WriteCtx, WrittenPr } from "./write.js";
import { toWrittenPr } from "./writeCrud.js";

/** A pull request with the test-merge fields `WrittenPr` leaves out. */
export interface PullMergeState {
  readonly pr: WrittenPr;
  /** GitHub's own `mergeable`: null while it is still computing the test merge, false on a conflict. */
  readonly mergeable: boolean | null;
  /** The test merge commit GitHub last computed — what `refs/pull/N/merge` should name — or null. */
  readonly mergeCommitSha: string | null;
  /** Whether auto-merge is enabled, which closing the pull request switches off. */
  readonly autoMerge: boolean;
}

/** Whether a thrown provider error is a 404 — what a ref read answers "not there" with. */
function isNotFound({ error }: { error: unknown }): boolean {
  return error instanceof Object && "status" in error && error.status === 404;
}

/**
 * Read one pull request with its test-merge state. The read does NOT make GitHub recompute a finished test
 * merge: on a real acme-admin pull request, repeated reads 45 minutes after staging moved still returned
 * the merge onto staging's previous tip. Re-check with `slopweaver github cycle --repo <owner/name> --number <n>
 * --dry-run`.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and pull request number
 * @returns the pull request and its merge fields, or the provider failure
 */
export function pullMergeStateVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<PullMergeState, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      return {
        autoMerge: res.data.auto_merge !== null,
        mergeCommitSha: res.data.merge_commit_sha,
        mergeable: res.data.mergeable,
        pr: toWrittenPr({ data: res.data }),
      };
    },
    operation: "github.pulls.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Whether GitHub reports a merge-queue entry for one pull request — REST carries no such field, so this is the
 * one GraphQL read a cycle makes, and the reason a queued pull request is refused rather than silently dropped.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and pull request number
 * @returns true when the pull request has a queue entry, or the provider failure
 */
export function mergeQueuedVia({ ctx, input }: { ctx: WriteCtx; input: PrRef }): ResultAsync<boolean, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const response = await ctx.client.graphql<Record<string, unknown>>(
        `query SlopweaverCycleQueueEntry($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) { pullRequest(number: $number) { mergeQueueEntry { state } } }
        }`,
        { number, owner, repo },
      );
      const repository = response["repository"];
      const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
      if (!isRecord(pullRequest)) {
        throw new Error(`GitHub returned no pull request ${owner}/${repo}#${String(number)} for its queue entry`);
      }
      return isRecord(pullRequest["mergeQueueEntry"]);
    },
    operation: "github.pullRequest.mergeQueueEntry",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * The commit `refs/pull/N/merge` names now, or undefined when GitHub holds no such ref (a conflicted pull
 * request has none).
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and pull request number
 * @returns the merge ref's commit sha, or undefined on a 404
 */
export function mergeRefVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<string | undefined, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      try {
        const res = await ctx.client.rest.git.getRef({ owner, ref: `pull/${String(number)}/merge`, repo });
        return res.data.object.sha;
      } catch (error: unknown) {
        if (isNotFound({ error })) {
          return undefined;
        }
        throw error;
      }
    },
    operation: "github.git.getRef",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * One commit's parents, in order — a test merge commit's first parent is the base it merged onto and its
 * second the pull request's head.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the commit's full sha
 * @returns the parent shas in order, or the provider failure
 */
export function commitParentsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { sha: string };
}): ResultAsync<readonly string[], IngestError> {
  const { owner, repo, sha } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.git.getCommit({ commit_sha: sha, owner, repo });
      return res.data.parents.map((parent) => parent.sha);
    },
    operation: "github.git.getCommit",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Reopen a closed, unmerged pull request — the second half of a cycle. Sent once by this code, like
 * `closeVia`; the caller reads the pull request back to learn what actually happened.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and pull request number
 * @returns the reopened pull request, or the provider failure
 */
export function reopenVia({ ctx, input }: { ctx: WriteCtx; input: PrRef }): ResultAsync<WrittenPr, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.update({ owner, pull_number: number, repo, state: "open" });
      return toWrittenPr({ data: res.data });
    },
    operation: "github.pulls.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
