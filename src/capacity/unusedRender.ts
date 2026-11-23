/**
 * `slopweaver machine unused` as text: one markdown table a pull request or a page can paste verbatim, the
 * machine's line under it, and every problem the readers met. Pure.
 */
import type { UnusedCapacityReport, UnusedWindowMeasurement } from "./unused.js";

/** A percentage as the table prints it — whole numbers, because every figure here is a bound or a sample mean. */
function pct({ value }: { value: number }): string {
  return `${String(Math.round(value))}%`;
}

/** A span of seconds in the unit a reader compares — hours, one decimal. */
function hours({ seconds }: { seconds: number }): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** The expired-instance cell: the bound and how loose it is, or a dash when nothing expired. */
function expiredCell({ row }: { row: UnusedWindowMeasurement }): string {
  if (row.unusedAtResetPct === null || row.widestLastReadingToResetSeconds === null) {
    return "—";
  }
  return (
    `≤ ${pct({ value: row.unusedAtResetPct })} over ${String(row.expiredWindows)} ` +
    `(last reading ≤ ${hours({ seconds: row.widestLastReadingToResetSeconds })} before reset)`
  );
}

/** The open-instance cell: what is unused now and when it resets, or a dash when none was open. */
function openCell({ row }: { row: UnusedWindowMeasurement }): string {
  if (row.open === null) {
    return "—";
  }
  return `${pct({ value: 100 - row.open.usedPct })} unused, resets ${row.open.resetAtIso}`;
}

/**
 * Render the report.
 *
 * @param report the measurement
 * @returns the lines to print, a markdown table first
 */
export function renderUnusedLines({ report }: { report: UnusedCapacityReport }): readonly string[] {
  const { heldPct, loadHold, meanLoad1, ticks, unusedLoadPct, widestGapSeconds } = report.machine;
  let machineLine = "machine: no supervisor tick read the machine in this span";
  if (heldPct !== null && meanLoad1 !== null && unusedLoadPct !== null && widestGapSeconds !== null) {
    machineLine =
      `machine: ${pct({ value: unusedLoadPct })} of the load hold (${String(loadHold)}, today's) left free on ` +
      `average over ${String(ticks)} ticks; mean 1-minute load ${meanLoad1.toFixed(1)}; ` +
      `${pct({ value: heldPct })} of ticks read a hold; widest gap between ticks ${hours({ seconds: widestGapSeconds })}`;
  }
  return [
    `unused capacity, ${report.fromIso} → ${report.toIso}`,
    "",
    "| ceiling | window | expired windows: unused at reset | open now | samples | widest gap |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.windows.map(
      (row) =>
        `| ${row.ceilingId} | ${row.window} | ${expiredCell({ row })} | ${openCell({ row })} | ` +
        `${String(row.samples)} | ${hours({ seconds: row.widestGapSeconds })} |`,
    ),
    "",
    machineLine,
    ...report.problems.map((problem) => `could not see: ${problem}`),
  ];
}
