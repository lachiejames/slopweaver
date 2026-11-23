/**
 * Everyone the held offboarding evidence needs a reader to look at, and why — the joined view `atlas trelica
 * report --offboarding` prints. Pure over the held entities `heldDetails.ts` reads; nothing here reaches Trelica.
 *
 * ## One finding per workflow, never one per person
 *
 * Each offboarding workflow is configured on its own, so a person's evidence is the LATEST run of EACH workflow
 * that touched them, plus every older run of it still open. A clean re-run of one workflow never erases a stuck
 * run of another, and a newer run never hides an older one still waiting on somebody. The person's verdict is the
 * finding most in need of a look, in `offboardingVerdicts.ts`'s order.
 *
 * ## A leaver is someone their own CURRENT record says has left
 *
 * Who counts is `offboardingStanding.ts`'s rule, read off the person's record and never off a run. A person a run
 * names whose current record does not say they have left is never counted among the leavers. They are listed apart,
 * in {@link TrelicaOffboardingReport.notLeaving}, as something to interpret rather than remediate — and so is a run
 * naming a person the held people do not include at all.
 *
 * ## A leaver with no run is named only inside the window the runs cover
 *
 * `no-observed-run` is descriptive — no evidence either way, never proof of a failure. It is claimed only for a
 * current leaver whose removal or leaving date is due as of the generation and on or after the first offboarding
 * run, or who still holds a live Identity account. One with no date is counted as eligibility unknown and one who
 * left before the first run is counted too; neither is named, because nothing held says an offboarding run was
 * owed.
 */
import type { HeldTrelicaOffboardingInput, HeldTrelicaPerson, HeldTrelicaRun } from "./heldDetails.js";
import {
  isCurrentTrelicaLeaver,
  type TrelicaLeaverStanding,
  trelicaLeaverStanding,
  trelicaUnrunCohort,
} from "./offboardingStanding.js";
import {
  isOpenTrelicaRun,
  TRELICA_ADVERSE_STEP_STATUSES,
  type TrelicaIdentityAccountState,
  type TrelicaRunVerdict,
  trelicaIdentityAccountState,
  trelicaRunVerdict,
} from "./offboardingVerdicts.js";
import {
  isTrelicaOffboardingWorkflow,
  newestTrelicaRunsFirst,
  type TrelicaOffboardingWorkflowEvidence,
  trelicaOffboardingWorkflowEvidence,
} from "./offboardingWorkflows.js";

/** What a person's evidence, taken together, needs. */
export type TrelicaPersonVerdict = TrelicaRunVerdict | "no-observed-run";

/** Every person verdict, most in need of a look first. */
export const TRELICA_PERSON_VERDICTS = [
  "run-stuck",
  "run-failed",
  "no-observed-run",
  "run-aborted",
  "run-completed-with-errors",
  "unknown",
  "run-clean",
] as const satisfies readonly TrelicaPersonVerdict[];

/** One run held as evidence about one person. */
export interface TrelicaOffboardingFinding {
  readonly workflow: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly uiStatus: string;
  readonly currentStep: string;
  readonly verdict: TrelicaRunVerdict;
  /** `true` for an older run still open behind a newer run of the same workflow. */
  readonly superseded: boolean;
  /** Each step that failed, was blocked or was skipped with an error, with the platform's scrubbed message. */
  readonly adverseSteps: readonly { readonly step: string; readonly status: string; readonly message: string | null }[];
}

/** One person the evidence names. */
export interface TrelicaOffboardingPersonEvidence {
  readonly personId: string;
  readonly name: string;
  readonly email: string | null;
  /** The person's Trelica status, or `null` when a run names someone the held people do not include. */
  readonly status: string | null;
  readonly standing: TrelicaLeaverStanding;
  readonly verdict: TrelicaPersonVerdict;
  readonly runs: number;
  readonly findings: readonly TrelicaOffboardingFinding[];
  readonly identity: TrelicaIdentityAccountState;
}

/**
 * How the inputs reconcile, every count printed even at zero.
 * @internal
 */
export interface TrelicaOffboardingReconciliation {
  readonly runsWithoutPerson: number;
  /** Runs naming a person id the held people do not include. Never re-joined on a name or an email. */
  readonly runsNamingUnknownPeople: number;
  readonly runsWithoutSteps: number;
  /** Terminated people and leavers with no run and no removal or leaving date: eligibility unknown. */
  readonly leaversWithoutDate: number;
  /** Terminated people and leavers with no run who left before the first offboarding run. */
  readonly leaversBeforeFirstRun: number;
}

