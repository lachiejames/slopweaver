/**
 * The four repository settings `github repo --enable-actions` establishes, and the one it checks: which actions may
 * run (GitHub-owned only), the workflow
 * token's default permissions, the approval policy for fork pull requests, the Actions switch itself (read and
 * the OFF write stay in `./repoActions.ts`; the ON write is here), and how many self-hosted runners are
 * registered on the repository. On the write lane's context (`./writeCtx.ts`), so each write is sent once, bar
 * undici's re-send after an HTTP 421, which the server did not handle and no option here can stop (pinned in
 * `src/__tests__/integration/githubWriteTransport.test.ts`). The runner count is checked at runtime too: only a
 * whole number of zero or more is a count, so a malformed one can never read as "none".
 *
 * The fork-approval endpoint is in the SDK's route types but has no named method in the pinned
 * `@octokit/plugin-rest-endpoint-methods`, so it is reached through the typed `request` route rather than a
 * guessed method name, and its one field is checked at runtime: a body without a known policy must never read
 * as the safe one.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** GitHub's three fork pull request approval policies, from least to most restrictive. */
const FORK_APPROVAL_POLICIES = [
  "first_time_contributors_new_to_github",
  "first_time_contributors",
  "all_external_contributors",
] as const;

/** One fork pull request approval policy. */
export type ForkApprovalPolicy = (typeof FORK_APPROVAL_POLICIES)[number];

/** The workflow token's default permissions, as GitHub reports them. */
export interface WorkflowTokenPolicy {
  /** `read` or `write`. */
  readonly defaultWorkflowPermissions: string;
  readonly canApprovePullRequestReviews: boolean;
}

/**
 * Narrow an unknown value to one of the known fork approval policies.
 *
 * Positional because a type predicate cannot destructure (TS1230).
 *
 * @returns true when the value is one of {@link FORK_APPROVAL_POLICIES}
 */
export function isForkApprovalPolicy(value: unknown): value is ForkApprovalPolicy {
  return FORK_APPROVAL_POLICIES.some((policy) => policy === value);
}

/**
 * Read the workflow token's default permissions. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns the live token policy
 */
export function getWorkflowTokenPolicyVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<WorkflowTokenPolicy, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.getGithubActionsDefaultWorkflowPermissionsRepository({ owner, repo });
      const canApprove: unknown = res.data.can_approve_pull_request_reviews;
      const permissions: unknown = res.data.default_workflow_permissions;
      // An absent field must never read as the safe value: `!undefined` is true.
      if (typeof canApprove !== "boolean" || typeof permissions !== "string") {
        throw new Error("GitHub's workflow token policy omitted a field, so it is unknown");
      }
      return { canApprovePullRequestReviews: canApprove, defaultWorkflowPermissions: permissions };
    },
    operation: "github.actions.getGithubActionsDefaultWorkflowPermissionsRepository",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Make the workflow token read-only and unable to approve a pull request. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to write
 * @returns nothing on GitHub's acceptance
 */
export function setReadOnlyWorkflowTokenVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.actions.setGithubActionsDefaultWorkflowPermissionsRepository({
        can_approve_pull_request_reviews: false,
        default_workflow_permissions: "read",
        owner,
        repo,
      });
    },
    operation: "github.actions.setGithubActionsDefaultWorkflowPermissionsRepository",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read the fork pull request approval policy. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns the live policy; a body naming no known policy is an error
 */
export function getForkApprovalPolicyVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<ForkApprovalPolicy, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request(
        "GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval",
        {
          owner,
          repo,
        },
      );
      const policy: unknown = res.data.approval_policy;
      if (!isForkApprovalPolicy(policy)) {
        throw new Error("GitHub's fork pull request approval policy named no known policy, so it is unknown");
      }
      return policy;
    },
    operation: "github.actions.getForkPrContributorApprovalPermissionsRepository",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Require approval before a fork pull request from ANY outside contributor runs a workflow. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to write
 * @returns nothing on GitHub's acceptance
 */
export function setForkApprovalForAllOutsidersVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.request("PUT /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval", {
        approval_policy: "all_external_contributors",
        owner,
        repo,
      });
    },
    operation: "github.actions.setForkPrContributorApprovalPermissionsRepository",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Count the self-hosted runners registered on the repository itself. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns GitHub's `total_count`, never the length of one page
 */
export function countSelfHostedRunnersVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<number, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.listSelfHostedRunnersForRepo({ owner, per_page: 1, repo });
      const count: unknown = res.data.total_count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new Error("GitHub's self-hosted runner count was not a whole number of zero or more, so it is unknown");
      }
      return count;
    },
    operation: "github.actions.listSelfHostedRunnersForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** Which actions a repository's workflows may use once `allowed_actions` is `selected`. */
export interface SelectedActionsPolicy {
  readonly githubOwnedAllowed: boolean;
  readonly verifiedAllowed: boolean;
  readonly patternsAllowed: readonly string[];
}

/**
 * Read the selected-actions policy. Repeatable. Only meaningful while `allowed_actions` is `selected`, so the
 * caller reads the switch first and does not ask in any other mode.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns the policy; a field GitHub omitted is an error, never the safe value
 */
export function getSelectedActionsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<SelectedActionsPolicy, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const { data } = await ctx.client.rest.actions.getAllowedActionsRepository({ owner, repo });
      const githubOwned: unknown = data.github_owned_allowed;
      const verified: unknown = data.verified_allowed;
      const patterns: unknown = data.patterns_allowed;
      if (typeof githubOwned !== "boolean" || typeof verified !== "boolean" || !Array.isArray(patterns)) {
        throw new Error("GitHub's selected-actions policy omitted a field, so it is unknown");
      }
      return {
        githubOwnedAllowed: githubOwned,
        patternsAllowed: patterns.map((pattern) => String(pattern)),
        verifiedAllowed: verified,
      };
    },
    operation: "github.actions.getAllowedActionsRepository",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Allow GitHub-owned actions only: no verified publisher, no pattern. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to write
 * @returns nothing on GitHub's acceptance
 */
export function setGithubOwnedActionsOnlyVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.actions.setAllowedActionsRepository({
        github_owned_allowed: true,
        owner,
        patterns_allowed: [],
        repo,
        verified_allowed: false,
      });
    },
    operation: "github.actions.setAllowedActionsRepository",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Switch Actions on or off for a repository, naming which actions may run when `allowedActions` is given. GitHub
 * takes `enabled` in the same request as `allowed_actions`, so the caller always names the switch position it
 * means. Sent once; the caller confirms it with a read-back.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository, the switch position, and optionally the allowed-actions mode
 * @returns nothing on GitHub's acceptance
 */
export function setRepoActionsEnabledVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly enabled: boolean; readonly allowedActions?: "selected" };
}): ResultAsync<void, IngestError> {
  const { owner, repo, enabled, allowedActions } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.actions.setGithubActionsPermissionsRepository({
        enabled,
        owner,
        repo,
        ...(allowedActions === undefined ? {} : { allowed_actions: allowedActions }),
      });
    },
    operation: "github.actions.setGithubActionsPermissionsRepository",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
