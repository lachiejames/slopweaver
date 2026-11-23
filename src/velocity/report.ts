/**
 * Compose the four measurements into one report, and render it two ways: human lines (with the caution
 * header and an inline reproduction command per the measured-comment rule) and a machine JSON shape.
 *
 * Pure: every field here is a value already measured elsewhere in `./`; this module only arranges and
 * prints them.
 */
import type { DayLandingCount } from "./docVelocity.js";
import type { DayMergeCount } from "./gitEdge.js";
import { mean, median } from "./stats.js";

/**
 * The caution this report carries verbatim: this metric sizes batches, it is
 * never a target, and every number below must be read alongside the quality gates' own state — review
 * rounds, gold rate — so speed can never be optimised against quality.
 */
export const VELOCITY_CAUTION =
  '"faster does not necessarily equal better" — this reads the machine\'s OWN pace, never a target. ' +
  "Pair every number below with the quality gates' state (review rounds, gold rate) before sizing a batch on it.";

/**
 * Everything one `slopweaver velocity` run measured.
 *
 * @internal — the exported functions below take and return it; nothing outside this file names the shape.
 */
export interface VelocityReport {
  readonly repoLabel: string;
  readonly repoPath: string;
  readonly ref: string;
  readonly windowDays: number;
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly mergesByDay: readonly DayMergeCount[];
  readonly mergesTotal: number;
  readonly docsLandedByDay: readonly DayLandingCount[];
  readonly docsLandedTotal: number;
  readonly medianDocLatencyHours: number | undefined;
  readonly docLatencySampleSize: number;
  readonly meanTurnsPerAsk: number | undefined;
  readonly medianTurnsPerAsk: number | undefined;
  readonly askSampleSize: number;
  readonly runsDir: string;
  readonly asksPath: string;
}

/**
 * Build the report from each measurement's raw samples plus the identifying context (repo, ref, window,
 * paths) the reproduction commands cite.
 *
 * @param repoLabel a short name for the repo (printed, never parsed)
 * @param repoPath the repository this run measured
 * @param ref the base ref merges were counted against
 * @param windowDays how many trailing days were measured
 * @param sinceIso the whole period's start (inclusive)
 * @param untilIso the whole period's end (exclusive)
 * @param mergesByDay one merge count per day, oldest first
 * @param docsLandedByDay one landing count per day, oldest first
 * @param docLatenciesHours every clean landing's open→landed latency, in hours, that had both endpoints
 * @param turnsPerAsk every terminated ask's dispatch count, within the window
 * @param runsDir the run-journal directory the doc-landing numbers came from
 * @param asksPath the ask-lifecycle log the turns-per-ask numbers came from
 * @returns the composed report
 */
export function composeVelocityReport({
  repoLabel,
  repoPath,
  ref,
  windowDays,
  sinceIso,
  untilIso,
  mergesByDay,
  docsLandedByDay,
  docLatenciesHours,
  turnsPerAsk,
  runsDir,
  asksPath,
}: {
  repoLabel: string;
  repoPath: string;
  ref: string;
  windowDays: number;
  sinceIso: string;
  untilIso: string;
  mergesByDay: readonly DayMergeCount[];
  docsLandedByDay: readonly DayLandingCount[];
  docLatenciesHours: readonly number[];
  turnsPerAsk: readonly number[];
  runsDir: string;
  asksPath: string;
}): VelocityReport {
  return {
    asksPath,
    askSampleSize: turnsPerAsk.length,
    docLatencySampleSize: docLatenciesHours.length,
    docsLandedByDay,
    docsLandedTotal: docsLandedByDay.reduce((total, day) => total + day.landed, 0),
    meanTurnsPerAsk: mean({ values: turnsPerAsk }),
    medianDocLatencyHours: median({ values: docLatenciesHours }),
    medianTurnsPerAsk: median({ values: turnsPerAsk }),
    mergesByDay,
    mergesTotal: mergesByDay.reduce((total, day) => total + day.merges, 0),
    ref,
    repoLabel,
    repoPath,
    runsDir,
    sinceIso,
    untilIso,
    windowDays,
  };
}

/** One decimal place, or `"n/a"` for `undefined` — every rate this report prints. */
function fmt({ value }: { value: number | undefined }): string {
  return value === undefined ? "n/a" : value.toFixed(1);
}

/**
 * Render the report as human-readable lines: the caution first, then each measurement with the exact
 * command that reproduces it, per the measured-comment rule (`.claude/rules/typescript-patterns.md`).
 *
 * @param report the composed report
 * @returns one line per row, in print order
 */
export function renderVelocityLines({ report }: { report: VelocityReport }): readonly string[] {
  const perDayMerges = report.mergesByDay.map((day) => `${day.dayKey.slice(5)}:${String(day.merges)}`).join(" ");
  const perDayLanded = report.docsLandedByDay.map((day) => `${day.dayKey.slice(5)}:${String(day.landed)}`).join(" ");
  return [
    `velocity — trailing ${String(report.windowDays)}d, ${report.repoLabel} @ ${report.ref}`,
    VELOCITY_CAUTION,
    "",
    `PRs merged: ${String(report.mergesTotal)} total (${perDayMerges})`,
    `  repro: git -C ${report.repoPath} log ${report.ref} --since=${report.sinceIso} --until=${report.untilIso} --pretty=%s | grep -cE '\\(#[0-9]+\\)'`,
    "",
    `Docs landed ready→done: ${String(report.docsLandedTotal)} total (${perDayLanded})`,
    `  repro: jq -s '[.[] | select(.kind=="finished" and (.residue|length)==0) | select(.atIso>="${report.sinceIso}" and .atIso<"${report.untilIso}")] | length' ${report.runsDir}/*.jsonl`,
    "",
    `Median doc open→landed latency: ${fmt({ value: report.medianDocLatencyHours })}h over ${String(report.docLatencySampleSize)} landing(s) with both endpoints`,
    `  repro: same journals — each landing's \`started\`.atIso to its \`finished\`.atIso within one run cycle`,
    "",
    `Turns per ask (dispatch cycles before a terminal reply): mean ${fmt({ value: report.meanTurnsPerAsk })}, median ${fmt({ value: report.medianTurnsPerAsk })} over ${String(report.askSampleSize)} ask(s)`,
    `  repro: jq -s '[.[] | select(.kind=="dispatched")] | group_by(.channel + .messageTs) | map(length)' ${report.asksPath}`,
  ];
}

/**
 * The machine-readable shape `--json` prints.
 *
 * @param report the composed report
 * @returns a plain object safe to `JSON.stringify`
 */
export function velocityJson({ report }: { report: VelocityReport }): Readonly<Record<string, unknown>> {
  return {
    askSampleSize: report.askSampleSize,
    caution: VELOCITY_CAUTION,
    docLatencySampleSize: report.docLatencySampleSize,
    docsLandedByDay: report.docsLandedByDay,
    docsLandedTotal: report.docsLandedTotal,
    meanTurnsPerAsk: report.meanTurnsPerAsk,
    medianDocLatencyHours: report.medianDocLatencyHours,
    medianTurnsPerAsk: report.medianTurnsPerAsk,
    mergesByDay: report.mergesByDay,
    mergesTotal: report.mergesTotal,
    ref: report.ref,
    repoLabel: report.repoLabel,
    sinceIso: report.sinceIso,
    untilIso: report.untilIso,
    windowDays: report.windowDays,
  };
}
