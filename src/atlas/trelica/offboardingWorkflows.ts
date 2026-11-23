/**
 * Each offboarding workflow's configured behaviour beside what its runs actually did: how many ran, the last one,
 * the outcome tally, and per configured step — keyed by its id, never its name — how often each outcome was
 * recorded with the commonest failure message, then the steps only an older version had.
 *
 * Pure over the held entities `heldDetails.ts` reads. A workflow is an offboarding one when the platform classes it
 * so (`flowType`) or it fires on a person leaving (`PersonLeavesTrigger`) — both fields the record carries, never a
 * guess from its name.
 */
import type { HeldTrelicaRun, HeldTrelicaWorkflow } from "./heldDetails.js";
import { type TrelicaStepSettings, trelicaStepSettingPhrases } from "./stepSettings.js";

/** The trigger that fires a workflow when a person leaves. */
const TRELICA_LEAVER_TRIGGER = "PersonLeavesTrigger";

/** A value and how many times it was seen. */
export interface TrelicaTally {
  readonly value: string;
  readonly count: number;
}

/**
 * Every outcome the held runs recorded under one step id, across every version that carried it.
 * @internal
 */
export interface TrelicaStepRecord {
  readonly outcomes: readonly TrelicaTally[];
  /** The commonest failure message, or `null` when no run of this step recorded one. */
  readonly commonestFailure: TrelicaTally | null;
}

/**
 * A step the runs recorded that the current version no longer configures, named as its newest run named it.
 * @internal
 */
export interface TrelicaRetiredStep {
  readonly stepId: string;
  readonly name: string;
  readonly recorded: TrelicaStepRecord;
}

/** One offboarding workflow: what it is set to do, and what its runs did. */
export interface TrelicaOffboardingWorkflowEvidence {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly archived: boolean;
  readonly flowType: string;
  readonly trigger: {
    readonly name: string;
    readonly leavingDateDaysOffset: number | null;
    /** The person types it fires for, sorted; empty when the trigger names none. */
    readonly personTypes: readonly string[];
    /** Whether a run waits for an approval before it starts, for a trigger that carries the setting. */
    readonly requireApproval: boolean | null;
  };
  /** The version whose steps {@link steps} lists. */
  readonly latestPublishedVersion: number;
  /**
   * The latest published version's configured steps in their configured order, a repeated name kept as its own step,
   * each with what the runs recorded under its id.
   */
  readonly steps: readonly {
    readonly id: string;
    readonly name: string;
    readonly activityType: string;
    readonly provider: string | null;
    readonly action: string | null;
    readonly removeAllGroups: boolean | null;
    readonly continueOnError: boolean;
    readonly settings: TrelicaStepSettings;
    /** Its {@link action}, {@link removeAllGroups} and {@link settings} in words, one phrase per one it carries. */
    readonly configured: readonly string[];
    readonly recorded: TrelicaStepRecord;
  }[];
  /** Steps an older version configured and the runs recorded, which the current version no longer has. */
  readonly retiredSteps: readonly TrelicaRetiredStep[];
  readonly runs: number;
  readonly lastRun: {
    readonly id: string;
    readonly createdAt: string;
    readonly uiStatus: string;
    readonly person: string | null;
  } | null;
  readonly outcomes: readonly TrelicaTally[];
  /** Distinct people its runs were about. */
  readonly peopleTouched: number;
  /** Runs whose per-step states this generation does not hold. */
  readonly runsWithoutSteps: number;
}

/**
 * Whether a held workflow is an offboarding one.
 *
 * @returns `true` when the platform classes it as offboarding or it fires on a person leaving
 */
export function isTrelicaOffboardingWorkflow({ workflow }: { workflow: HeldTrelicaWorkflow }): boolean {
  return workflow.flowType === "Offboarding" || workflow.trigger.activityType === TRELICA_LEAVER_TRIGGER;
}

/** Count each value, most frequent first, ties by value. */
function tallyOf({ values }: { values: readonly string[] }): TrelicaTally[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const prior = counts.get(value);
    counts.set(value, prior === undefined ? 1 : prior + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ count, value }))
    .toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Order runs newest first: by creation instant, then by id so two runs created at one instant order the same way
 * on every read.
 *
 * @returns a new array, newest first
 */
