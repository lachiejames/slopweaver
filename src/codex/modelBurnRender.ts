/**
 * The human lines `slopweaver codex burn` prints. Pure — a report in, lines out; `--json` prints the report
 * itself, so the two can never describe different measurements.
 */
import type { ModelBurnReport, ModelBurnRow } from "./modelBurn.js";

/** A whole-number count per window, or an em dash for "not measured" — never `0` and never `Infinity`. */
function perWindowText({ value }: { value: number | undefined }): string {
  if (value === undefined) {
    return "—";
  }
  return value.toFixed(0);
}

/** A draw in whole percentage points, or "not read" for a window the group never saw. */
function drawnText({ value }: { value: number | undefined }): string {
  if (value === undefined) {
    return "not read";
  }
  return `${value.toFixed(0)}% drawn`;
}

/** An ISO instant cut to its date, or an em dash. */
function dateOf({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "—";
  }
  return iso.slice(0, 10);
}

/** One group's line. */
function rowLine({ row }: { row: ModelBurnRow }): string {
  return (
    `  ${row.model} · effort ${row.effort} · plan ${row.planType}: ` +
    `${String(row.sessions)} session(s) (${String(row.passes)} pass / ${String(row.seats)} seat) · ` +
    `week ${drawnText({ value: row.weeklyDrawn })} → ${perWindowText({ value: row.sessionsPerWeek })} per week · ` +
    `5h ${drawnText({ value: row.fiveHourDrawn })} → ${perWindowText({ value: row.sessionsPerFiveHours })} per 5h · ` +
    `${dateOf({ iso: row.firstIso })} → ${dateOf({ iso: row.lastIso })} on ${row.destinations.join(", ")}`
  );
}

/**
 * Render a burn report.
 *
 * @param report the measurement
 * @param destinations every destination the scan covered
 * @param days how many days behind each home's newest rollout the scan read
 * @param filesRead how many rollout files were opened
 * @returns the lines, in print order
 */
export function renderModelBurn({
  days,
  destinations,
  filesRead,
  report,
}: {
  days: number;
  destinations: readonly string[];
  filesRead: number;
  report: ModelBurnReport;
}): readonly string[] {
  const header =
    `codex burn: ${String(filesRead)} session(s) on ${destinations.join(", ")}, files modified within ` +
    `${String(days)} day(s) of each home's newest, ${String(report.readings)} reading(s)`;
  const unattributed =
    report.unattributedSessions > 0
      ? [`  unattributed: ${String(report.unattributedSessions)} session(s) carried no turn_context model`]
      : [];
  const rows = report.rows.length > 0 ? report.rows.map((row) => rowLine({ row })) : ["  no session carried a model"];
  return [
    header,
    ...rows,
    ...unattributed,
    "  per window = sessions ÷ (percent drawn ÷ 100). A rise is credited to the session whose reading closed it, so " +
      "concurrent sessions blur WHICH of them drew it, never the total. — is not measured, never zero.",
  ];
}