/** The whole offboarding evidence view. */
export interface TrelicaOffboardingReport {
  /** The generation's own instant, which "due" is judged against. */
  readonly asOf: string;
  readonly workflows: readonly TrelicaOffboardingWorkflowEvidence[];
  /** Every current leaver the evidence names. */
  readonly people: readonly TrelicaOffboardingPersonEvidence[];
  /** People an offboarding run names whose current record does not say they have left. Never counted as leavers. */
  readonly notLeaving: readonly TrelicaOffboardingPersonEvidence[];
  /** How many current leavers carry each verdict. */
  readonly verdictCounts: Readonly<Record<TrelicaPersonVerdict, number>>;
  readonly reconciliation: TrelicaOffboardingReconciliation;
  /** Observed entities whose held detail this reader could not parse. */
  readonly unreadable: number;
}

/** Each step of a run that failed, was blocked or was skipped with an error; none when its steps are not held. */
function adverseStepsOf({ run }: { run: HeldTrelicaRun }): TrelicaOffboardingFinding["adverseSteps"] {
  if (run.steps === null) {
    return [];
  }
  return run.steps
    .filter((step) => TRELICA_ADVERSE_STEP_STATUSES.has(step.status))
    .map((step) => ({ message: step.failureMessage, status: step.status, step: stepLabel({ name: step.name }) }));
}

/** A step as a reader names it: the trigger is the one step the platform leaves unnamed. */
function stepLabel({ name }: { name: string | null }): string {
  if (name === null) {
    return "trigger";
  }
  return name;
}

/** One run as a finding. */
function findingOf({
  run,
  superseded,
  workflowNames,
}: {
  run: HeldTrelicaRun;
  superseded: boolean;
  workflowNames: ReadonlyMap<string, string>;
}): TrelicaOffboardingFinding {
  return {
    adverseSteps: adverseStepsOf({ run }),
    createdAt: run.createdAt,
    currentStep: run.currentStep,
    runId: run.id,
    superseded,
    uiStatus: run.uiStatus,
    verdict: trelicaRunVerdict({ run }),
    workflow: workflowNames.get(run.workflowId)!,
  };
}

/** A person's findings: per workflow, the latest run and every older one still open. Runs arrive newest first. */
function findingsOf({
  runs,
  workflowNames,
}: {
  runs: readonly HeldTrelicaRun[];
  workflowNames: ReadonlyMap<string, string>;
}): TrelicaOffboardingFinding[] {
  const seen = new Set<string>();
  const findings: TrelicaOffboardingFinding[] = [];
  for (const run of runs) {
    const latest = !seen.has(run.workflowId);
    seen.add(run.workflowId);
    if (latest || isOpenTrelicaRun({ run })) {
      findings.push(findingOf({ run, superseded: !latest, workflowNames }));
    }
  }
  return findings;
}

/** The finding verdict most in need of a look. */
function worstVerdict({ findings }: { findings: readonly TrelicaOffboardingFinding[] }): TrelicaPersonVerdict {
  const ranked = findings
    .map((finding) => finding.verdict)
    .toSorted((a, b) => TRELICA_PERSON_VERDICTS.indexOf(a) - TRELICA_PERSON_VERDICTS.indexOf(b));
  return ranked[0]!;
}

/** One person's evidence from their runs, newest first. */
function personFromRuns({
  asOf,
  runs,
  person,
  workflowNames,
}: {
  asOf: string;
  runs: readonly HeldTrelicaRun[];
  person: HeldTrelicaPerson | undefined;
  workflowNames: ReadonlyMap<string, string>;
}): TrelicaOffboardingPersonEvidence {
  const named = runs[0]!.person!;
  const findings = findingsOf({ runs, workflowNames });
  return {
    email: person === undefined ? named.email : person.email,
    findings,
    identity: trelicaIdentityAccountState({ person }),
    name: person === undefined ? named.name : person.name,
    personId: named.id,
    runs: runs.length,
    standing: trelicaLeaverStanding({ asOf, person }),
    status: person === undefined ? null : person.status,
    verdict: worstVerdict({ findings }),
  };
}

/** A leaver with no offboarding run, as the evidence names them. */
function personWithoutRun({
  person,
  asOf,
}: {
  person: HeldTrelicaPerson;
  asOf: string;
}): TrelicaOffboardingPersonEvidence {
  return {
    email: person.email,
    findings: [],
    identity: trelicaIdentityAccountState({ person }),
    name: person.name,
    personId: person.id,
    runs: 0,
    standing: trelicaLeaverStanding({ asOf, person }),
    status: person.status,
    verdict: "no-observed-run",
  };
}

