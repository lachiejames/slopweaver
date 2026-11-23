/**
 * Turn one {@link OnboardEvalRun} into the friction report the owner asked for: a numbered list of what a
 * real new developer would have hit, each anchored to the skill line or verb output that caused it.
 *
 * Pure: every function here takes an already-parsed run and returns data or markdown. No filesystem, no
 * clock — {@link ../onboardEval/history} is where a report actually gets stored and diffed against the past.
 */
import type { OnboardEvalOutcome, OnboardEvalRun, OnboardEvalStepRecord } from "./runArtifact.js";

/** Why one step counts as friction, ranked worst-first — the order {@link topFrictionFindings} sorts by. */
const FRICTION_SEVERITIES = ["failed-silently", "unclear-instruction", "missing-verb", "had-to-guess"] as const;

/** One of {@link FRICTION_SEVERITIES}. */
type FrictionSeverity = (typeof FRICTION_SEVERITIES)[number];

/** One friction item: a step that did not go the way a new developer should expect. */
export interface FrictionFinding {
  readonly severity: FrictionSeverity;
  readonly stepId: string;
  readonly skillRef: string;
  readonly verb: string | undefined;
  readonly detail: string;
}

/** One step scored as needing real credentials the eval had none of — reported, never dropped. */
export interface UnprovenStep {
  readonly stepId: string;
  readonly skillRef: string;
  readonly verb: string | undefined;
  readonly detail: string;
}

/** The complete friction report for one run. */
export interface FrictionReport {
  readonly runId: string;
  readonly totalSteps: number;
  readonly totalDurationSeconds: number;
  readonly findings: readonly FrictionFinding[];
  readonly unprovenSteps: readonly UnprovenStep[];
}

/** The one severity a step's outcome forces, when its outcome alone is enough to decide it — pure lookup. */
const OUTCOME_SEVERITY: Readonly<Partial<Record<OnboardEvalOutcome, FrictionSeverity>>> = {
  "failed-silently": "failed-silently",
};

/**
 * The single worst-first severity a step earns, or `undefined` when the step was clean.
 *
 * A step can trip more than one condition (an unclear instruction that also required a guess); only the
 * WORST one is kept, because the numbered report lists a step once, not once per condition it failed.
 *
 * @param step the step to classify
 * @returns the step's severity, or undefined when it is not friction
 */
function severityOf({ step }: { step: OnboardEvalStepRecord }): FrictionSeverity | undefined {
  const fromOutcome = OUTCOME_SEVERITY[step.outcome];
  if (fromOutcome !== undefined) {
    return fromOutcome;
  }
  if (!step.instructionClear) {
    return "unclear-instruction";
  }
  if (!step.verbPresent) {
    return "missing-verb";
  }
  if (step.guessed) {
    return "had-to-guess";
  }
  return undefined;
}

/** Render one step's detail line, folding in the guess note when the step's own severity is not already "guessed". */
function detailOf({ step, severity }: { step: OnboardEvalStepRecord; severity: FrictionSeverity }): string {
  const guessSuffix =
    step.guessed && severity !== "had-to-guess" && step.guessNote !== undefined
      ? ` (also had to guess: ${step.guessNote})`
      : "";
  return `${step.outcomeDetail}${guessSuffix}`;
}

/**
 * Build every friction finding in a run, worst-first, in step order within a severity.
 *
 * @param run the parsed evaluation run
 * @returns every step that counts as friction, most severe first
 */
export function buildFrictionFindings({ run }: { run: OnboardEvalRun }): readonly FrictionFinding[] {
  // Every severity opens with no findings, so one no step earned contributes nothing to the report.
  const bySeverity = new Map<FrictionSeverity, FrictionFinding[]>(
    FRICTION_SEVERITIES.map((severity) => [severity, []]),
  );
  for (const step of run.steps) {
    const severity = severityOf({ step });
    if (severity === undefined) {
      continue;
    }
    const finding: FrictionFinding = {
      detail: detailOf({ severity, step }),
      severity,
      skillRef: step.skillRef,
      stepId: step.id,
      verb: step.verb,
    };
    // `severityOf` answers only one of FRICTION_SEVERITIES, each seeded above.
    bySeverity.get(severity)!.push(finding);
  }
  return FRICTION_SEVERITIES.flatMap((severity) => bySeverity.get(severity)!);
}

/**
 * Every step scored `unproven-credential-gated` — reported as its own list so a credential gap never reads
 * as a clean pass.
 *
 * @param run the parsed evaluation run
 * @returns every unproven step, in run order
 */
export function buildUnprovenSteps({ run }: { run: OnboardEvalRun }): readonly UnprovenStep[] {
  return run.steps
    .filter((step) => step.outcome === "unproven-credential-gated")
    .map((step) => ({ detail: step.outcomeDetail, skillRef: step.skillRef, stepId: step.id, verb: step.verb }));
}

/**
 * Build the complete friction report for a run.
 *
 * @param run the parsed evaluation run
 * @returns the report: every finding, every unproven step, and the run's summary stats
 */
export function buildFrictionReport({ run }: { run: OnboardEvalRun }): FrictionReport {
  return {
    findings: buildFrictionFindings({ run }),
    runId: run.runId,
    totalDurationSeconds: run.steps.reduce((sum, step) => sum + step.durationSeconds, 0),
    totalSteps: run.steps.length,
    unprovenSteps: buildUnprovenSteps({ run }),
  };
}

/** One line of a finding, numbered and anchored to its skill reference. */
function findingLine({ finding, index }: { finding: FrictionFinding; index: number }): string {
  const verbNote = finding.verb !== undefined ? ` [${finding.verb}]` : "";
  return `${index + 1}. (${finding.severity}) ${finding.skillRef}${verbNote} — ${finding.detail}`;
}

/**
 * Render a report as the plain-English friction list the owner asked for.
 *
 * @param report the report to render
 * @returns the report's markdown lines
 */
export function renderFrictionReportMarkdown({ report }: { report: FrictionReport }): readonly string[] {
  const lines: string[] = [
    `# Onboarding self-evaluation — run ${report.runId}`,
    "",
    `${report.totalSteps} step(s) evaluated, ${Math.round(report.totalDurationSeconds)}s total.`,
    "",
  ];
  if (report.findings.length === 0) {
    lines.push("No friction found — every step was clear, verb-backed, and unguessed.");
  } else {
    lines.push(`## Friction (${report.findings.length})`, "");
    report.findings.forEach((finding, index) => lines.push(findingLine({ finding, index })));
  }
  lines.push("");
  if (report.unprovenSteps.length === 0) {
    lines.push("No steps were credential-gated.");
  } else {
    lines.push(`## Unproven here — credential-gated (${report.unprovenSteps.length})`, "");
    report.unprovenSteps.forEach((step, index) =>
      lines.push(`${index + 1}. ${step.skillRef}${step.verb !== undefined ? ` [${step.verb}]` : ""} — ${step.detail}`),
    );
  }
  return lines;
}
