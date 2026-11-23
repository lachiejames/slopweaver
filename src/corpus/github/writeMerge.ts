/**
 * The GitHub write lane's ADMIN-MERGE operations — `slopweaver github merge --admin`'s three seams, in their
 * own file so `./write.ts` stays under the file-size ratchet rather than growing past it.
 *
 * Same lane, same `WriteCtx`, same rules: every `client.rest` token sits LEXICALLY inside
 * `safeProviderCall(...)` (which is what `boundary-residue` sanctions), the irreversible one is
 * `retryMode: "never"`, and nothing here constructs a second Octokit — the context is passed in.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { type GithubProtectionReadError, settleProtectionRead } from "./protectionRead.js";
import type { PrRef, RepoRef, WriteCtx } from "./write.js";

/**
 * One branch's classic protection, narrowed to the single field an admin-bypass merge turns on.
 *
 * `unprotected` is its own member rather than a `false` `enforceAdmins`, because "GitHub returned 404, this
 * branch has no protection at all" and "protection exists and does not apply to admins" are different facts
 * and only the second one makes a bypass meaningful. `plan-unavailable` is a third: the repository's plan
 * cannot protect a branch at all (`./protectionRead.ts`), so there is no bypass to take either, for a reason a
 * reader should be told apart from a branch somebody simply left unprotected.
 */
export type BranchProtection =
  | { readonly kind: "protected"; readonly enforceAdmins: boolean }
  | { readonly kind: "unprotected" }
  | { readonly kind: "plan-unavailable" };

/** What GitHub reported after a squash merge: the commit it created, and its own account of what it did. */
export interface MergedPr {
  readonly merged: boolean;
  readonly sha: string;
}

/**
 * Whether the viewer holds admin permission — read from the same `repos.get` payload as `write.ts`'s
 * `canPushVia`, as a separate call rather than a widened one so neither preflight can be silently satisfied
 * by the other.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository whose permissions to read
 * @returns whether the authenticated viewer holds admin on it
 */
export function canAdminVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<boolean, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner: input.owner, repo: input.repo });
      return res.data.permissions?.admin === true;
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * One branch's classic protection. GitHub answers 404 for an unprotected branch and a plan-gated 403 where the
 * plan cannot protect one; both are STATES rather than faults, so `./protectionRead.ts` translates them here
 * instead of surfacing a failed read the caller has to interpret. Any other 403 is a typed permission denial.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the branch whose protection to read
 * @returns the branch's protection, that it has none, or that its plan cannot have any
 */
export function branchProtectionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<BranchProtection, GithubProtectionReadError> {
  const read = safeProviderCall({
    execute: async (): Promise<BranchProtection> => {
      const res = await ctx.client.rest.repos.getBranchProtection({
        branch: input.branch,
        owner: input.owner,
        repo: input.repo,
      });
      return { enforceAdmins: res.data.enforce_admins?.enabled === true, kind: "protected" };
    },
    operation: "github.repos.getBranchProtection",
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

/**
 * The squash merge itself — `retryMode: "never"`, like every other irreversible write in this lane, and
 * pinned to `sha` so GitHub itself refuses a head that moved after it was read.
 *
 * **`commit_message` is deliberately not sent, and that is load-bearing.** Omitting it leaves GitHub to
 * compose the body exactly as its own squash button does — which for a one-commit-off-base pull request is
 * that commit's own message body, the long explanation every squash commit in this repository carries.
 * Sending an empty string instead lands an empty body and silently destroys it. `commit_title` IS sent,
 * because the subject should name the pull request rather than whatever the branch tip happened to say.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the pull request, the head SHA to pin to, and the commit subject to write
 * @returns the squash commit GitHub created, and its own account of whether it merged
 */
export function mergeVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { sha: string; commitTitle: string };
}): ResultAsync<MergedPr, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.merge({
        commit_title: input.commitTitle,
        merge_method: "squash",
        owner: input.owner,
        pull_number: input.number,
        repo: input.repo,
        sha: input.sha,
      });
      return { merged: res.data.merged === true, sha: res.data.sha };
    },
    operation: "github.pulls.merge",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
