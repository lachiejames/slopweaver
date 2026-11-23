/**
 * The pure half of `github repo --enable-actions`: the stated policy, whether a repository already meets it, what
 * refuses it, the ordered steps that reach it, and the plan view its digest binds.
 *
 * The policy is four properties, and the ORDER of the steps is what keeps a partial failure safe. A repository
 * whose Actions is on while any property drifts is switched OFF first, so a step that fails part-way leaves
 * Actions off rather than on under a policy that was only half applied; Actions goes ON last, and only after the
 * self-hosted runner count is read again.
 *
 * Which actions may run is set while Actions is off, in the same approval as the switch-on, never in a separate
 * write: GitHub takes `enabled` in the same request as `allowed_actions`, so the mode is set with `enabled: false`
 * and the switch-on names `selected` again, and the selected-actions policy (GitHub-owned only) is read back
 * before Actions goes on.
 *
 * "GitHub-hosted runners only" has no switch on a repository: it is a fact read, never a setting written. It is
 * provable here only for a repository a personal account owns, where the repository's own runner list is the
 * whole set. An organisation's runner groups can reach a repository without appearing in that list, so an
 * organisation-owned repository is refused rather than claimed.
 *
 * The fork approval property is GitHub's PUBLIC-repository setting (`fork-pr-contributor-approval`); a private
 * repository's fork pull request workflows are a different setting. MEASURED on a private personal repository with
 * Actions off: reading it answered HTTP 422 (repro: `slopweaver github repo --repo <private owner/name>
 * --enable-actions` with the visibility refusal removed). So a repository that is not public is refused before that
 * setting is read, and the route is to publish it first (`--set-public`).
 */

import { unsetFieldAsNull } from "#lib/absent.js";

import type {
  ForkApprovalPolicy,
  SelectedActionsPolicy,
  WorkflowTokenPolicy,
} from "../../../outbound/github/repoActionsPolicy.js";
import type { RepoLifecycleState } from "../../../outbound/github/repoLifecycle.js";
import { type GithubFactRefusedError, GithubVerbErrors } from "./errors.js";

/**
 * The selected-actions policy as read, or the fact that it is not read: GitHub's selected-actions endpoint speaks
 * only while `allowed_actions` is `selected`, so in any other mode it is never asked and never assumed.
 */
export type SelectedActionsRead =
  { readonly kind: "read"; readonly policy: SelectedActionsPolicy } | { readonly kind: "unavailable-until-selected" };

/** Everything the policy is judged against, read live. */
export interface ActionsPolicyState {
  readonly repository: RepoLifecycleState;
  readonly enabled: boolean;
  readonly allowedActions: string | undefined;
  readonly selectedActions: SelectedActionsRead;
  readonly workflow: WorkflowTokenPolicy;
  readonly forkApproval: ForkApprovalPolicy;
  readonly selfHostedRunners: number;
}

/** One step toward the policy, in the order it is sent. */
export type ActionsPolicyStep =
  | "switch-off"
  | "select-actions-policy"
  | "github-owned-actions-only"
  | "read-only-token"
  | "fork-approval-for-all"
  | "switch-on";

/** The policy as the preview states it and the view binds it. */
const ACTIONS_POLICY = {
  allowedActions: "selected",
  canApprovePullRequestReviews: false,
  defaultWorkflowPermissions: "read",
  forkApproval: "all_external_contributors",
  runners: "github-hosted only",
  selectedActions: { githubOwnedAllowed: true, patternsAllowed: [], verifiedAllowed: false },
} as const;

/** A human label for each step, as the preview and a partial failure name it. */
export const ACTIONS_POLICY_STEP_LABEL: Readonly<Record<ActionsPolicyStep, string>> = {
  "fork-approval-for-all": "require approval for every outside contributor's fork pull request",
  "github-owned-actions-only": "allow GitHub-owned actions only, with no verified publisher and no pattern",
  "read-only-token": "make the workflow token read-only and unable to approve pull requests",
  "select-actions-policy": "restrict Actions to selected actions, keeping it off",
  "switch-off": "switch Actions off while the policy is applied",
  "switch-on": "switch Actions on",
};

/**
 * Whether only selected actions may run.
 *
 * @param allowedActions the live allowed-actions mode
 * @returns true when it is `selected`
 */
export function selectedModeCompliant({ allowedActions }: { allowedActions: string | undefined }): boolean {
  return allowedActions === ACTIONS_POLICY.allowedActions;
}

/**
 * Whether the selected actions are GitHub-owned only, with no verified publisher and no pattern.
 *
 * @param selectedActions the live selected-actions read
 * @returns true when it meets the policy; never true when it was not read
 */
