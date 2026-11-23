/**
 * Turning workflow definitions and their runs into `workflow` and `workflow-run` entities.
 *
 * ## A run's steps are joined to the definition VERSION it ran
 *
 * A run's detail names each step by the definition's own activity id, and a workflow is edited between runs:
 * MEASURED, a live offboarding workflow's runs span more than one of its definition versions, and the step that
 * sets a leaver's Google Workspace licence to none exists only in the latest few. So a run's step names come from
 * `GET /FlowApi/Flow/{id}/{version}` for that run's own version, never from the workflow's current steps — a
 * join against the current definition would name a step a run never had.
 *
 * Pure. The detail is optional per run: a run whose detail could not be read this time still projects, with
 * `steps: null`, so the run list stays complete and the shortfall is a counted gap rather than a missing row.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import type {
  TrelicaRunStep,
  TrelicaWorkflowDetail,
  TrelicaWorkflowRunDetail,
  TrelicaWorkflowStep,
} from "./entityModel.js";
import { trelicaNamedPerson } from "./entityProjection.js";
import { heldTrelicaProviderText, heldTrelicaState } from "./providerText.js";
import { trelicaStepSettings } from "./stepSettings.js";
import type {
  TrelicaRunDetailRecord,
  TrelicaWorkflowRecord,
  TrelicaWorkflowRunRecord,
  TrelicaWorkflowVersionRecord,
} from "./workflowBoundaries.js";

/** The fields a step is named from, shared by a definition's steps and a version's. */
interface NameableStep {
  readonly activityType: string;
  readonly customName?: string | undefined;
  readonly name?: string | undefined;
}

/**
 * A step's name as the workflow editor shows it: its custom name when it has one, else the activity's own
 * name, else the activity type, which every step carries.
 */
function trelicaStepName({ step }: { step: NameableStep }): string {
  if (step.customName !== undefined && step.customName.trim().length > 0) {
    return step.customName.trim();
  }
  if (step.name !== undefined && step.name.trim().length > 0) {
    return step.name.trim();
  }
  return step.activityType;
}

/**
 * Every step id in one definition version, mapped to its name.
 *
 * @param version the version as `GET /FlowApi/Flow/{id}/{version}` answered it
 * @returns the step names by activity id
 */
export function trelicaVersionStepNames({
  version,
}: {
  version: TrelicaWorkflowVersionRecord;
}): ReadonlyMap<string, string> {
  return new Map(version.activities.map((step) => [step.id, trelicaStepName({ step })]));
}

/**
 * The label an id carries, or `null` when there is no id or nothing labels it — absent by design: a workflow with
 * no tag, and the trigger, which no definition version names.
 */
function labelOf({ id, labels }: { id: string | undefined; labels: ReadonlyMap<string, string> }): string | null {
  if (id === undefined) {
    return null;
  }
  const label = labels.get(id);
  if (label === undefined) {
    return null;
  }
  return label;
}

/**
 * One workflow's closed detail.
 *
 * @param record the boundary's workflow
 * @param tags every workflow tag's label, by id
 * @returns the detail held for it
 */
