/*
 * The POLICY projections: the Actions policy folded from its two documents, and a ruleset reduced to type and key
 * names. A ruleset's `enforcement` is not a recorded residue: GitHub declares it required, so a ruleset without
 * one is refused below rather than stored under a substitute.
 */
import { describe, expect, it } from "vitest";

import { projectGithubRuleset } from "../../../../../atlas/github/projectionConfig.js";
import { projectGithubActionsPolicy } from "../../../../../atlas/github/projectionSettings.js";
import { CONTEXT, scopedFields } from "./harness.js";

describe("projectGithubActionsPolicy", () => {
  // Each row isolates one enablement flag as `true` against its two neighbours, and puts the OPPOSITE of
  // every enablement flag on the workflow document; `can_approve_pull_request_reviews` contradicts across
  // the two documents in both directions, so reading it from the wrong one is visible.
  const cases = [
    {
      enabled: true,
      githubOwnedAllowed: false,
      permissionsCanApprove: true,
      verifiedAllowed: false,
      workflowCanApprove: false,
    },
    {
      enabled: false,
      githubOwnedAllowed: true,
      permissionsCanApprove: false,
      verifiedAllowed: false,
      workflowCanApprove: true,
    },
    {
      enabled: false,
      githubOwnedAllowed: false,
      permissionsCanApprove: true,
      verifiedAllowed: true,
      workflowCanApprove: false,
    },
  ];

  it.each(cases)(
    "folds both documents, reading each field from its own one (enabled $enabled, github-owned $githubOwnedAllowed, verified $verifiedAllowed, workflow approve $workflowCanApprove)",
    ({ enabled, githubOwnedAllowed, verifiedAllowed, permissionsCanApprove, workflowCanApprove }) => {
      const projected = projectGithubActionsPolicy({
        context: CONTEXT,
        permissions: {
          allowed_actions: "selected-actions",
          can_approve_pull_request_reviews: permissionsCanApprove,
          default_workflow_permissions: "permissions-decoy-write",
          enabled,
          enabled_repositories: "selected-repositories",
          github_owned_allowed: githubOwnedAllowed,
          patterns_allowed: ["zeta-org/*", "alpha-org/*", "zeta-org/*", ""],
          verified_allowed: verifiedAllowed,
        },
        scopeLevel: "repository",
        scopeRef: "acme-config/actions-repo",
        workflow: {
          allowed_actions: "workflow-decoy-actions",
          can_approve_pull_request_reviews: workflowCanApprove,
          default_workflow_permissions: "read-from-workflow",
          enabled: !enabled,
          enabled_repositories: "workflow-decoy-repositories",
          github_owned_allowed: !githubOwnedAllowed,
          patterns_allowed: ["workflow-decoy/*"],
          verified_allowed: !verifiedAllowed,
        },
      });
      expect(projected).toEqual({
        ...scopedFields({
          deepLink: null,
          deepLinkStatus: "unavailable",
          kind: "actions-policy",
          providerId: "acme-config/actions-repo",
          scopeLevel: "repository",
          scopeRef: "acme-config/actions-repo",
        }),
        allowedActions: "selected-actions",
        canApprovePullRequestReviews: workflowCanApprove,
        defaultWorkflowPermissions: "read-from-workflow",
        enabled,
        enabledRepositories: "selected-repositories",
        githubOwnedAllowed,
        patternsAllowed: ["alpha-org/*", "zeta-org/*"],
        verifiedAllowed,
      });
    },
  );

  it("reads the workflow half as null when that route was not read, at the scope level it is given", () => {
    const permissions = {
      allowed_actions: "all-actions",
      can_approve_pull_request_reviews: true,
      default_workflow_permissions: "permissions-decoy-read",
      enabled: true,
      enabled_repositories: "all-repositories",
    };
    const expected = {
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "actions-policy",
        providerId: "acme-config-actions-org",
        scopeLevel: "organization",
        scopeRef: "acme-config-actions-org",
      }),
      allowedActions: "all-actions",
      canApprovePullRequestReviews: null,
      defaultWorkflowPermissions: null,
      enabled: true,
      enabledRepositories: "all-repositories",
      githubOwnedAllowed: null,
      patternsAllowed: [],
      verifiedAllowed: null,
    };
    const project = ({ workflow }: { workflow: unknown }): unknown =>
      projectGithubActionsPolicy({
        context: CONTEXT,
        permissions,
        scopeLevel: "organization",
        scopeRef: "acme-config-actions-org",
        workflow,
      });
    expect(project({ workflow: null })).toEqual(expected);
    expect(project({ workflow: "not-a-document" })).toEqual(expected);
  });

  it("refuses an enablement document that is not an object, whatever the workflow document holds", () => {
    expect(
      projectGithubActionsPolicy({
        context: CONTEXT,
        permissions: "not-a-document",
        scopeLevel: "repository",
        scopeRef: "acme-config/actions-repo",
        workflow: { can_approve_pull_request_reviews: true, default_workflow_permissions: "write" },
      }),
    ).toBe(null);
  });
});

