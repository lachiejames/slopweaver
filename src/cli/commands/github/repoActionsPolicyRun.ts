/**
 * `github repo --enable-actions`: read the policy's live state (`./repoActionsPolicyRead.ts`), and build the write
 * that applies its ordered steps (`./repoActionsPolicyPlan.ts`) one at a time, each confirmed by its own read
 * before the next is sent.
 *
 * No policy setting is rolled back. Undoing a step that landed would be a second write nobody approved, and the order
 * already makes the failure safe: Actions is switched off first and on last, the whole policy is re-read just before
 * the switch, and a final read-back that does not hold switches Actions back off once — Actions on under anything
 * but the stated policy was never approved. A step whose send errors is read back once — GitHub may have applied
 * it anyway — and the run continues only when that read shows it landed. A failure reports which steps were
 * confirmed and whether Actions is on, and the next act is a fresh preview, never the old digest.
 */

import { formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubRepoActionsPolicyApi } from "../../../outbound/github/repoActionsPolicy.js";
import { type GithubVerbError, GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import {
  ACTIONS_POLICY_STEP_LABEL,
  type ActionsPolicyState,
  type ActionsPolicyStep,
  actionsPolicyRefusal,
  actionsPolicySteps,
  actionsPolicyView,
  forkApprovalCompliant,
  selectedActionsCompliant,
  selectedModeCompliant,
  workflowTokenCompliant,
} from "./repoActionsPolicyPlan.js";
import { policyDrift, readActionsPolicyState, readSelectedActions } from "./repoActionsPolicyRead.js";
import type { ApprovedRepoWrite, ApprovedWriteOutcome } from "./repoApprovedWrite.js";

/** One repository address. */
interface Address {
  readonly owner: string;
  readonly repo: string;
}

/** Send one step once. */
async function sendStep({
  api,
  address,
  step,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  step: ActionsPolicyStep;
}): Promise<Result<void, IngestError>> {
  switch (step) {
    case "switch-off":
      return api.setActionsEnabled({ ...address, enabled: false });
    case "select-actions-policy":
      return api.setActionsEnabled({ ...address, allowedActions: "selected", enabled: false });
    case "github-owned-actions-only":
      return api.setGithubOwnedActionsOnly(address);
    case "read-only-token":
      return api.setReadOnlyWorkflowToken(address);
    case "fork-approval-for-all":
      return api.setForkApprovalForAllOutsiders(address);
    case "switch-on":
      return api.setActionsEnabled({ ...address, allowedActions: "selected", enabled: true });
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/**
 * A step's read-back: whether its setting now holds, and the Actions switch when the read showed it (a step
 * that does not read the switch leaves it unknown here), or the read's own failure.
 */
type StepRead =
  { readonly holds: boolean; readonly switchOn: boolean | undefined } | { readonly readError: IngestError };

/** The switch steps: each is read back through the Actions switch read, whose answer also says whether it is on. */
const SWITCH_STEPS: ReadonlySet<ActionsPolicyStep> = new Set(["switch-off", "select-actions-policy", "switch-on"]);

/** A read-back of a setting that does not read the switch: whether it holds, or the read's failure. */
function settingRead<T>({ read, holds }: { read: Result<T, IngestError>; holds: (value: T) => boolean }): StepRead {
  return read.isOk() ? { holds: holds(read.value), switchOn: undefined } : { readError: read.error };
}

/** Read back GitHub-owned-actions-only: the mode first, every time, since the selected-actions read needs it. */
async function ownedActionsLanded({
  api,
  address,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
}): Promise<StepRead> {
  const mode = await api.actions(address);
  if (mode.isErr()) {
    return { readError: mode.error };
  }
  const read = await readSelectedActions({ address, allowedActions: mode.value.allowedActions, api });
  return read.isOk()
    ? { holds: selectedActionsCompliant({ selectedActions: read.value }), switchOn: mode.value.enabled }
    : { readError: read.error };
}

/** Read back a switch step through the Actions switch read, which also says whether Actions is on. */
async function switchLanded({
  api,
  address,
  step,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  step: ActionsPolicyStep;
}): Promise<StepRead> {
  const read = await api.actions(address);
  if (read.isErr()) {
    return { readError: read.error };
  }
  const { enabled, allowedActions } = read.value;
  const selected = selectedModeCompliant({ allowedActions });
  const holdsByStep: Readonly<Record<string, boolean>> = {
    "select-actions-policy": selected && !enabled,
    "switch-off": !enabled,
    "switch-on": selected && enabled,
  };
  return { holds: holdsByStep[step] === true, switchOn: enabled };
}

/** Read back whether one step's setting now holds. */
async function stepLanded({
  api,
  address,
  step,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  step: ActionsPolicyStep;
}): Promise<StepRead> {
  switch (step) {
    case "read-only-token":
      return settingRead({
        holds: (workflow) => workflowTokenCompliant({ workflow }),
        read: await api.workflowToken(address),
      });
    case "fork-approval-for-all":
      return settingRead({
        holds: (forkApproval) => forkApprovalCompliant({ forkApproval }),
        read: await api.forkApproval(address),
      });
    case "github-owned-actions-only":
      return ownedActionsLanded({ address, api });
    case "select-actions-policy":
    case "switch-off":
    case "switch-on":
      return switchLanded({ address, api, step });
  }
}

/** What a step run reports back to the loop: whether it landed, what that says about the switch, and why not. */
interface StepResult {
  readonly landed: boolean;
  /** Whether Actions is on after this step, as far as its read showed; undefined when that is unknown. */
  readonly actionsOn: boolean | undefined;
  /** GitHub's own words for a send or read-back that failed, each naming its operation and status. */
  readonly causes: readonly string[];
}

/** Send one step and read it back, treating a send error as landed only when the read shows it did. */
async function runStep({
  api,
  address,
  step,
  actionsOn,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  step: ActionsPolicyStep;
  actionsOn: boolean | undefined;
}): Promise<StepResult> {
  const sent = await sendStep({ address, api, step });
  const read = await stepLanded({ address, api, step });
  const causes: string[] = [];
  if (sent.isErr()) {
    causes.push(`send: ${formatIngestError({ error: sent.error })}`);
  }
  if ("readError" in read) {
    causes.push(`read-back: ${formatIngestError({ error: read.readError })}`);
  }
  if ("readError" in read) {
    // A switch step whose read failed leaves the switch unknown; any other step never touched it.
    return { actionsOn: SWITCH_STEPS.has(step) ? undefined : actionsOn, causes, landed: false };
  }
  if (read.switchOn === undefined) {
    return { actionsOn, causes, landed: read.holds };
  }
  // A switch step's read answered with the switch itself, so its position is known exactly.
  return { actionsOn: read.switchOn, causes, landed: read.holds };
}

/**
 * Re-read the whole policy just before switching Actions on: the refusal when it cannot be read, a self-hosted
 * runner appeared, or a confirmed property drifted since; undefined when the switch may be sent.
 */
async function switchOnRefusal({
  api,
  address,
  actionsOn,
  fullName,
  landed,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  actionsOn: boolean | undefined;
  fullName: string;
  landed: readonly string[];
}): Promise<GithubVerbError | undefined> {
  const before = await readActionsPolicyState({ address, api });
  const failedStep = "re-read the whole policy before switching Actions on";
  if (before.isErr()) {
    const causes = [`read: ${before.error.message}`];
    return GithubVerbErrors.repoActionsIncomplete({ actionsOn, causes, failedStep, fullName, landed });
  }
  if (before.value.selfHostedRunners !== 0) {
    return GithubVerbErrors.repoActionsSelfHostedRunner({ count: before.value.selfHostedRunners, fullName, landed });
  }
  const drifted = policyDrift({ state: before.value });
  if (drifted.length > 0) {
    const causes = [`changed since its own step was confirmed: ${drifted.join(", ")}`];
    return GithubVerbErrors.repoActionsIncomplete({ actionsOn, causes, failedStep, fullName, landed });
  }
  return undefined;
}

/** Apply every step in order, confirming each, and re-count runners before switching Actions on. */
async function applySteps({
  api,
  address,
  state,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  state: ActionsPolicyState;
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const { fullName } = state.repository;
  const landed: string[] = [];
  let actionsOn: boolean | undefined = state.enabled;
  for (const step of actionsPolicySteps({ state })) {
    if (step === "switch-on") {
      const refusal = await switchOnRefusal({ actionsOn, address, api, fullName, landed });
      if (refusal !== undefined) {
        return err(refusal);
      }
    }
    const result = await runStep({ actionsOn, address, api, step });
    actionsOn = result.actionsOn;
    if (!result.landed) {
      const failedStep = ACTIONS_POLICY_STEP_LABEL[step];
      const { causes } = result;
      return err(GithubVerbErrors.repoActionsIncomplete({ actionsOn, causes, failedStep, fullName, landed }));
    }
    landed.push(ACTIONS_POLICY_STEP_LABEL[step]);
  }
  return confirmWhole({ address, api, fullName, landed });
}

/**
 * Switch Actions back off after a final read-back that did not hold, once. Actions on under anything but the stated
 * policy was never approved, so this returns the switch to where the approval found it rather than undoing a
 * setting the owner asked for.
 */
async function failClosed({
  api,
  address,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
}): Promise<{ readonly actionsOn: boolean | undefined; readonly causes: readonly string[] }> {
  const off = await runStep({ actionsOn: undefined, address, api, step: "switch-off" });
  const outcome = off.landed ? "switched Actions back off" : "could not confirm Actions switched back off";
  return { actionsOn: off.actionsOn, causes: [outcome, ...off.causes] };
}

/** The final read-back: every property of the policy at once, after the last step. */
async function confirmWhole({
  api,
  address,
  fullName,
  landed,
}: {
  api: GithubRepoActionsPolicyApi;
  address: Address;
  fullName: string;
  landed: readonly string[];
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const after = await readActionsPolicyState({ address, api });
  const drifted = after.isOk() ? policyDrift({ state: after.value }) : [];
  const holds = after.isOk() && after.value.enabled && drifted.length === 0;
  if (!holds) {
    const read: string[] = [];
    if (after.isErr()) {
      read.push(after.error.message);
    } else if (drifted.length > 0) {
      read.push(`out of policy: ${drifted.join(", ")}`);
    } else {
      read.push("Actions read back off");
    }
    const stillOff = after.isOk() && !after.value.enabled;
    const closed = stillOff ? { actionsOn: false, causes: [] } : await failClosed({ address, api });
    const failedStep = "final read-back";
    const causes = [...read, ...closed.causes];
    return err(
      GithubVerbErrors.repoActionsIncomplete({ actionsOn: closed.actionsOn, causes, failedStep, fullName, landed }),
    );
  }
  return ok({ fields: { steps: landed }, line: `Actions is on for ${fullName} under the stated policy` });
}

/**
 * Read the policy's live state and build the previewed write, or the fact that refuses it.
 *
 * @param api the Actions policy client
 * @param owner the owner login typed
 * @param repo the repository name typed
 * @returns the write the shared shell previews or sends, or the refusal
 */
export async function planRepoEnableActions({
  api,
  owner,
  repo,
}: {
  api: GithubRepoActionsPolicyApi;
  owner: string;
  repo: string;
}): Promise<GithubVerbResult<ApprovedRepoWrite>> {
  const address = { owner, repo };
  const read = await readActionsPolicyState({ address, api });
  if (read.isErr()) {
    return err(read.error);
  }
  const state = read.value;
  const refusal = actionsPolicyRefusal({ state });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const steps = actionsPolicySteps({ state });
  return ok({
    alreadyDone: steps.length === 0,
    change: `enable Actions on ${state.repository.fullName} (id ${String(state.repository.id)}) under the stated policy: ${steps.map((step) => ACTIONS_POLICY_STEP_LABEL[step]).join("; ")}`,
    consequences: [
      "every push and pull request runs the repository's workflows on GitHub-hosted runners, spending runner minutes",
    ],
    kind: "enable-actions",
    perform: () => applySteps({ address, api, state }),
    previewCommand: `slopweaver github repo --repo ${owner}/${repo} --enable-actions`,
    view: actionsPolicyView({ source: `${owner}/${repo}`, state }),
    waiting: [],
  });
}
