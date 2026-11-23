/**
 * The lines `plans usage` prints without `--json`: one per registered plan, each window with its source and the
 * instant it was observed, so a reader ages every number rather than trusting it. Pure.
 */
import type { PlanUsageReport, PlanUsageRow, PlanUsageSignIn, PlanUsageWindow } from "../../../plans/planUsageTypes.js";

/** What each window label prints as. */
const LABEL_WORD = { "fable-week": "Fable week", week: "week" } as const;

/** What each source prints as. */
const SOURCE_WORD = { "claude-gauge-snapshot": "gauge", "codex-rollout-log": "rollout log" } as const;

/** One window's clause. */
function windowClause({ window }: { window: PlanUsageWindow }): string {
  const label = LABEL_WORD[window.label];
  const source = SOURCE_WORD[window.source];
  switch (window.kind) {
    case "measured":
    case "stale": {
      const reset = window.resetAtIso === null ? "reset unrecorded" : `resets ${window.resetAtIso}`;
      const stale = window.kind === "stale" ? " STALE" : "";
      return `${label} ${String(window.usedPercent)}%${stale} (${reset}; ${source} ${window.observedAtIso})`;
    }
    case "no-reading":
      return `${label} no reading (${window.reason})`;
    case "unavailable":
      return `${label} UNAVAILABLE (${window.reason})`;
    default: {
      const unhandled: never = window;
      return unhandled;
    }
  }
}

/** One sign-in clause. */
function signInClause({ signIn }: { signIn: PlanUsageSignIn }): string {
  switch (signIn.kind) {
    case "ok":
      return `signed in (${signIn.source} ${signIn.observedAtIso})`;
    case "needs-sign-in":
      return `NEEDS SIGN-IN: ${signIn.reason}`;
    case "unknown":
      return `sign-in unknown: ${signIn.reason}`;
    default: {
      const unhandled: never = signIn;
      return unhandled;
    }
  }
}

/** One row's line. */
function rowLine({ row }: { row: PlanUsageRow }): string {
  const host = row.modelHost === "claude" ? "Claude" : "Codex";
  // An `if` rather than `??`: a missing address is named in the line, never silently substituted (`no-silent-fallback`).
  let account = "address uncached";
  if (row.email !== null) {
    account = row.email;
  }
  let usage: string;
  switch (row.usage.kind) {
    case "weekly":
      usage = row.usage.windows.map((window) => windowClause({ window })).join(" · ");
      break;
    case "paused":
      usage = `paused since ${row.usage.sinceIso}: ${row.usage.reason}`;
      break;
    case "not-measured":
      usage = `NOT MEASURED: ${row.usage.reason}`;
      break;
    default: {
      const unhandled: never = row.usage;
      usage = unhandled;
    }
  }
  return `${row.alias.padEnd(12)} ${host} · ${account} · ${usage} · ${signInClause({ signIn: row.signIn })}`;
}

/**
 * The report as lines: a heading naming the instant, then one line per plan.
 *
 * @param report the projected report
 * @returns the lines, or one saying nothing is registered
 */
export function planUsageLines({ report }: { report: PlanUsageReport }): readonly string[] {
  if (report.rows.length === 0) {
    return ["plans usage: no destination is registered"];
  }
  return [
    `plans usage at ${report.observedAtIso} — recorded readings only, no model host asked`,
    ...report.rows.map((row) => rowLine({ row })),
  ];
}
