import { describe, expect, it } from "vitest";

import {
  type ActionsPolicyState,
  actionsPolicyRefusal,
  actionsPolicySteps,
  actionsPolicyView,
  selectedActionsCompliant,
} from "../../../../../cli/commands/github/repoActionsPolicyPlan.js";
import { lifecycleState } from "../../../../githubRepoWriteFakes.js";

/** A public personal repository with Actions off, every action allowed, and every policy property drifted. */
function state(over: Partial<ActionsPolicyState> = {}): ActionsPolicyState {
  return {
    allowedActions: "all",
    enabled: false,
    forkApproval: "first_time_contributors",
    repository: lifecycleState({ private: false, visibility: "public" }),
    selectedActions: { kind: "unavailable-until-selected" },
    selfHostedRunners: 0,
    workflow: { canApprovePullRequestReviews: true, defaultWorkflowPermissions: "write" },
    ...over,
  };
}

const GITHUB_OWNED_ONLY = { githubOwnedAllowed: true, patternsAllowed: [], verifiedAllowed: false } as const;

const COMPLIANT = {
  allowedActions: "selected",
  forkApproval: "all_external_contributors",
  selectedActions: { kind: "read", policy: GITHUB_OWNED_ONLY },
  workflow: { canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" },
} as const;

describe("actionsPolicySteps", () => {
  it("restricts actions and applies every drifted property before switching Actions on", () => {
    expect(actionsPolicySteps({ state: state() })).toEqual([
      "select-actions-policy",
      "github-owned-actions-only",
      "read-only-token",
      "fork-approval-for-all",
      "switch-on",
    ]);
  });

  it("switches a running repository off first when any property drifted", () => {
    expect(
      actionsPolicySteps({ state: state({ ...COMPLIANT, enabled: true, forkApproval: "first_time_contributors" }) }),
    ).toEqual(["switch-off", "fork-approval-for-all", "switch-on"]);
  });

  it("only switches Actions on when the policy already holds with it off", () => {
    expect(actionsPolicySteps({ state: state(COMPLIANT) })).toEqual(["switch-on"]);
  });

  it("has nothing to do when Actions is on under the policy", () => {
    expect(actionsPolicySteps({ state: state({ ...COMPLIANT, enabled: true }) })).toEqual([]);
  });

  it("treats a token that may approve pull requests as drifted even when it is read-only", () => {
    const workflow = { canApprovePullRequestReviews: true, defaultWorkflowPermissions: "read" };
    expect(actionsPolicySteps({ state: state({ ...COMPLIANT, enabled: true, workflow }) })).toEqual([
      "switch-off",
      "read-only-token",
      "switch-on",
    ]);
  });

  it("switches a repository running every action off before restricting it", () => {
    const running = state({
      ...COMPLIANT,
      allowedActions: "all",
      enabled: true,
      selectedActions: { kind: "unavailable-until-selected" },
    });
    expect(actionsPolicySteps({ state: running })).toEqual([
      "switch-off",
      "select-actions-policy",
      "github-owned-actions-only",
      "switch-on",
    ]);
  });

  it("narrows a selected policy that also allows verified publishers, keeping the mode", () => {
    const selectedActions = { kind: "read", policy: { ...GITHUB_OWNED_ONLY, verifiedAllowed: true } } as const;
    expect(actionsPolicySteps({ state: state({ ...COMPLIANT, enabled: true, selectedActions }) })).toEqual([
      "switch-off",
      "github-owned-actions-only",
      "switch-on",
    ]);
  });
});

describe("selectedActionsCompliant", () => {
  it("is never satisfied by a policy that was not read", () => {
    expect(selectedActionsCompliant({ selectedActions: { kind: "unavailable-until-selected" } })).toBe(false);
  });

  it("refuses a pattern even when only GitHub-owned actions are otherwise allowed", () => {
    const policy = { ...GITHUB_OWNED_ONLY, patternsAllowed: ["acme/*"] };
    expect(selectedActionsCompliant({ selectedActions: { kind: "read", policy } })).toBe(false);
  });

  it("accepts GitHub-owned only, no verified publisher and no pattern", () => {
    expect(selectedActionsCompliant({ selectedActions: { kind: "read", policy: GITHUB_OWNED_ONLY } })).toBe(true);
  });
});

describe("actionsPolicyRefusal", () => {
  it("refuses an organisation's repository, whose runner groups a repository read cannot see", () => {
    const repository = lifecycleState({ ownerType: "Organization" });
    expect(actionsPolicyRefusal({ state: state({ repository }) })!.message).toContain(
      "acme/widget is owned by an Organization, and a repository read cannot prove",
    );
  });

  it("refuses a private repository, whose fork approval setting is not the policy's", () => {
    expect(actionsPolicyRefusal({ state: state({ repository: lifecycleState() }) })!.message).toContain(
      "acme/widget is private, and the policy's fork pull request approval is GitHub's setting for a public",
    );
  });

  it("refuses an organisation's repository before its visibility", () => {
    const repository = lifecycleState({ ownerType: "Organization" });
    expect(actionsPolicyRefusal({ state: state({ repository }) })!.code).toBe("FACT_REFUSED");
    expect(actionsPolicyRefusal({ state: state({ repository }) })!.message).toContain("owned by an Organization");
  });

  it("refuses a repository with a self-hosted runner registered", () => {
    expect(actionsPolicyRefusal({ state: state({ selfHostedRunners: 2 }) })!.message).toContain(
      "acme/widget has 2 self-hosted runner(s) registered, so Actions stays off",
    );
  });

  it("accepts a personal repository with no self-hosted runner", () => {
    expect(actionsPolicyRefusal({ state: state() })).toBe(undefined);
  });
});

describe("actionsPolicyView", () => {
  it("binds every live field a step overwrites or depends on, the policy and the steps", () => {
    expect(actionsPolicyView({ source: "acme/widget", state: state({ ...COMPLIANT, enabled: false }) })).toEqual({
      action: "enable-actions",
      current: {
        allowedActions: "selected",
        enabled: false,
        forkApproval: "all_external_contributors",
        fullName: "acme/widget",
        id: 101,
        ownerType: "User",
        selectedActions: { kind: "read", policy: GITHUB_OWNED_ONLY },
        selfHostedRunners: 0,
        visibility: "public",
        workflow: { canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" },
      },
      policy: {
        allowedActions: "selected",
        canApprovePullRequestReviews: false,
        defaultWorkflowPermissions: "read",
        forkApproval: "all_external_contributors",
        runners: "github-hosted only",
        selectedActions: GITHUB_OWNED_ONLY,
      },
      source: "acme/widget",
      steps: ["switch-on"],
    });
  });

  it("binds a selected-actions policy that was not read as exactly that, never as a value", () => {
    expect(actionsPolicyView({ source: "acme/widget", state: state() })["current"]).toMatchObject({
      allowedActions: "all",
      selectedActions: { kind: "unavailable-until-selected" },
    });
  });
});
