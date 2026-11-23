/**
 * The projections for GitHub's SETTINGS documents — an organisation's settings, a repository's
 * administrative and security-and-analysis switches, and an Actions policy at either scope.
 *
 * Split from `projectionConfig.ts` on size alone; both share `projectionBase.ts`, whose header carries the
 * rules every projection here follows, and `projection.ts` re-exports both.
 */
import { isRecord } from "../../lib/parsers.js";

import type {
  GithubActionsPolicy,
  GithubOrganizationSettings,
  GithubRepositorySecuritySettings,
  GithubRepositorySettings,
} from "./entities.js";
import type { GithubScopeLevel } from "./model.js";
import { bool, nested, type ProjectionContext, providerIdOf, scopedOf, str, strings } from "./projectionBase.js";

/**
 * Project one organisation's settings document.
 *
 * @param raw the response body
 * @param scopeRef the organisation login
 * @param context the run's provenance
 * @returns the stored settings, or `null` when the body is not an object
 */
export function projectGithubOrganizationSettings({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubOrganizationSettings | null {
  if (!isRecord(raw)) {
    return null;
  }
  const login = str({ key: "login", raw });
  if (login === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "organization-settings",
      providerId: providerIdOf({ fallback: login, raw }),
      scopeLevel: "organization",
      scopeRef,
    }),
    advancedSecurityEnabledForNewRepositories: bool({ key: "advanced_security_enabled_for_new_repositories", raw }),
    defaultRepositoryPermission: str({ key: "default_repository_permission", raw }),
    dependabotAlertsEnabledForNewRepositories: bool({ key: "dependabot_alerts_enabled_for_new_repositories", raw }),
    dependabotSecurityUpdatesEnabledForNewRepositories: bool({
      key: "dependabot_security_updates_enabled_for_new_repositories",
      raw,
    }),
    dependencyGraphEnabledForNewRepositories: bool({ key: "dependency_graph_enabled_for_new_repositories", raw }),
    login,
    membersCanCreateInternalRepositories: bool({ key: "members_can_create_internal_repositories", raw }),
    membersCanCreatePages: bool({ key: "members_can_create_pages", raw }),
    membersCanCreatePrivateRepositories: bool({ key: "members_can_create_private_repositories", raw }),
    membersCanCreatePublicRepositories: bool({ key: "members_can_create_public_repositories", raw }),
    membersCanCreateRepositories: bool({ key: "members_can_create_repositories", raw }),
    membersCanForkPrivateRepositories: bool({ key: "members_can_fork_private_repositories", raw }),
    secretScanningEnabledForNewRepositories: bool({ key: "secret_scanning_enabled_for_new_repositories", raw }),
    secretScanningPushProtectionEnabledForNewRepositories: bool({
      key: "secret_scanning_push_protection_enabled_for_new_repositories",
      raw,
    }),
    twoFactorRequirementEnabled: bool({ key: "two_factor_requirement_enabled", raw }),
    webCommitSignoffRequired: bool({ key: "web_commit_signoff_required", raw }),
  };
}

/**
 * Project one repository's administrative switches.
 *
 * @param raw the response body
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored settings, or `null` when the body is not an object
 */
export function projectGithubRepositorySettings({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubRepositorySettings | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "repository-settings",
      providerId: providerIdOf({ fallback: scopeRef, raw }),
      scopeLevel: "repository",
      scopeRef,
    }),
    allowAutoMerge: bool({ key: "allow_auto_merge", raw }),
    allowForking: bool({ key: "allow_forking", raw }),
    allowMergeCommit: bool({ key: "allow_merge_commit", raw }),
    allowRebaseMerge: bool({ key: "allow_rebase_merge", raw }),
    allowSquashMerge: bool({ key: "allow_squash_merge", raw }),
    allowUpdateBranch: bool({ key: "allow_update_branch", raw }),
    archived: bool({ key: "archived", raw }) === true,
    defaultBranch: str({ key: "default_branch", raw }),
    deleteBranchOnMerge: bool({ key: "delete_branch_on_merge", raw }),
    description: str({ key: "description", raw }),
    disabled: bool({ key: "disabled", raw }) === true,
    hasDiscussions: bool({ key: "has_discussions", raw }),
    hasIssues: bool({ key: "has_issues", raw }),
    hasPages: bool({ key: "has_pages", raw }),
    hasProjects: bool({ key: "has_projects", raw }),
    hasWiki: bool({ key: "has_wiki", raw }),
    isTemplate: bool({ key: "is_template", raw }),
    mergeCommitMessage: str({ key: "merge_commit_message", raw }),
    mergeCommitTitle: str({ key: "merge_commit_title", raw }),
    squashMergeCommitMessage: str({ key: "squash_merge_commit_message", raw }),
    squashMergeCommitTitle: str({ key: "squash_merge_commit_title", raw }),
    topics: strings({ key: "topics", raw }),
    visibility: str({ key: "visibility", raw }),
    webCommitSignoffRequired: bool({ key: "web_commit_signoff_required", raw }),
  };
}

