/**
 * What `slopweaver desktop e2e` prints and writes when its steps are done: one line per step with its photograph,
 * then the count, and the same as `report.json` beside the photographs. A call scenario (`--call`) carries its
 * structured evidence — call ids, heap samples, the correlated log lines — in the JSON, never in the line. Pure.
 */
import type { E2eCallEvidence } from "./e2eCallOutcome.js";
import type { E2eCallStep } from "./e2eCallPlan.js";
import type { E2eVerdict } from "./e2eOutcome.js";
import type { E2eStep } from "./e2ePlan.js";

/** One step as it ran. */
export interface E2eStepResult {
  readonly step: E2eStep | E2eCallStep;
  readonly verdict: E2eVerdict;
  /** The photograph taken at the end of the step, or `undefined` when none could be taken. */
  readonly screenshot: string | undefined;
  /** The address the page stood on when photographed. */
  readonly url: string | undefined;
  /** From the step's first action to its photograph. */
  readonly elapsedMs: number;
  /** A call scenario's evidence; absent on a walk step. */
  readonly call?: E2eCallEvidence;
}

/** The whole run, as `report.json` holds it. */
export interface E2eReport {
  readonly app: string;
  readonly checkout: string;
  readonly startedIso: string;
  readonly out: string;
  readonly passed: number;
  readonly failed: number;
  /** Steps that did not run because there was nothing to act on, such as a card on an empty Queue. Never a pass. */
  readonly notApplicable: number;
  readonly steps: readonly E2eStepResult[];
  /** Why the run stopped before its last step — a call that could not be proven ended — or `undefined`. */
  readonly fatal: string | undefined;
}

/**
 * Fold the steps into the report.
 *
 * @param app the bundle walked
 * @param checkout the checkout whose console it read
 * @param startedIso when the run started
 * @param out the folder the photographs and report are in
 * @param steps every step, in walk order
 * @param fatal why the run stopped early, `undefined` when it did not
 * @returns the report
 */
export function e2eReport({
  app,
  checkout,
  startedIso,
  out,
  steps,
  fatal,
}: {
  app: string;
  checkout: string;
  startedIso: string;
  out: string;
  steps: readonly E2eStepResult[];
  fatal: string | undefined;
}): E2eReport {
  const passed = steps.filter((result) => result.verdict.passed).length;
  const notApplicable = notApplicableIds({ steps }).length;
  return {
    app,
    checkout,
    failed: steps.length - passed - notApplicable,
    fatal,
    notApplicable,
    out,
    passed,
    startedIso,
    steps,
  };
}

/**
 * The ids of the steps judged not applicable, in walk order.
 *
 * @param steps every step, in walk order
 * @returns their ids
 */
function notApplicableIds({ steps }: { steps: readonly E2eStepResult[] }): readonly string[] {
  return steps.filter((result) => isNotApplicable({ verdict: result.verdict })).map((result) => result.step.id);
}

/**
 * Whether a verdict says the step did not run, rather than that it passed or failed.
 *
 * @param verdict the step's verdict
 * @returns true for not applicable
 */
function isNotApplicable({ verdict }: { verdict: E2eVerdict }): boolean {
  return !verdict.passed && verdict.kind === "not-applicable";
}

/**
 * A step's photograph as its line names it: the path, or that the step took none.
 *
 * @param screenshot the photograph's path, absent when the page was gone before it could be taken
 * @returns the words
 */
function shotWords({ screenshot }: { screenshot: string | undefined }): string {
  if (screenshot === undefined) {
    return "no screenshot";
  }
  return screenshot;
}

/**
 * One step's line.
 *
 * @param result the step as it ran
 * @returns the line
 */
export function e2eStepLine({ result }: { result: E2eStepResult }): string {
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  const shot = shotWords({ screenshot: result.screenshot });
  if (result.verdict.passed) {
    return `PASS  ${result.step.id}  ${seconds}s  ${shot}`;
  }
  if (result.verdict.kind === "not-applicable") {
    return `N/A   ${result.step.id}  ${seconds}s  ${result.verdict.detail}  ${shot}`;
  }
  return `FAIL  ${result.step.id}  ${seconds}s  ${result.verdict.kind}: ${result.verdict.detail}  ${shot}`;
}

/**
 * One line per step, then the count, and why the run stopped early when it did. The count names every step that did
 * not run, so a not-applicable step is never read off a summary as one that passed.
 *
 * @param report the run
 * @returns the lines, in walk order
 */
export function e2eReportLines({ report }: { report: E2eReport }): readonly string[] {
  const lines = report.steps.map((result) => e2eStepLine({ result }));
  const total = report.steps.length;
  const stopped = report.fatal === undefined ? [] : [`STOPPED  ${report.fatal}`];
  const skipped = notApplicableIds({ steps: report.steps });
  let notRun = "";
  if (skipped.length > 0) {
    notRun = `, ${String(skipped.length)} not applicable (${skipped.join(", ")})`;
  }
  return [
    ...lines,
    ...stopped,
    `desktop e2e: ${String(report.passed)} of ${String(total)} step(s) passed${notRun} on ${report.app} — ${report.out}`,
  ];
}
