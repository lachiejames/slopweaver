/**
 * Classic branch protection on one branch, as `github repo --apply-manifest` reads and writes it whole. On the
 * write lane's context (`./writeCtx.ts`), so the write is sent once.
 *
 * `PUT /repos/{owner}/{repo}/branches/{branch}/protection` REPLACES the branch's protection: a field the request
 * leaves out is reset, not kept. So the write sends every field the apply judges, `restrictions` as null and the
 * branch lock and fork syncing off, and the read records each field the write would clear as well as each it sets:
 * the digest binds the read, so protection that gained a push restriction after the preview holds the approval
 * rather than being silently cleared by it. A 404 on the read is the state "unprotected" (`./protectionRead.ts`);
 * the apply never reads protection on a private repository, whose free plan answers 403.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { errAsync, okAsync, type ResultAsync } from "../../lib/result.js";
import { classifyProtectionReadFailure } from "./protectionRead.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** The protection the apply sets on a branch, and reads back. */
export interface BranchProtectionSettings {
  readonly requiredStatusChecks: { readonly strict: boolean; readonly contexts: readonly string[] };
  readonly requiredPullRequestReviews: null;
  readonly enforceAdmins: boolean;
  readonly allowForcePushes: boolean;
  readonly allowDeletions: boolean;
  readonly requiredLinearHistory: boolean;
  readonly requiredConversationResolution: boolean;
}

/** What a protection read found: nothing protecting the branch, or the protection as it stands. */
export type BranchProtectionState =
  | { readonly kind: "unprotected" }
  | {
      readonly kind: "protected";
      /** Null when the branch requires no status check. */
      readonly requiredStatusChecks: { readonly strict: boolean; readonly contexts: readonly string[] } | null;
      readonly requiresPullRequestReviews: boolean;
      readonly enforceAdmins: boolean;
      readonly allowForcePushes: boolean;
      readonly allowDeletions: boolean;
      readonly requiredLinearHistory: boolean;
      readonly requiredConversationResolution: boolean;
      /**
       * Who may push, when push is restricted; null when it is not. The write clears it. A login or slug GitHub's
       * read leaves out stays undefined in place, so the count still binds.
       */
      readonly pushRestrictions: {
        readonly users: readonly (string | undefined)[];
        readonly teams: readonly string[];
        readonly apps: readonly (string | undefined)[];
      } | null;
      /** Whether the branch is locked read-only; undefined when GitHub's read carried no such field. */
      readonly lockBranch: boolean | undefined;
      /** Whether a fork may sync this locked branch; undefined when GitHub's read carried no such field. */
      readonly allowForkSyncing: boolean | undefined;
    };

/** A switch GitHub reports as `{ enabled }` that it may leave out of a read altogether. */
function optionalEnabledOf({ value }: { value: { enabled?: boolean } | undefined }): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.enabled;
}

/** A switch GitHub reports as `{ enabled }`, refused by name when absent. */
function enabledOf({ value, field }: { value: { enabled?: boolean } | undefined; field: string }): boolean {
  if (value === undefined || typeof value.enabled !== "boolean") {
    throw new Error(`GitHub's branch protection read omitted ${field}, so it is unknown`);
  }
  return value.enabled;
}

/**
 * Read one branch's classic protection. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the branch
 * @returns the protection, `unprotected` on a 404, or the provider failure
 */
export function getBranchProtectionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly branch: string };
}): ResultAsync<BranchProtectionState, IngestError> {
  const { owner, repo, branch } = input;
  return safeProviderCall({
    execute: async (): Promise<BranchProtectionState> => {
      const { data } = await ctx.client.rest.repos.getBranchProtection({ branch, owner, repo });
      const checks = data.required_status_checks;
      const restrictions = data.restrictions;
      return {
        allowDeletions: enabledOf({ field: "allow_deletions", value: data.allow_deletions }),
        allowForcePushes: enabledOf({ field: "allow_force_pushes", value: data.allow_force_pushes }),
        allowForkSyncing: optionalEnabledOf({ value: data.allow_fork_syncing }),
        enforceAdmins: enabledOf({ field: "enforce_admins", value: data.enforce_admins }),
        kind: "protected",
        lockBranch: optionalEnabledOf({ value: data.lock_branch }),
        pushRestrictions:
          restrictions === undefined
            ? null
            : {
                apps: restrictions.apps.map((app) => app.slug),
                teams: restrictions.teams.map((team) => team.slug),
                users: restrictions.users.map((user) => user.login),
              },
        requiredConversationResolution: enabledOf({
          field: "required_conversation_resolution",
          value: data.required_conversation_resolution,
        }),
        requiredLinearHistory: enabledOf({ field: "required_linear_history", value: data.required_linear_history }),
        requiredStatusChecks:
          checks === undefined ? null : { contexts: checks.contexts, strict: strictOf({ value: checks.strict }) },
        requiresPullRequestReviews: data.required_pull_request_reviews !== undefined,
      };
    },
    operation: "github.repos.getBranchProtection",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  }).orElse((error) =>
    classifyProtectionReadFailure({ failure: error }) === "unprotected"
      ? okAsync<BranchProtectionState, IngestError>({ kind: "unprotected" })
      : errAsync(error),
  );
}

/** The required-checks `strict` flag, refused when absent. */
function strictOf({ value }: { value: boolean | undefined }): boolean {
  if (typeof value !== "boolean") {
    throw new Error("GitHub's branch protection read omitted required_status_checks.strict, so it is unknown");
  }
  return value;
}

/**
 * Replace one branch's classic protection with exactly the given settings. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository, the branch and the whole protection it takes
 * @returns nothing on GitHub's acceptance
 */
export function setBranchProtectionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly branch: string; readonly protection: BranchProtectionSettings };
}): ResultAsync<void, IngestError> {
  const { owner, repo, branch, protection } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.updateBranchProtection({
        allow_deletions: protection.allowDeletions,
        allow_force_pushes: protection.allowForcePushes,
        allow_fork_syncing: false,
        branch,
        lock_branch: false,
        enforce_admins: protection.enforceAdmins,
        owner,
        repo,
        required_conversation_resolution: protection.requiredConversationResolution,
        required_linear_history: protection.requiredLinearHistory,
        required_pull_request_reviews: null,
        required_status_checks: {
          // oxlint-disable-next-line no-deprecated -- Octokit types `contexts` as REQUIRED on this endpoint; the manifest names checks by context only
          contexts: [...protection.requiredStatusChecks.contexts],
          strict: protection.requiredStatusChecks.strict,
        },
        restrictions: null,
      });
    },
    operation: "github.repos.updateBranchProtection",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
