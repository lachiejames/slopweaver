/**
 * The GitHub write lane's COMMIT-STATUS operations — `slopweaver github lap`'s three seams, in their own file so
 * `./write.ts` stays under the file-size ratchet, the same split `./writeMerge.ts` made.
 *
 * A legacy commit status and a check run share one name namespace in a branch's required contexts, so a status
 * named `build` that this token posts satisfies a `build` requirement — UNLESS the requirement is pinned to an
 * app. A pinned context (GitHub Actions is app 15368) can be satisfied only by that app, so GitHub's own
 * protection never counts a lap's status there. The third read exists so the lap can SAY so: its statuses are
 * Slopweaver's evidence, read by `github merge`'s own required-context gate before the administrator bypass.
 *
 * Same lane, same `WriteCtx`, same rules: every `client.rest` token sits LEXICALLY inside `safeProviderCall`,
 * the write is `retryMode: "never"`, and nothing here constructs a second Octokit.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { type GithubProtectionReadError, settleProtectionRead } from "./protectionRead.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** Every commit-status state GitHub accepts; a lap posts `pending` first, then one of the other three. */
export type LapStatusState = "pending" | "success" | "failure" | "error";

/** One commit status as GitHub reports it back, newest per context. */
export interface CommitStatus {
  readonly context: string;
  readonly state: string;
  /** GitHub's own `null` when the poster sent none — carried as-is rather than defaulted. */
  readonly description: string | null;
}

/** One required status-check context and the app, if any, it is pinned to. `undefined` means any source. */
interface RequiredCheckSource {
  readonly context: string;
  readonly appId: number | undefined;
}

/**
 * Post one commit status on a commit.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the commit, the context name, its state, and the one-line description GitHub shows beside it
 * @returns the status GitHub stored
 */
export function createCommitStatusVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { sha: string; context: string; state: LapStatusState; description: string };
}): ResultAsync<CommitStatus, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.createCommitStatus({
        context: input.context,
        description: input.description,
        owner: input.owner,
        repo: input.repo,
        sha: input.sha,
        state: input.state,
      });
      return {
        context: res.data.context,
        description: res.data.description,
        state: res.data.state,
      };
    },
    operation: "github.repos.createCommitStatus",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every commit status on one commit, the newest per context — the read-back after a post.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the commit whose combined status to read
 * @returns each context's newest status
 */
export function commitStatusesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { sha: string };
}): ResultAsync<readonly CommitStatus[], IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.getCombinedStatusForRef({
        owner: input.owner,
        per_page: 100,
        ref: input.sha,
        repo: input.repo,
      });
      return res.data.statuses.map((status) => ({
        context: status.context,
        description: status.description,
        state: status.state,
      }));
    },
    operation: "github.repos.getCombinedStatusForRef",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * What one branch's classic required status checks are: the sources it requires, or one of the two STATES in which
 * it requires none. Kept apart rather than an empty list for each, so a caller can say which it saw.
 */
export type RequiredCheckSources =
  | { readonly kind: "required"; readonly sources: readonly RequiredCheckSource[] }
  | { readonly kind: "unprotected" }
  | { readonly kind: "plan-unavailable" };

/**
 * One branch's classic required status checks with each one's pinned app.
 *
 * A 404 (no protection, or no status-check rule) is `unprotected` and a plan-gated 403 `plan-unavailable`
 * (`./protectionRead.ts`): nothing is required either way, so nothing is pinned. Any other 403 is a typed
 * permission denial.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the branch whose required checks to read
 * @returns each required context and the app it is pinned to, or which state means none is required
 */
export function requiredCheckSourcesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<RequiredCheckSources, GithubProtectionReadError> {
  const read = safeProviderCall({
    execute: async (): Promise<RequiredCheckSources> => {
      const res = await ctx.client.rest.repos.getStatusChecksProtection({
        branch: input.branch,
        owner: input.owner,
        repo: input.repo,
      });
      const sources = res.data.checks.map((check) => ({
        appId: check.app_id === null || check.app_id === -1 ? undefined : check.app_id,
        context: check.context,
      }));
      return { kind: "required", sources };
    },
    operation: "github.repos.getStatusChecksProtection",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
  return settleProtectionRead({
    branch: input.branch,
    planUnavailable: { kind: "plan-unavailable" },
    read,
    unprotected: { kind: "unprotected" },
  });
}