/** People most in need of a look first, then by name. */
function inReadingOrder({
  people,
}: {
  people: readonly TrelicaOffboardingPersonEvidence[];
}): TrelicaOffboardingPersonEvidence[] {
  return people.toSorted(
    (a, b) =>
      TRELICA_PERSON_VERDICTS.indexOf(a.verdict) - TRELICA_PERSON_VERDICTS.indexOf(b.verdict) ||
      a.name.localeCompare(b.name),
  );
}

/** Group the runs that name a person by that person's id, each group newest first. */
function runsByPerson({ runs }: { runs: readonly HeldTrelicaRun[] }): Map<string, HeldTrelicaRun[]> {
  const grouped = new Map<string, HeldTrelicaRun[]>();
  for (const run of newestTrelicaRunsFirst({ runs })) {
    if (run.person === null) {
      continue;
    }
    const list = grouped.get(run.person.id);
    if (list === undefined) {
      grouped.set(run.person.id, [run]);
    } else {
      list.push(run);
    }
  }
  return grouped;
}

/** How many named people carry each verdict. */
function verdictCountsOf({
  people,
}: {
  people: readonly TrelicaOffboardingPersonEvidence[];
}): Record<TrelicaPersonVerdict, number> {
  const count = ({ verdict }: { verdict: TrelicaPersonVerdict }): number =>
    people.filter((person) => person.verdict === verdict).length;
  return {
    "no-observed-run": count({ verdict: "no-observed-run" }),
    "run-aborted": count({ verdict: "run-aborted" }),
    "run-clean": count({ verdict: "run-clean" }),
    "run-completed-with-errors": count({ verdict: "run-completed-with-errors" }),
    "run-failed": count({ verdict: "run-failed" }),
    "run-stuck": count({ verdict: "run-stuck" }),
    unknown: count({ verdict: "unknown" }),
  };
}

/**
 * Build the offboarding evidence view out of the held people, workflows and runs.
 *
 * @param input the held entities and how many could not be read
 * @param asOf the generation's own instant, which a leaving date being due is judged against
 * @returns each offboarding workflow's evidence, every person it names with a verdict, and the reconciliation
 */
export function trelicaOffboardingReport({
  input,
  asOf,
}: {
  input: HeldTrelicaOffboardingInput;
  asOf: string;
}): TrelicaOffboardingReport {
  const offboarding = input.workflows.filter((workflow) => isTrelicaOffboardingWorkflow({ workflow }));
  const workflowNames = new Map(offboarding.map((workflow) => [workflow.id, workflow.name]));
  const runs = input.runs.filter((run) => workflowNames.has(run.workflowId));
  const people = new Map(input.people.map((person) => [person.id, person]));
  const grouped = runsByPerson({ runs });
  const oldest = newestTrelicaRunsFirst({ runs }).at(-1);
  const firstRunAt = oldest === undefined ? null : oldest.createdAt;
  const unrun = input.people
    .filter((person) => !grouped.has(person.id))
    .map((person) => ({ cohort: trelicaUnrunCohort({ asOf, firstRunAt, person }), person }));
  const ran = [...grouped.values()].map((own) =>
    personFromRuns({ asOf, person: people.get(own[0]!.person!.id), runs: own, workflowNames }),
  );
  const named = inReadingOrder({
    people: [
      ...ran.filter((person) => isCurrentTrelicaLeaver({ standing: person.standing })),
      ...unrun.filter((row) => row.cohort === "named").map((row) => personWithoutRun({ asOf, person: row.person })),
    ],
  });
  return {
    asOf,
    notLeaving: inReadingOrder({
      people: ran.filter((person) => !isCurrentTrelicaLeaver({ standing: person.standing })),
    }),
    people: named,
    reconciliation: {
      leaversBeforeFirstRun: unrun.filter((row) => row.cohort === "before-first-run").length,
      leaversWithoutDate: unrun.filter((row) => row.cohort === "no-date").length,
      runsNamingUnknownPeople: runs.filter((run) => run.person !== null && !people.has(run.person.id)).length,
      runsWithoutPerson: runs.filter((run) => run.person === null).length,
      runsWithoutSteps: runs.filter((run) => run.steps === null).length,
    },
    unreadable: input.unreadable,
    verdictCounts: verdictCountsOf({ people: named }),
    workflows: offboarding
      .map((workflow) => trelicaOffboardingWorkflowEvidence({ runs, workflow }))
      .toSorted((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
  };
}
