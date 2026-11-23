/*
 * The organisation and repository SETTINGS projections. Both kinds are boolean-heavy, so they are walked one flag
 * at a time: the flag under test is isolated against every neighbour holding the opposite value, in both
 * directions.
 *
 * One recorded residue is deliberately NOT asserted here: the literal fallbacks for an ABSENT
 * `archived`/`disabled`. Each of those fields is only ever asserted where the provider supplied it.
 */
import { describe, expect, it } from "vitest";

import {
  projectGithubOrganizationSettings,
  projectGithubRepositorySettings,
} from "../../../../../atlas/github/projectionSettings.js";
import { CONTEXT, scopedFields } from "./harness.js";

/**
 * One isolation fixture over a table of boolean flags: the isolated flag holds `isolatedValue` and every
 * neighbour holds the opposite, both on the raw side and on the projected side.
 */
function isolatedFlags({
  pairs,
  isolatedKey,
  isolatedValue,
}: {
  pairs: readonly (readonly [string, string])[];
  isolatedKey: string;
  isolatedValue: boolean;
}): { raw: Record<string, boolean>; projected: Record<string, boolean> } {
  const raw: Record<string, boolean> = {};
  const projected: Record<string, boolean> = {};
  for (const [rawKey, field] of pairs) {
    const value = rawKey === isolatedKey ? isolatedValue : !isolatedValue;
    raw[rawKey] = value;
    projected[field] = value;
  }
  return { projected, raw };
}

/** Every flag of a table, isolated once as `true` and once as `false`. */
function isolationCases({
  pairs,
}: {
  pairs: readonly (readonly [string, string])[];
}): { isolatedKey: string; isolatedValue: boolean }[] {
  return pairs.flatMap(([isolatedKey]) => [
    { isolatedKey, isolatedValue: true },
    { isolatedKey, isolatedValue: false },
  ]);
}

/** Every projected field of a table set to `null`, which is what an unseen flag must read as. */
function nullFields({ pairs }: { pairs: readonly (readonly [string, string])[] }): Record<string, null> {
  return Object.fromEntries(pairs.map(([, field]) => [field, null]));
}

const ORG_FLAGS = [
  ["advanced_security_enabled_for_new_repositories", "advancedSecurityEnabledForNewRepositories"],
  ["dependabot_alerts_enabled_for_new_repositories", "dependabotAlertsEnabledForNewRepositories"],
  ["dependabot_security_updates_enabled_for_new_repositories", "dependabotSecurityUpdatesEnabledForNewRepositories"],
  ["dependency_graph_enabled_for_new_repositories", "dependencyGraphEnabledForNewRepositories"],
  ["members_can_create_internal_repositories", "membersCanCreateInternalRepositories"],
  ["members_can_create_pages", "membersCanCreatePages"],
  ["members_can_create_private_repositories", "membersCanCreatePrivateRepositories"],
  ["members_can_create_public_repositories", "membersCanCreatePublicRepositories"],
  ["members_can_create_repositories", "membersCanCreateRepositories"],
  ["members_can_fork_private_repositories", "membersCanForkPrivateRepositories"],
  ["secret_scanning_enabled_for_new_repositories", "secretScanningEnabledForNewRepositories"],
  [
    "secret_scanning_push_protection_enabled_for_new_repositories",
    "secretScanningPushProtectionEnabledForNewRepositories",
  ],
  ["two_factor_requirement_enabled", "twoFactorRequirementEnabled"],
  ["web_commit_signoff_required", "webCommitSignoffRequired"],
] as const;

describe("projectGithubOrganizationSettings", () => {
  it.each(isolationCases({ pairs: ORG_FLAGS }))(
    "reads $isolatedKey on its own when it is $isolatedValue",
    ({ isolatedKey, isolatedValue }) => {
      const flags = isolatedFlags({ isolatedKey, isolatedValue, pairs: ORG_FLAGS });
      const projected = projectGithubOrganizationSettings({
        context: CONTEXT,
        raw: {
          ...flags.raw,
          default_repository_permission: "triage-permission",
          html_url: "https://github.com/acme-config",
          id: 7001,
          login: "acme-config-login",
        },
        scopeRef: "acme-config-scope",
      });
      expect(projected).toEqual({
        ...scopedFields({
          deepLink: "https://github.com/acme-config",
          deepLinkStatus: "provider-provided",
          kind: "organization-settings",
          providerId: "7001",
          scopeLevel: "organization",
          scopeRef: "acme-config-scope",
        }),
        ...flags.projected,
        defaultRepositoryPermission: "triage-permission",
        login: "acme-config-login",
      });
    },
  );

  it("reads every unseen flag as null, and falls back to the login for the provider id", () => {
    const projected = projectGithubOrganizationSettings({
      context: CONTEXT,
      raw: { login: "bare-org-login", two_factor_requirement_enabled: "yes-but-a-string" },
      scopeRef: "bare-org-scope",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "organization-settings",
        providerId: "bare-org-login",
        scopeLevel: "organization",
        scopeRef: "bare-org-scope",
      }),
      ...nullFields({ pairs: ORG_FLAGS }),
      defaultRepositoryPermission: null,
      login: "bare-org-login",
    });
  });

  it("refuses a body with no login, an empty login, or no body at all", () => {
    expect(projectGithubOrganizationSettings({ context: CONTEXT, raw: { id: 7002 }, scopeRef: "o" })).toBe(null);
    expect(projectGithubOrganizationSettings({ context: CONTEXT, raw: { login: "" }, scopeRef: "o" })).toBe(null);
    expect(projectGithubOrganizationSettings({ context: CONTEXT, raw: "not-a-body", scopeRef: "o" })).toBe(null);
    expect(projectGithubOrganizationSettings({ context: CONTEXT, raw: null, scopeRef: "o" })).toBe(null);
  });
});