/**
 * Project one repository's security-and-analysis switches.
 *
 * GitHub returns these nested on the repository document rather than at a route of their own, which is why
 * this projection takes the same body as {@link projectGithubRepositorySettings} and reads a different part
 * of it. They are separate kinds because they answer separate questions and a reader filtering on security
 * should not have to know that GitHub bundles them.
 *
 * @param raw the repository response body
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored settings, or `null` when the body carries no security-and-analysis object
 */
export function projectGithubRepositorySecuritySettings({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubRepositorySecuritySettings | null {
  if (!isRecord(raw)) {
    return null;
  }
  const analysis = raw["security_and_analysis"];
  if (!isRecord(analysis)) {
    return null;
  }
  const statusOf = ({ key }: { key: string }): string | null =>
    str({ key: "status", raw: nested({ key, raw: analysis }) });
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "repository-security-settings",
      providerId: scopeRef,
      scopeLevel: "repository",
      scopeRef,
    }),
    advancedSecurity: statusOf({ key: "advanced_security" }),
    dependabotSecurityUpdates: statusOf({ key: "dependabot_security_updates" }),
    secretScanning: statusOf({ key: "secret_scanning" }),
    secretScanningNonProviderPatterns: statusOf({ key: "secret_scanning_non_provider_patterns" }),
    secretScanningPushProtection: statusOf({ key: "secret_scanning_push_protection" }),
    secretScanningValidityChecks: statusOf({ key: "secret_scanning_validity_checks" }),
  };
}

/**
 * Project one Actions policy at one scope.
 *
 * GitHub splits this across two routes — the enablement document and the workflow-defaults document — so
 * this takes both and folds them into one entity. Storing two would give one policy two rows whose fields
 * never overlap, which a reader would have to know to join.
 *
 * @param permissions the enablement document
 * @param workflow the workflow-defaults document, or `null` when that route was not read
 * @param scopeLevel which level of GitHub's hierarchy this policy governs
 * @param scopeRef the organisation login or `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored policy, or `null` when the enablement document is not an object
 */
export function projectGithubActionsPolicy({
  permissions,
  workflow,
  scopeLevel,
  scopeRef,
  context,
}: {
  permissions: unknown;
  workflow: unknown;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  context: ProjectionContext;
}): GithubActionsPolicy | null {
  if (!isRecord(permissions)) {
    return null;
  }
  const workflowRaw = isRecord(workflow) ? workflow : {};
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "actions-policy",
      providerId: scopeRef,
      scopeLevel,
      scopeRef,
    }),
    allowedActions: str({ key: "allowed_actions", raw: permissions }),
    canApprovePullRequestReviews: bool({ key: "can_approve_pull_request_reviews", raw: workflowRaw }),
    defaultWorkflowPermissions: str({ key: "default_workflow_permissions", raw: workflowRaw }),
    enabled: bool({ key: "enabled", raw: permissions }),
    enabledRepositories: str({ key: "enabled_repositories", raw: permissions }),
    githubOwnedAllowed: bool({ key: "github_owned_allowed", raw: permissions }),
    patternsAllowed: strings({ key: "patterns_allowed", raw: permissions }),
    verifiedAllowed: bool({ key: "verified_allowed", raw: permissions }),
  };
}
