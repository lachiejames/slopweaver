/**
 * The human form of `atlas trelica report --offboarding`: how fresh each input kind is, how the inputs
 * reconcile, each offboarding workflow's configured steps beside what its runs recorded, then every person whose
 * evidence needs a look. A person whose every finding is `run-clean` is counted, and named only when a live
 * Identity account says the clean run is not the whole story.
 */
import {
  TRELICA_PERSON_VERDICTS,
  type TrelicaOffboardingFinding,
  type TrelicaOffboardingPersonEvidence,
  type TrelicaOffboardingReport,
} from "../../../atlas/trelica/offboardingEvidence.js";
import type {
  TrelicaOffboardingWorkflowEvidence,
  TrelicaStepRecord,
  TrelicaTally,
} from "../../../atlas/trelica/offboardingWorkflows.js";

/** How fresh one input kind is, as the manifest records it. */
export interface TrelicaOffboardingInputState {
  readonly kind: string;
  readonly lastSuccessAt: string | null;
  /** The latest attempt's failure reasons, or `null` when it succeeded or none was made. */
  readonly latestAttemptFailed: readonly string[] | null;
}

/** `Completed 27, Skipped 1`. */
function talliesText({ tallies }: { tallies: readonly TrelicaTally[] }): string {
  return tallies.map((tally) => `${tally.value} ${String(tally.count)}`).join(", ");
}

/** One configured step as a reader sees it. */
function stepText({ step }: { step: TrelicaOffboardingWorkflowEvidence["steps"][number] }): string {
  const via = step.provider === null ? "" : ` via ${step.provider}`;
  const configured = step.configured.length === 0 ? "" : ` {${step.configured.join("; ")}}`;
  return `${step.name}${via}${step.continueOnError ? " [continues on error]" : ""}${configured}`;
}

/** The trigger as a reader sees it: `Person leaves (leaving date +0 days; for Contractor, Employee; approval: no)`. */
function triggerText({ trigger }: { trigger: TrelicaOffboardingWorkflowEvidence["trigger"] }): string {
  const parts: string[] = [];
  const offset = trigger.leavingDateDaysOffset;
  if (offset !== null) {
    parts.push(`leaving date ${offset >= 0 ? "+" : ""}${String(offset)} days`);
  }
  if (trigger.personTypes.length > 0) {
    parts.push(`for ${trigger.personTypes.join(", ")}`);
  }
  if (trigger.requireApproval !== null) {
    parts.push(`approval: ${trigger.requireApproval ? "yes" : "no"}`);
  }
  return parts.length === 0 ? trigger.name : `${trigger.name} (${parts.join("; ")})`;
}

/** What the runs recorded under one step id, or that they recorded nothing. */
function recordedText({ recorded }: { recorded: TrelicaStepRecord }): string {
  if (recorded.outcomes.length === 0) {
    return "no held run recorded it";
  }
  const failure = recorded.commonestFailure;
  const failureText = failure === null ? "" : `; commonest failure "${failure.value}" ×${String(failure.count)}`;
  return `${talliesText({ tallies: recorded.outcomes })}${failureText}`;
}

/** One workflow's lines. */
function workflowLines({ workflow }: { workflow: TrelicaOffboardingWorkflowEvidence }): string[] {
  const state = `${workflow.enabled ? "enabled" : "disabled"}${workflow.archived ? ", archived" : ""}`;
  const trigger = triggerText({ trigger: workflow.trigger });
  const last = workflow.lastRun;
  const lastText =
    last === null
      ? "never run"
      : `last run ${last.createdAt} ${last.uiStatus}${last.person === null ? "" : ` (${last.person})`}`;
  const version = `v${String(workflow.latestPublishedVersion)}`;
  const lines = [
    `workflow "${workflow.name}" — ${state}, ${workflow.flowType}, trigger ${trigger}, ${version}; ` +
      `${String(workflow.runs)} run(s) touching ${String(workflow.peopleTouched)} people, ${lastText}`,
  ];
  if (workflow.runs > 0) {
    lines.push(`  run outcomes: ${talliesText({ tallies: workflow.outcomes })}`);
  }
  lines.push(`  configured in ${version}, in order, each with what runs recorded under its id:`);
  workflow.steps.forEach((step, index) => {
    lines.push(`    ${String(index + 1)}. ${stepText({ step })}: ${recordedText({ recorded: step.recorded })}`);
  });
  if (workflow.retiredSteps.length > 0) {
    lines.push("  run by an older version only:");
  }
  for (const step of workflow.retiredSteps) {
    lines.push(`    "${step.name}": ${recordedText({ recorded: step.recorded })}`);
  }
  return lines;
}