export function selectedActionsCompliant({ selectedActions }: { selectedActions: SelectedActionsRead }): boolean {
  if (selectedActions.kind !== "read") {
    return false;
  }
  const { policy } = selectedActions;
  return policy.githubOwnedAllowed && !policy.verifiedAllowed && policy.patternsAllowed.length === 0;
}

/**
 * Whether the workflow token is read-only and cannot approve a pull request.
 *
 * @param workflow the live token policy
 * @returns true when it meets the policy
 */
export function workflowTokenCompliant({ workflow }: { workflow: WorkflowTokenPolicy }): boolean {
  return workflow.defaultWorkflowPermissions === "read" && !workflow.canApprovePullRequestReviews;
}

/**
 * Whether every outside contributor's fork pull request waits for approval.
 *
 * @param forkApproval the live fork approval policy
 * @returns true when it meets the policy
 */
export function forkApprovalCompliant({ forkApproval }: { forkApproval: ForkApprovalPolicy }): boolean {
  return forkApproval === ACTIONS_POLICY.forkApproval;
}

/**
 * The fact about the repository itself that refuses the policy, read before any Actions setting is: an
 * organisation's repository, whose runner groups a repository read cannot see, and one that is not public, whose
 * fork pull request approval setting is not the one this policy names.
 *
 * @param repository the repository as read
 * @returns the refusal, or undefined when the policy's settings apply to it
 */
export function actionsRepositoryRefusal({
  repository,
}: {
  repository: RepoLifecycleState;
}): GithubFactRefusedError | undefined {
  const { fullName, ownerType, visibility } = repository;
  if (ownerType !== "User") {
    return GithubVerbErrors.repoActionsRunnerScopeUnproven({ fullName, ownerType });
  }
  if (visibility !== "public") {
    return GithubVerbErrors.repoActionsNotPublic({ fullName, visibility });
  }
  return undefined;
}

/**
 * The fact that refuses the policy before anything is sent, if one does.
 *
 * @param state the live state
 * @returns the refusal, or undefined when the policy can be established here
 */
export function actionsPolicyRefusal({ state }: { state: ActionsPolicyState }): GithubFactRefusedError | undefined {
  const repositoryRefusal = actionsRepositoryRefusal({ repository: state.repository });
  if (repositoryRefusal !== undefined) {
    return repositoryRefusal;
  }
  const { fullName } = state.repository;
  if (state.selfHostedRunners !== 0) {
    return GithubVerbErrors.repoActionsSelfHostedRunner({ count: state.selfHostedRunners, fullName, landed: [] });
  }
  return undefined;
}

/**
 * The ordered steps from the live state to the policy; empty when it already holds.
 *
 * @param state the live state
 * @returns the steps to send, in order
 */
export function actionsPolicySteps({ state }: { state: ActionsPolicyState }): readonly ActionsPolicyStep[] {
  const modeOk = selectedModeCompliant({ allowedActions: state.allowedActions });
  const selectedOk = selectedActionsCompliant({ selectedActions: state.selectedActions });
  const tokenOk = workflowTokenCompliant({ workflow: state.workflow });
  const forkOk = forkApprovalCompliant({ forkApproval: state.forkApproval });
  if (state.enabled && modeOk && selectedOk && tokenOk && forkOk) {
    return [];
  }
  const steps: ActionsPolicyStep[] = [];
  if (state.enabled) {
    steps.push("switch-off");
  }
  if (!modeOk) {
    steps.push("select-actions-policy");
  }
  if (!selectedOk) {
    steps.push("github-owned-actions-only");
  }
  if (!tokenOk) {
    steps.push("read-only-token");
  }
  if (!forkOk) {
    steps.push("fork-approval-for-all");
  }
  steps.push("switch-on");
  return steps;
}

/**
 * The fields the digest binds and a `--json` preview prints: every live field a step may overwrite or depends on,
 * the policy, and the steps.
 *
 * @param state the live state
 * @param source the address typed
 * @returns a plain, stably stringifiable view
 */
export function actionsPolicyView({
  state,
  source,
}: {
  state: ActionsPolicyState;
  source: string;
}): Readonly<Record<string, unknown>> {
  return {
    action: "enable-actions",
    current: {
      allowedActions: unsetFieldAsNull({ key: "allowedActions", record: state }),
      enabled: state.enabled,
      forkApproval: state.forkApproval,
      fullName: state.repository.fullName,
      id: state.repository.id,
      ownerType: state.repository.ownerType,
      selectedActions: state.selectedActions,
      selfHostedRunners: state.selfHostedRunners,
      visibility: state.repository.visibility,
      workflow: {
        canApprovePullRequestReviews: state.workflow.canApprovePullRequestReviews,
        defaultWorkflowPermissions: state.workflow.defaultWorkflowPermissions,
      },
    },
    policy: ACTIONS_POLICY,
    source,
    steps: actionsPolicySteps({ state }),
  };
}
