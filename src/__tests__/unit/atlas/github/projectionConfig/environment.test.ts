/*
 * The deployment ENVIRONMENT projection, imported directly from `projectionEnvironment.ts`: its protection rules,
 * reviewers, wait timer, admin bypass and branch policy, each read from its own key.
 */
import { describe, expect, it } from "vitest";

import { projectGithubEnvironment } from "../../../../../atlas/github/projectionEnvironment.js";
import { CONTEXT, scopedFields } from "./harness.js";

describe("projectGithubEnvironment", () => {
  it("keeps the rule types sorted and the FIRST wait timer and self-review setting a rule carries", () => {
    const projected = projectGithubEnvironment({
      context: CONTEXT,
      raw: {
        can_admins_bypass: false,
        deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
        html_url: "https://github.com/acme-config/env-repo/deployments/activity_log?environments_filter=staging-env",
        id: 9601,
        name: "staging-env",
        protection_rules: [
          { id: 1, type: "branch_policy" },
          { id: 2, type: "wait_timer", wait_timer: 30 },
          {
            id: 3,
            prevent_self_review: true,
            // A user and a team share id 88, and the user appears twice.
            reviewers: [
              { reviewer: { id: 88 }, type: "User" },
              { reviewer: { id: 88 }, type: "Team" },
              { reviewer: { id: 88 }, type: "User" },
            ],
            type: "required_reviewers",
          },
          {
            id: 4,
            prevent_self_review: false,
            // The second entry carries an id only at the top level, where GitHub never puts it.
            reviewers: [
              { reviewer: { id: 42 }, type: "Team" },
              { id: 77, type: "User" },
            ],
            type: "required_reviewers",
            wait_timer: 99,
          },
          "not-a-rule",
        ],
        wait_timer: 555,
      },
      scopeRef: "acme-config/env-repo",
    });
    expect(projected).toEqual(
      expect.objectContaining({
        ...scopedFields({
          deepLink: "https://github.com/acme-config/env-repo/deployments/activity_log?environments_filter=staging-env",
          deepLinkStatus: "provider-provided",
          kind: "environment",
          providerId: "acme-config/env-repo/staging-env",
          scopeLevel: "environment",
          scopeRef: "acme-config/env-repo/staging-env",
        }),
        canAdminsBypass: false,
        deploymentBranchPolicy: "custom_branch_policies",
        name: "staging-env",
        preventSelfReview: true,
        protectionRuleTypes: ["branch_policy", "required_reviewers", "wait_timer"],
        reviewerIds: ["Team:42", "Team:88", "User:88"],
        waitTimerMinutes: 30,
      }),
    );
  });

  // Admin bypass and self-review disagree in both cases, so reading one from the other's key fails a case.
  it("reads the inverse: admins may bypass, and the first self-review setting is false", () => {
    const projected = projectGithubEnvironment({
      context: CONTEXT,
      raw: {
        can_admins_bypass: true,
        deployment_branch_policy: { custom_branch_policies: false, protected_branches: true },
        name: "production-env",
        protection_rules: [
          {
            prevent_self_review: false,
            reviewers: [{ reviewer: { id: 5 }, type: "User" }],
            type: "required_reviewers",
          },
          { prevent_self_review: true, type: "required_reviewers", wait_timer: 12.7 },
        ],
      },
      scopeRef: "acme-config/prod-repo",
    });
    expect(projected).toEqual(
      expect.objectContaining({
        ...scopedFields({
          deepLink: null,
          deepLinkStatus: "unavailable",
          kind: "environment",
          providerId: "acme-config/prod-repo/production-env",
          scopeLevel: "environment",
          scopeRef: "acme-config/prod-repo/production-env",
        }),
        canAdminsBypass: true,
        deploymentBranchPolicy: "protected_branches",
        name: "production-env",
        preventSelfReview: false,
        protectionRuleTypes: ["required_reviewers"],
        reviewerIds: ["User:5"],
        waitTimerMinutes: 12,
      }),
    );
  });

  it("reads an environment with no protection rules as unprotected", () => {
    const project = ({ rules }: { rules: unknown }): unknown =>
      projectGithubEnvironment({
        context: CONTEXT,
        raw: { name: "preview-env", protection_rules: rules },
        scopeRef: "acme-config/preview-repo",
      });
    const expected = expect.objectContaining({
      canAdminsBypass: null,
      deploymentBranchPolicy: null,
      name: "preview-env",
      preventSelfReview: null,
      protectionRuleTypes: [],
      reviewerIds: [],
      waitTimerMinutes: null,
    });
    expect(project({ rules: undefined })).toEqual(expected);
    expect(project({ rules: "not-a-list" })).toEqual(expected);
    expect(project({ rules: [] })).toEqual(expected);
  });

  it("reads GitHub's null branch policy as every branch, and a policy setting neither flag as unknown", () => {
    const policyOf = ({ policy }: { policy: unknown }): unknown =>
      projectGithubEnvironment({
        context: CONTEXT,
        raw: { deployment_branch_policy: policy, name: "policy-env" },
        scopeRef: "acme-config/policy-repo",
      });
    expect(policyOf({ policy: null })).toEqual(expect.objectContaining({ deploymentBranchPolicy: "all_branches" }));
    expect(policyOf({ policy: { custom_branch_policies: false, protected_branches: false } })).toEqual(
      expect.objectContaining({ deploymentBranchPolicy: null }),
    );
  });

  it("refuses an environment with no name, an empty name, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubEnvironment({ context: CONTEXT, raw, scopeRef: "acme-config/env-repo" });
    expect(refuse({ raw: { can_admins_bypass: true } })).toBe(null);
    expect(refuse({ raw: { name: "" } })).toBe(null);
    expect(refuse({ raw: null })).toBe(null);
  });
});