export function trelicaWorkflowDetail({
  record,
  tags,
}: {
  record: TrelicaWorkflowRecord;
  tags: ReadonlyMap<string, string>;
}): TrelicaWorkflowDetail {
  const steps = record.activities.map((step): TrelicaWorkflowStep => ({
    action: unsetFieldAsNull({ key: "actionType", record: step }),
    activityType: step.activityType,
    category: step.activityCategory,
    continueOnError: step.continueOnError,
    id: step.id,
    name: trelicaStepName({ step }),
    provider: unsetFieldAsNull({ key: "providerName", record: step }),
    removeAllGroups: unsetFieldAsNull({ key: "removeAllGroups", record: step }),
    settings: trelicaStepSettings({ step }),
  }));
  return {
    archived: record.archived,
    createdAt: record.createdDtm,
    description: unsetFieldAsNull({ key: "description", record }),
    enabled: record.enabled,
    flowType: record.flowType,
    lastModifiedAt: record.lastModifiedDtm,
    latestPublishedVersion: record.latestPublishedVersion,
    name: record.name,
    owners: record.owners === undefined ? [] : record.owners.map((person) => trelicaNamedPerson({ person })),
    runCounts: {
      active: record.activeItemCount,
      completed: record.completedItemCount,
      completedWithErrors: record.completedWithErrorsItemCount,
      failed: record.failedItemCount,
      needsInput: record.needsInputItemCount,
      terminated: record.terminatedItemCount,
      total: record.itemCount,
      waitingForUser: record.waitingForUserItemCount,
    },
    steps,
    tag: labelOf({ id: record.workflowTagId, labels: tags }),
    trigger: {
      activityType: record.trigger.activityType,
      leavingDateDaysOffset: unsetFieldAsNull({ key: "leavingDateDaysOffset", record: record.trigger }),
      name: record.trigger.name,
      personTypes: record.trigger.personTypes === undefined ? [] : [...record.trigger.personTypes].toSorted(),
      requireApproval: unsetFieldAsNull({ key: "requireApproval", record: record.trigger }),
    },
    version: record.id.version,
  };
}

/**
 * Every step outcome one run's detail records, named from its own definition version.
 *
 * @param detail the run's detail
 * @param stepNames that run's version's step names; a step missing from it is the trigger, which has no name
 * @returns one outcome per step state, in the order the platform recorded them
 */
export function trelicaRunSteps({
  detail,
  stepNames,
}: {
  detail: TrelicaRunDetailRecord;
  stepNames: ReadonlyMap<string, string>;
}): readonly TrelicaRunStep[] {
  return detail.states.map((state): TrelicaRunStep => {
    return {
      failureCount: state.failureCount,
      failureMessage: heldTrelicaProviderText({
        text: unsetFieldAsNull({ key: "failureMessage", record: state.result }),
      }),
      name: labelOf({ id: state.activityId, labels: stepNames }),
      resultAt: state.result === undefined ? null : state.result.resultDtm,
      status: heldTrelicaState({ state: state.status }),
      stepId: state.activityId,
    };
  });
}

/**
 * One run's closed detail.
 *
 * @param record the run as the run list answered it
 * @param steps its step outcomes, or `null` when its detail was not read this time
 * @returns the detail held for it
 */
export function trelicaWorkflowRunDetail({
  record,
  steps,
}: {
  record: TrelicaWorkflowRunRecord;
  steps: readonly TrelicaRunStep[] | null;
}): TrelicaWorkflowRunDetail {
  const { app, person } = record.baseScope;
  return {
    app: app === undefined ? null : { id: app.id, name: app.name },
    blockedReason: heldTrelicaProviderText({ text: unsetFieldAsNull({ key: "blockedReason", record }) }),
    completedAt: unsetFieldAsNull({ key: "completedDtm", record }),
    createdAt: record.createdDtm,
    currentStep: record.currentStateName,
    errorCount: record.errorCount,
    failedAndContinuedCount: record.failedAndContinuedCount,
    firedErrors: record.firedErrors.map((fired) => ({
      at: fired.firedAt,
      message: heldTrelicaProviderText({ text: fired.message }),
    })),
    label: unsetFieldAsNull({ key: "itemName", record }),
    lastModifiedAt: record.lastModifiedDtm,
    manuallyTriggered: record.manuallyTriggered,
    person:
      person === undefined
        ? null
        : {
            email: person.email,
            id: person.id,
            leavingDate: unsetFieldAsNull({ key: "leavingDate", record: person }),
            name: person.name,
          },
    startedBy: record.createdByUser.name,
    status: heldTrelicaState({ state: record.status }),
    steps,
    terminatedAt: unsetFieldAsNull({ key: "terminatedDtm", record }),
    terminatedBy: record.terminatedByUser === undefined ? null : record.terminatedByUser.name,
    uiStatus: heldTrelicaState({ state: record.uiStatus }),
    version: record.flowVersion,
    workflowId: record.flowId,
    workflowName: record.flowName,
  };
}