const REPO_NULLABLE_FLAGS = [
  ["allow_auto_merge", "allowAutoMerge"],
  ["allow_forking", "allowForking"],
  ["allow_merge_commit", "allowMergeCommit"],
  ["allow_rebase_merge", "allowRebaseMerge"],
  ["allow_squash_merge", "allowSquashMerge"],
  ["allow_update_branch", "allowUpdateBranch"],
  ["delete_branch_on_merge", "deleteBranchOnMerge"],
  ["has_discussions", "hasDiscussions"],
  ["has_issues", "hasIssues"],
  ["has_pages", "hasPages"],
  ["has_projects", "hasProjects"],
  ["has_wiki", "hasWiki"],
  ["is_template", "isTemplate"],
  ["web_commit_signoff_required", "webCommitSignoffRequired"],
] as const;

// `archived` and `disabled` join the isolation walk because every fixture here SUPPLIES them; their
// absent-field fallback is recorded residue and is never asserted.
const REPO_FLAGS = [...REPO_NULLABLE_FLAGS, ["archived", "archived"], ["disabled", "disabled"]] as const;

const REPO_STRINGS = {
  default_branch: "trunk-branch",
  description: "settings-repo-description-sentinel",
  merge_commit_message: "PR_BODY",
  merge_commit_title: "MERGE_MESSAGE",
  squash_merge_commit_message: "COMMIT_MESSAGES",
  squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
  visibility: "internal-visibility",
};

describe("projectGithubRepositorySettings", () => {
  it.each(isolationCases({ pairs: REPO_FLAGS }))(
    "reads $isolatedKey on its own when it is $isolatedValue",
    ({ isolatedKey, isolatedValue }) => {
      const flags = isolatedFlags({ isolatedKey, isolatedValue, pairs: REPO_FLAGS });
      const projected = projectGithubRepositorySettings({
        context: CONTEXT,
        raw: {
          ...flags.raw,
          ...REPO_STRINGS,
          html_url: "https://github.com/acme-config/settings-repo",
          id: 8101,
          topics: ["zulu-topic", "alpha-topic", "zulu-topic", 7],
        },
        scopeRef: "acme-config/settings-repo",
      });
      expect(projected).toEqual({
        ...scopedFields({
          deepLink: "https://github.com/acme-config/settings-repo",
          deepLinkStatus: "provider-provided",
          kind: "repository-settings",
          providerId: "8101",
          scopeLevel: "repository",
          scopeRef: "acme-config/settings-repo",
        }),
        ...flags.projected,
        defaultBranch: "trunk-branch",
        description: "settings-repo-description-sentinel",
        mergeCommitMessage: "PR_BODY",
        mergeCommitTitle: "MERGE_MESSAGE",
        squashMergeCommitMessage: "COMMIT_MESSAGES",
        squashMergeCommitTitle: "COMMIT_OR_PR_TITLE",
        topics: ["alpha-topic", "zulu-topic"],
        visibility: "internal-visibility",
      });
    },
  );

  it("reads every unseen nullable flag and string as null, and falls back to the scope for the provider id", () => {
    const projected = projectGithubRepositorySettings({
      context: CONTEXT,
      raw: { archived: true, disabled: false, visibility: "" },
      scopeRef: "acme-config/bare-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "repository-settings",
        providerId: "acme-config/bare-repo",
        scopeLevel: "repository",
        scopeRef: "acme-config/bare-repo",
      }),
      ...nullFields({ pairs: REPO_NULLABLE_FLAGS }),
      archived: true,
      defaultBranch: null,
      description: null,
      disabled: false,
      mergeCommitMessage: null,
      mergeCommitTitle: null,
      squashMergeCommitMessage: null,
      squashMergeCommitTitle: null,
      topics: [],
      visibility: null,
    });
  });

  it("refuses a body that is not an object", () => {
    expect(projectGithubRepositorySettings({ context: CONTEXT, raw: "not-a-body", scopeRef: "r" })).toBe(null);
    expect(projectGithubRepositorySettings({ context: CONTEXT, raw: null, scopeRef: "r" })).toBe(null);
  });
});