/** One finding, indented under its person. */
function findingLine({ finding }: { finding: TrelicaOffboardingFinding }): string {
  const older = finding.superseded ? "older, still open: " : "";
  const adverse =
    finding.adverseSteps.length === 0
      ? ""
      : `; ${finding.adverseSteps.map((step) => `${step.step} ${step.status}${step.message === null ? "" : ` (${step.message})`}`).join(", ")}`;
  return (
    `      ${older}${finding.verdict} — "${finding.workflow}" ${finding.createdAt} ${finding.uiStatus} ` +
    `at "${finding.currentStep}"${adverse}`
  );
}

/** One named person's lines. */
function personLines({ person }: { person: TrelicaOffboardingPersonEvidence }): string[] {
  const email = person.email === null ? "" : ` <${person.email}>`;
  const standing = person.standing === "terminated" ? "" : `, ${person.standing}`;
  const status = person.status === null ? " [not in people]" : ` [${person.status}${standing}]`;
  const live =
    person.identity.live.length === 0 ? "" : `; live Identity account(s): ${person.identity.live.join(", ")}`;
  const unknown =
    person.identity.unknown.length === 0 ? "" : `; Identity account state unset: ${person.identity.unknown.join(", ")}`;
  return [
    `  ${person.verdict} — ${person.name}${email}${status}, ${String(person.runs)} run(s)${live}${unknown}`,
    ...person.findings.map((finding) => findingLine({ finding })),
  ];
}

/** The input-freshness line. */
function inputsLine({ inputs }: { inputs: readonly TrelicaOffboardingInputState[] }): string {
  const parts = inputs.map((input) => {
    const success = input.lastSuccessAt === null ? "never read whole" : `read whole ${input.lastSuccessAt}`;
    const failed =
      input.latestAttemptFailed === null ? "" : ` — LATEST ATTEMPT FAILED: ${input.latestAttemptFailed.join("; ")}`;
    return `${input.kind} ${success}${failed}`;
  });
  return `  inputs: ${parts.join("; ")}`;
}

/**
 * Render the offboarding evidence view for a terminal.
 *
 * @param report the evidence view
 * @param inputs how fresh each kind it was built from is
 * @returns the lines, in print order
 */
export function trelicaOffboardingLines({
  report,
  inputs,
}: {
  report: TrelicaOffboardingReport;
  inputs: readonly TrelicaOffboardingInputState[];
}): string[] {
  const counts = TRELICA_PERSON_VERDICTS.map((verdict) => `${verdict} ${String(report.verdictCounts[verdict])}`).join(
    ", ",
  );
  const named = report.people.filter((person) => person.verdict !== "run-clean" || person.identity.live.length > 0);
  const r = report.reconciliation;
  return [
    `trelica offboarding evidence as of ${report.asOf} — ${String(report.workflows.length)} offboarding workflow(s); ` +
      `${String(report.people.length)} people: ${counts}`,
    inputsLine({ inputs }),
    `  reconciliation: ${String(r.runsWithoutPerson)} run(s) without a person, ${String(r.runsNamingUnknownPeople)} ` +
      `naming a person the atlas does not hold, ${String(r.runsWithoutSteps)} without held step states; ` +
      `${String(r.leaversWithoutDate)} leaver(s) with no run and no date, ${String(r.leaversBeforeFirstRun)} who ` +
      `left before the first run; ${String(report.unreadable)} held record(s) unreadable`,
    ...report.workflows.flatMap((workflow) => workflowLines({ workflow })),
    `evidence needing a look — ${String(named.length)} current leaver(s), Terminated or with a due leaving date ` +
      `(a run's states record what the workflow executed, not what a provider now holds):`,
    ...named.flatMap((person) => personLines({ person })),
    `not counted as leavers — ${String(report.notLeaving.length)} people an offboarding run names whose current ` +
      `record does not say they have left; to interpret, never to remediate:`,
    ...report.notLeaving.flatMap((person) => personLines({ person })),
  ];
}
