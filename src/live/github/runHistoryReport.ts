/**
 * How a {@link RunHistoryDocument} is rendered — the text table a session reads and the one JSON document a
 * later measurement diffs against.
 *
 * Split from `./runHistory.ts` so the measurement and its presentation stay separable: the ratchet reads the
 * same summaries without ever wanting a table, and the file-size ratchet has one reason less to fire.
 */

import { safeJsonStringify } from "../../lib/safeJson.js";
import { breachesBar, type JobDurationSummary, type RunHistoryDocument } from "./runHistory.js";

/** The bar the owner set: every check under five minutes. */
export const CI_BAR_MINUTES = 5;

/**
 * A duration as `m:ss` — never a zero standing in for a measurement nobody took.
 *
 * @returns the rounded `m:ss` label, or an em dash when `seconds` is absent
 */
export function durationLabel({ seconds }: { seconds: number | undefined }): string {
  if (seconds === undefined) {
    return "—";
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
}

/**
 * The verdict column for one job: over the bar, under it, or not measured at all.
 *
 * `n/m` — never a blank and never `ok` — is the whole reason this is its own function. A job with no sample
 * is a job nobody has a number for, and printing it beside the ones that passed is how
 * `integration  20  -1:-1  0:00  0:00` read as the fastest check in the workflow on this verb's first run.
 *
 * @param summary the job summary to judge
 * @returns the four-character verdict cell
 */
function verdictCell({ summary }: { summary: JobDurationSummary }): string {
  if (summary.runs === 0) {
    return "n/m ";
  }
  return breachesBar({ barMinutes: CI_BAR_MINUTES, summary }) ? "OVER" : "ok  ";
}

/** One summary as a table row: name, sample size, the wall percentiles, then queue. */
function jobRow({ summary }: { summary: JobDurationSummary }): string {
  const flag = verdictCell({ summary });
  const queue = summary.dependencyBlocked ? "(needs)" : durationLabel({ seconds: summary.queueP50Seconds });
  return [
    flag,
    summary.name.padEnd(14),
    String(summary.runs).padStart(3),
    durationLabel({ seconds: summary.wallP50Seconds }).padStart(6),
    durationLabel({ seconds: summary.wallP95Seconds }).padStart(6),
    durationLabel({ seconds: summary.wallMaxSeconds }).padStart(6),
    queue.padStart(7),
  ].join("  ");
}

/**
 * The line under the table saying why a job carries no number, and what that does NOT establish.
 *
 * @param summary the job summary that has appearances it could not measure
 * @param window how many runs the read covered, so a reader sees the proportion
 * @returns one line naming the count and the reason
 */
function notMeasuredLine({ summary, window }: { summary: JobDurationSummary; window: number }): string {
  if (summary.skipped > 0) {
    return (
      `  ${summary.name}: SKIPPED in ${String(summary.skipped)} of ${String(window)} run(s) — this event does ` +
      "not trigger it, so nothing here says how long it takes"
    );
  }
  return `  ${summary.name}: ${String(summary.unreadable)} appearance(s) ran but carried no readable wall time`;
}

/**
 * The per-step breakdown, grouped under its job, in the order the workflow declares the steps.
 *
 * Empty when the caller did not ask for it — and empty for a DIFFERENT reason when they did and there were
 * no steps to read, which is why the heading is printed off `stepsRequested` rather than off the array's
 * own length: a silent nothing would read as "this job has no steps" instead of "you did not ask".
 *
 * @param document the timing document, which knows whether steps were requested
 * @returns the section's lines, or none at all
 */
function stepSection({ document }: { document: RunHistoryDocument }): readonly string[] {
  if (!document.stepsRequested) {
    return [];
  }
  const lines: string[] = ["", "steps (p50 · p95, in declared order):"];
  for (const job of document.jobs) {
    const steps = document.steps.filter((step) => step.job === job.name);
    if (steps.length === 0) {
      lines.push(`  ${job.name}: no step timing in this window`);
      continue;
    }
    lines.push(`  ${job.name}`);
    for (const step of steps) {
      const p50 = durationLabel({ seconds: step.wallP50Seconds }).padStart(6);
      const p95 = durationLabel({ seconds: step.wallP95Seconds }).padStart(6);
      lines.push(`    ${p50}  ${p95}   ${step.name}`);
    }
  }
  return lines;
}

/**
 * Render a history document as the ranked text table.
 *
 * @param document the timing document to render
 * @returns the whole report, newline-separated, ready for one `logger.out`
 */
export function renderRunHistoryText({ document }: { document: RunHistoryDocument }): string {
  const header = [
    `${document.repo} · ${document.workflow} · ${document.branch} · event ${document.event}`,
    `${String(document.runs.length)} run(s), read ${document.readAtIso} — bar ${String(CI_BAR_MINUTES)}:00 wall`,
    "",
    `      ${"job".padEnd(14)}  ${"n".padStart(3)}  ${"p50".padStart(6)}  ${"p95".padStart(6)}  ${"max".padStart(6)}  ${"queue".padStart(7)}`,
  ];
  const rows = document.jobs.map((summary) => jobRow({ summary }));
  const notMeasured = document.jobs
    .filter((summary) => summary.skipped > 0 || summary.unreadable > 0)
    .map((summary) => notMeasuredLine({ summary, window: document.runs.length }));
  const residue = document.residue.length === 0 ? [] : ["", "residue:", ...document.residue.map((line) => `  ${line}`)];
  return [...header, ...rows, ...notMeasured, ...stepSection({ document }), ...residue].join("\n");
}

/**
 * Render a history document as one machine-readable document.
 *
 * Bounded by the run count the caller asked for (at most 100 runs of a handful of jobs), so it is inside
 * `safeJsonStringify`'s criterion rather than a payload whose size comes from data.
 *
 * @param document the timing document to render
 * @returns the JSON text
 */
export function renderRunHistoryJson({ document }: { document: RunHistoryDocument }): string {
  return safeJsonStringify({ label: "github ci-runs", space: 2, value: document });
}
