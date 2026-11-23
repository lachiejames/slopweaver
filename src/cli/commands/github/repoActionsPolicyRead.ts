/**
 * The read half of `github repo --enable-actions`: the policy's whole live state, the selected-actions read that
 * applies only in selected mode, and which properties a read shows out of policy. The preview reads through it, and
 * so does the send loop in `./repoActionsPolicyRun.ts`, before switching Actions on and after the last step.
 */

import type { IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubRepoActionsPolicyApi } from "../../../outbound/github/repoActionsPolicy.js";
import type { GithubVerbResult } from "./errors.js";
import {
  type ActionsPolicyState,
  actionsRepositoryRefusal,
  forkApprovalCompliant,
  type SelectedActionsRead,
  selectedActionsCompliant,
  selectedModeCompliant,
  workflowTokenCompliant,
} from "./repoActionsPolicyPlan.js";
import { upstreamRefusedOf } from "./repoApprovedWrite.js";

/** One repository address. */
interface Address {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Read the selected-actions policy, but only in `selected` mode: in any other mode GitHub's read does not apply.
 *
 * @param api the Actions policy client
 * @param address the repository to read
 * @param allowedActions the allowed-actions mode the Actions switch read just reported
 * @returns the policy, the fact that it does not apply yet, or the read's own failure
 */
export async function readSelectedActions({
  api,
  address,
  allowedActions,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  allowedActions: string | undefined;
}): Promise<Result<SelectedActionsRead, IngestError>> {
  if (!selectedModeCompliant({ allowedActions })) {
    return ok({ kind: "unavailable-until-selected" });
  }
  const read = await api.selectedActions(address);
  return read.isOk() ? ok({ kind: "read", policy: read.value }) : err(read.error);
}

/**
 * Read every input the policy is judged against. The repository is read first and refused before any Actions
 * setting is: a private repository's fork approval read answers 422, so it is never asked.
 *
 * @param api the Actions policy client
 * @param address the repository to read
 * @returns the live state, or the first read's failure
 */
export async function readActionsPolicyState({
  api,
  address,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
}): Promise<GithubVerbResult<ActionsPolicyState>> {
  const where = `${address.owner}/${address.repo}`;
  const repository = await api.repository(address);
  if (repository.isErr()) {
    return err(upstreamRefusedOf({ error: repository.error, operation: `read ${where}` }));
  }
  const repositoryRefusal = actionsRepositoryRefusal({ repository: repository.value });
  if (repositoryRefusal !== undefined) {
    return err(repositoryRefusal);
  }
  const actions = await api.actions(address);
  if (actions.isErr()) {
    return err(upstreamRefusedOf({ error: actions.error, operation: `read ${where}'s Actions switch` }));
  }
  const selectedActions = await readSelectedActions({ address, allowedActions: actions.value.allowedActions, api });
  if (selectedActions.isErr()) {
    return err(upstreamRefusedOf({ error: selectedActions.error, operation: `read ${where}'s selected actions` }));
  }
  const workflow = await api.workflowToken(address);
  if (workflow.isErr()) {
    return err(upstreamRefusedOf({ error: workflow.error, operation: `read ${where}'s workflow token policy` }));
  }
  const forkApproval = await api.forkApproval(address);
  if (forkApproval.isErr()) {
    return err(upstreamRefusedOf({ error: forkApproval.error, operation: `read ${where}'s fork approval policy` }));
  }
  const runners = await api.selfHostedRunners(address);
  if (runners.isErr()) {
    return err(upstreamRefusedOf({ error: runners.error, operation: `count ${where}'s self-hosted runners` }));
  }
  return ok({
    allowedActions: actions.value.allowedActions,
    enabled: actions.value.enabled,
    forkApproval: forkApproval.value,
    repository: repository.value,
    selectedActions: selectedActions.value,
    selfHostedRunners: runners.value,
    workflow: workflow.value,
  });
}

/**
 * Each policy property, other than the switch itself, that a read shows out of policy.
 *
 * @param state the policy as just read
 * @returns the property names, empty when all hold
 */
export function policyDrift({ state }: { state: ActionsPolicyState }): string[] {
  const drifted: string[] = [];
  if (!selectedModeCompliant({ allowedActions: state.allowedActions })) {
    drifted.push("the allowed-actions mode");
  }
  if (!selectedActionsCompliant({ selectedActions: state.selectedActions })) {
    drifted.push("the selected-actions policy");
  }
  if (state.selfHostedRunners !== 0) {
    drifted.push("the self-hosted runner count");
  }
  if (!workflowTokenCompliant({ workflow: state.workflow })) {
    drifted.push("the workflow token");
  }
  if (!forkApprovalCompliant({ forkApproval: state.forkApproval })) {
    drifted.push("fork pull request approval");
  }
  return drifted;
}
