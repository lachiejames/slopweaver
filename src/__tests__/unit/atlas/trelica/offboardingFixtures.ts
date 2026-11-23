/**
 * Synthetic held people, workflows and runs for the offboarding evidence tests. Every value is invented; the
 * shapes are `heldDetails.ts`'s, which is what the evidence reads.
 */
import type { HeldTrelicaPerson, HeldTrelicaRun, HeldTrelicaWorkflow } from "../../../../atlas/trelica/heldDetails.js";

/** One account a held person carries. */
type HeldAccount = HeldTrelicaPerson["accounts"][number];

/** One step outcome a held run carries. */
type HeldRunStep = NonNullable<HeldTrelicaRun["steps"]>[number];

/**
 * An Identity account at the given source.
 *
 * @returns the account
 */
export function identityAccount({
  source = "Google Workspace",
  suspended,
  deleted,
}: {
  source?: string;
  suspended: boolean | null;
  deleted: boolean | null;
}): HeldAccount {
  return { deleted, organizationalUnit: null, providerType: "Identity", source, suspended };
}

/**
 * A held person; a Terminated leaver with no dates and no accounts unless told otherwise.
 *
 * @returns the person
 */
export function person({
  id,
  name,
  status = "Terminated",
  leaver = false,
  leavingDate = null,
  removedDate = null,
  accounts = [],
}: {
  id: string;
  name: string;
  status?: string;
  leaver?: boolean;
  leavingDate?: string | null;
  removedDate?: string | null;
  accounts?: readonly HeldAccount[];
}): HeldTrelicaPerson {
  return {
    accounts: [...accounts],
    email: `${id}@example.test`,
    id,
    leaver,
    leavingDate,
    name,
    removedDate,
    status,
  };
}

/** One configured step a held workflow carries. */
type HeldConfiguredStep = HeldTrelicaWorkflow["steps"][number];

/** The step id a fixture gives a step of this name, unless told otherwise. */
function stepIdFor({ name }: { name: string | null }): string {
  return name === null ? "s-trigger" : `s-${name}`;
}

/** The settings of a step that carries none. */
export const NO_STEP_SETTINGS: HeldConfiguredStep["settings"] = {
  channel: null,
  delayType: null,
  delayUnit: null,
  dueDateOffset: null,
  forceGroupRemoval: null,
  licence: null,
  licencesToAdd: null,
  licencesToRemove: null,
  notifyUser: null,
  pipeline: null,
  recipientTypes: null,
  recipients: null,
  requestApproval: null,
  skipIfNoAccount: null,
  timeoutHours: null,
  timeoutMinutes: null,
  timeoutWorkingDays: null,
  transitionImmediately: null,
};

/**
 * A configured step, a Google Workspace one keyed by its name with no settings unless told otherwise.
 *
 * @returns the step
 */
export function configuredStep({
  name,
  id = stepIdFor({ name }),
  activityType = "SuspendUser",
  settings = {},
}: {
  name: string;
  id?: string;
  activityType?: string;
  settings?: Partial<HeldConfiguredStep["settings"]>;
}): HeldConfiguredStep {
  return {
    action: null,
    activityType,
    continueOnError: false,
    id,
    name,
    provider: "Google Workspace",
    removeAllGroups: null,
    settings: { ...NO_STEP_SETTINGS, ...settings },
  };
}

/**
 * A held workflow with two steps; an enabled offboarding one fired by a leaver unless told otherwise.
 *
 * @returns the workflow
 */
export function workflow({
  id,
  name,
  flowType = "Offboarding",
  trigger = "PersonLeavesTrigger",
  enabled = true,
  personTypes = ["Employee"],
  requireApproval = false,
  steps = [
    { ...configuredStep({ name: "Suspend user" }), action: "Suspend", continueOnError: true },
    { ...configuredStep({ activityType: "RemoveFromGroups", name: "Remove from groups" }), removeAllGroups: true },
  ],
}: {
  id: string;
  name: string;
  flowType?: string;
  trigger?: string;
  enabled?: boolean;
  personTypes?: readonly string[];
  requireApproval?: boolean | null;
  steps?: readonly HeldConfiguredStep[];
}): HeldTrelicaWorkflow {
  return {
    archived: false,
    enabled,
    flowType,
    id,
    latestPublishedVersion: 3,
    name,
    steps: [...steps],
    trigger: {
      activityType: trigger,
      leavingDateDaysOffset: 0,
      name: "Person leaves",
      personTypes: [...personTypes],
      requireApproval,
    },
  };
}

/**
 * One step outcome, keyed by the id a fixture gives its name unless told otherwise.
 *
 * @returns the step
 */
export function step({
  name,
  status,
  failureMessage = null,
  stepId = stepIdFor({ name }),
}: {
  name: string | null;
  status: string;
  failureMessage?: string | null;
  stepId?: string;
}): HeldRunStep {
  return { failureCount: status === "Failed" ? 1 : 0, failureMessage, name, status, stepId };
}

/**
 * A held run; a clean completed run of two completed steps unless told otherwise.
 *
 * @returns the run
 */
export function run({
  id,
  workflowId,
  personId,
  createdAt,
  uiStatus = "Completed",
  status = "Completed",
  steps = [
    step({ name: "Suspend user", status: "Completed" }),
    step({ name: "Remove from groups", status: "Completed" }),
  ],
}: {
  id: string;
  workflowId: string;
  personId: string | null;
  createdAt: string;
  uiStatus?: string;
  status?: string;
  steps?: readonly HeldRunStep[] | null;
}): HeldTrelicaRun {
  return {
    createdAt,
    currentStep: "End",
    id,
    manuallyTriggered: false,
    person:
      personId === null ? null : { email: `${personId}@example.test`, id: personId, name: `Run named ${personId}` },
    startedBy: "Trelica",
    status,
    steps: steps === null ? null : [...steps],
    terminatedBy: null,
    uiStatus,
    version: 3,
    workflowId,
  };
}