describe("projectGithubRuleset", () => {
  it("reduces rules and conditions to sorted, de-duplicated type and key names", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: {
        bypass_actors: [{ actor_type: "Team", id: 91 }, { id: 12 }, { id: "integration-55" }, { id: 91 }],
        conditions: { repository_name: { include: ["~ALL"] }, ref_name: { include: ["~DEFAULT_BRANCH"] } },
        enforcement: "active-enforcement",
        html_url: "https://github.com/organizations/acme-config/settings/rules/9501",
        id: 9501,
        name: "ruleset-name",
        rules: [
          { type: "status-rule" },
          { type: "pull-request-rule", parameters: { required_approving_review_count: 2 } },
          { type: "status-rule" },
          { type: 7 },
          "not-a-rule",
        ],
        target: "branch-target",
        updated_at: "2026-09-05T10:30:00+10:00",
      },
      scopeLevel: "organization",
      scopeRef: "acme-config-rules-org",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: "https://github.com/organizations/acme-config/settings/rules/9501",
        deepLinkStatus: "provider-provided",
        kind: "ruleset",
        providerId: "9501",
        scopeLevel: "organization",
        scopeRef: "acme-config-rules-org",
      }),
      bypassActorIds: ["12", "91", "integration-55"],
      conditionKeys: ["ref_name", "repository_name"],
      enforcement: "active-enforcement",
      name: "ruleset-name",
      ruleTypes: ["pull-request-rule", "status-rule"],
      target: "branch-target",
      updatedAt: "2026-09-05T00:30:00.000Z",
    });
  });

  it("reads absent rules, conditions and actors as empty, at the scope level it is given", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: { enforcement: "evaluate-enforcement", name: "bare-ruleset-name", rules: "not-a-list" },
      scopeLevel: "repository",
      scopeRef: "acme-config/rules-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "ruleset",
        providerId: "bare-ruleset-name",
        scopeLevel: "repository",
        scopeRef: "acme-config/rules-repo",
      }),
      bypassActorIds: [],
      conditionKeys: [],
      enforcement: "evaluate-enforcement",
      name: "bare-ruleset-name",
      ruleTypes: [],
      target: null,
      updatedAt: null,
    });
  });

  it("refuses a ruleset with no name, an empty name, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubRuleset({ context: CONTEXT, raw, scopeLevel: "organization", scopeRef: "acme-config" });
    expect(refuse({ raw: { enforcement: "active", id: 9502 } })).toBe(null);
    expect(refuse({ raw: { name: "" } })).toBe(null);
    expect(refuse({ raw: "not-a-body" })).toBe(null);
  });

  it("refuses a ruleset with no enforcement, or an empty one, rather than storing a substitute", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubRuleset({ context: CONTEXT, raw, scopeLevel: "organization", scopeRef: "acme-config" });
    expect(refuse({ raw: { id: 9503, name: "unenforced-ruleset-name" } })).toBe(null);
    expect(refuse({ raw: { enforcement: "", id: 9504, name: "blank-enforcement-ruleset-name" } })).toBe(null);
  });
});