export function newestTrelicaRunsFirst({ runs }: { runs: readonly HeldTrelicaRun[] }): HeldTrelicaRun[] {
  return runs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** What the runs said under one step id, before it is tallied. */
interface StepObservations {
  /** The name the newest run gave the step. */
  readonly name: string;
  readonly statuses: string[];
  readonly failures: string[];
}

/** A step record with nothing recorded, for a configured step no held run reached. */
const NOTHING_RECORDED: TrelicaStepRecord = { commonestFailure: null, outcomes: [] };

/**
 * Every outcome the runs recorded, keyed by step id. A step id is stable across versions — MEASURED, the
 * main offboarding workflow's runs across all its versions recorded every one of the current version's step ids
 * among a wider set of distinct ones — so one id is one step however it was renamed, and two steps sharing a name stay two.
 * Repro: `jq` over `workflow-runs.jsonl` collecting `.steps[].stepId` for one `workflowId`. The trigger, which
 * carries no name, is left out. Runs arrive newest first, so the first name seen is the newest.
 */
function stepObservationsOf({ runs }: { runs: readonly HeldTrelicaRun[] }): Map<string, StepObservations> {
  const byId = new Map<string, StepObservations>();
  for (const run of runs) {
    if (run.steps === null) {
      continue;
    }
    for (const step of run.steps) {
      observeStep({ byId, step });
    }
  }
  return byId;
}

/** Add one step outcome to what its id has recorded; the unnamed trigger is skipped. */
function observeStep({
  byId,
  step,
}: {
  byId: Map<string, StepObservations>;
  step: NonNullable<HeldTrelicaRun["steps"]>[number];
}): void {
  if (step.name === null) {
    return;
  }
  let seen = byId.get(step.stepId);
  if (seen === undefined) {
    seen = { failures: [], name: step.name, statuses: [] };
    byId.set(step.stepId, seen);
  }
  seen.statuses.push(step.status);
  if (step.failureMessage !== null) {
    seen.failures.push(step.failureMessage);
  }
}

/** One step id's observations, tallied. */
function recordOf({ seen }: { seen: StepObservations | undefined }): TrelicaStepRecord {
  if (seen === undefined) {
    return NOTHING_RECORDED;
  }
  const commonest = tallyOf({ values: seen.failures });
  return {
    commonestFailure: commonest.length === 0 ? null : commonest[0]!,
    outcomes: tallyOf({ values: seen.statuses }),
  };
}

/**
 * Everything a held step is configured to do, in words: its integration action, whether it strips every group,
 * then its settings. One list, so no renderer can show the settings and drop the rest.
 */
function configuredPhrases({ step }: { step: HeldTrelicaWorkflow["steps"][number] }): string[] {
  const phrases: string[] = [];
  if (step.action !== null) {
    phrases.push(`action ${step.action}`);
  }
  if (step.removeAllGroups !== null) {
    phrases.push(`removes from every group: ${step.removeAllGroups ? "yes" : "no"}`);
  }
  return [...phrases, ...trelicaStepSettingPhrases({ settings: step.settings })];
}

/**
 * One offboarding workflow's evidence, over every held run of it.
 *
 * @param workflow the held workflow
 * @param runs every held run, of any workflow — only this workflow's are read
 * @returns its configuration beside its run evidence
 */
export function trelicaOffboardingWorkflowEvidence({
  workflow,
  runs,
}: {
  workflow: HeldTrelicaWorkflow;
  runs: readonly HeldTrelicaRun[];
}): TrelicaOffboardingWorkflowEvidence {
  const own = newestTrelicaRunsFirst({ runs: runs.filter((run) => run.workflowId === workflow.id) });
  const last = own[0];
  const people = new Set(own.flatMap((run) => (run.person === null ? [] : [run.person.id])));
  const observed = stepObservationsOf({ runs: own });
  const configured = new Set(workflow.steps.map((step) => step.id));
  return {
    archived: workflow.archived,
    enabled: workflow.enabled,
    flowType: workflow.flowType,
    id: workflow.id,
    lastRun:
      last === undefined
        ? null
        : {
            createdAt: last.createdAt,
            id: last.id,
            person: last.person === null ? null : last.person.name,
            uiStatus: last.uiStatus,
          },
    name: workflow.name,
    outcomes: tallyOf({ values: own.map((run) => run.uiStatus) }),
    peopleTouched: people.size,
    retiredSteps: [...observed]
      .filter(([stepId]) => !configured.has(stepId))
      .map(([stepId, seen]) => ({ name: seen.name, recorded: recordOf({ seen }), stepId })),
    runs: own.length,
    runsWithoutSteps: own.filter((run) => run.steps === null).length,
    steps: workflow.steps.map((step) => ({
      action: step.action,
      activityType: step.activityType,
      configured: configuredPhrases({ step }),
      continueOnError: step.continueOnError,
      id: step.id,
      name: step.name,
      provider: step.provider,
      recorded: recordOf({ seen: observed.get(step.id) }),
      removeAllGroups: step.removeAllGroups,
      settings: step.settings,
    })),
    trigger: {
      leavingDateDaysOffset: workflow.trigger.leavingDateDaysOffset,
      name: workflow.trigger.name,
      personTypes: workflow.trigger.personTypes,
      requireApproval: workflow.trigger.requireApproval,
    },
    latestPublishedVersion: workflow.latestPublishedVersion,
  };
}
