/**
 * What the menu bar says about the plans: one headline in the menu itself, and one line per plan in its submenu, so
 * nine plans never push the menu's own items off the screen (rule 7: concise by default, the rest behind a choice).
 *
 * Every number shown is a RECORDED reading the console read off this machine (`src/plans/planUsage.ts`), so the
 * headline names when it was read and the menu never presents an old answer as a current one:
 *
 * - a plan that needs a sign-in shows that and no percentage, because a number from before the sign-out is no
 *   longer what the plan has left;
 * - a paused plan shows its pause, a monthly-spend plan says it is not measured, and neither shows a weekly number;
 * - a window with no reading says so, never 0%;
 * - a stale Claude reading keeps its number, labelled stale with when it was read;
 * - every window is judged again at the instant the menu is DRAWN, so a reset passing between two polls reads as
 *   reopened, never as the old percentage, and a Claude reading crossing its hour reads stale;
 * - a headline whose last answer is older than two polls says it is stale, so a console that stopped answering
 *   never leaves yesterday's numbers looking live.
 *
 * Pure: the clock and the zone are arguments.
 */
import { clockTime } from "./fleetAutomation";
import type { PlanUsageReading, PlanUsageRow, PlanUsageWindow } from "./planUsage";

/**
 * How often the menu bar asks the console. MEASURED on this machine's home, nine plans: one read took
 * 7.37s wall and 6.57s CPU, most of it the Codex rollout scan, so a minute's poll would hold a tenth of a core for a
 * figure that moves over hours. Reproduce with `/usr/bin/time -p ./bin/slopweaver plans usage --json`.
 */
export const PLAN_USAGE_INTERVAL_MS = 5 * 60_000;

/** Past two polls without an answer, the headline says its numbers are stale. */
const STALE_AFTER_MS = 2 * PLAN_USAGE_INTERVAL_MS;

/** What the shell last learned. */
export type PlanUsageTrayState =
  | { readonly kind: "reading" }
  | { readonly kind: "available"; readonly receivedAtMs: number; readonly reading: PlanUsageReading }
  | { readonly kind: "unavailable"; readonly reason: string };

/** The menu's headline, and the lines its submenu holds. */
export interface PlanUsageTrayLines {
  readonly headline: string;
  readonly rows: readonly string[];
}

/** What each window label prints as. */
const LABEL_WORD = { "fable-week": "Fable", week: "week" } as const;

/** An instant as the owner reads it: a clock time today, the weekday and time otherwise. */
function atOf({ iso, nowMs, timeZone }: { iso: string; nowMs: number; timeZone: string | undefined }): string {
  const zone = timeZone === undefined ? {} : { timeZone };
  const ms = Date.parse(iso);
  const day = new Intl.DateTimeFormat("en-CA", zone);
  const time = clockTime({ ms, timeZone });
  if (day.format(ms) === day.format(nowMs)) {
    return time;
  }
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "short", ...zone }).format(ms);
  return `${weekday} ${time}`;
}

/**
 * How long a Claude reading stays evidence: `src/claude/seatUsageGate.ts`'s `CLAUDE_USAGE_READING_FRESH_MS`, written
 * twice because this package imports nothing from `src/`. The report judged it when it was assembled; the menu
 * judges it again when it is drawn, since a poll lands up to {@link PLAN_USAGE_INTERVAL_MS} later.
 */
const CLAUDE_READING_FRESH_MS = 60 * 60_000;

/** The longest a weekly window stays open, as `src/plans/planUsage.ts` judges it. */
const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * A window as it stands at the instant the menu is drawn, not the instant the report was assembled: a reset passed
 * since then has reopened the window, and a Claude reading past its hour is stale, whatever the report said.
 */
function windowNow({
  nowMs,
  modelHost,
  window,
}: {
  nowMs: number;
  modelHost: PlanUsageRow["modelHost"];
  window: PlanUsageWindow;
}):
  | PlanUsageWindow
  | { readonly kind: "reopened"; readonly label: PlanUsageWindow["label"]; readonly resetAtIso: string } {
  if (window.kind !== "measured" && window.kind !== "stale") {
    return window;
  }
  if (window.resetAtIso !== null && Date.parse(window.resetAtIso) <= nowMs) {
    return { kind: "reopened", label: window.label, resetAtIso: window.resetAtIso };
  }
  // No reset recorded: the window still reset within a week of the reading (`src/plans/planUsage.ts`'s `WEEK_MS`).
  if (window.resetAtIso === null && nowMs - Date.parse(window.observedAtIso) > WEEK_MS) {
    return { kind: "no-reading", label: window.label, reason: "older than a week" };
  }
  const aged = modelHost === "claude" && nowMs - Date.parse(window.observedAtIso) > CLAUDE_READING_FRESH_MS;
  if (window.kind === "measured" && aged) {
    return { ...window, kind: "stale", reason: "older than the hour a reading stays evidence" };
  }
  return window;
}

/** One window's clause, judged at the instant the menu is drawn. */
function windowClause({
  nowMs,
  modelHost,
  timeZone,
  window: reported,
}: {
  nowMs: number;
  modelHost: PlanUsageRow["modelHost"];
  timeZone: string | undefined;
  window: PlanUsageWindow;
}): string {
  const window = windowNow({ nowMs, modelHost, window: reported });
  const label = LABEL_WORD[window.label];
  switch (window.kind) {
    case "reopened":
      return `${label} reset ${atOf({ iso: window.resetAtIso, nowMs, timeZone })}, no reading since`;
    case "measured": {
      const used = `${label} ${String(window.usedPercent)}%`;
      // With no reset to bound it, the reading's own instant is the only age a reader has: always print it.
      if (window.resetAtIso === null) {
        return `${used} (read ${atOf({ iso: window.observedAtIso, nowMs, timeZone })}, reset unrecorded)`;
      }
      return `${used}, resets ${atOf({ iso: window.resetAtIso, nowMs, timeZone })}`;
    }
    case "stale":
      return `${label} ${String(window.usedPercent)}% (stale, read ${atOf({ iso: window.observedAtIso, nowMs, timeZone })})`;
    case "no-reading":
      return `${label} no reading`;
    case "unavailable":
      return `${label} unreadable`;
    default: {
      const unhandled: never = window;
      return unhandled;
    }
  }
}

/** One plan's line, in the precedence the module header gives. */
function rowLine({ nowMs, row, timeZone }: { nowMs: number; row: PlanUsageRow; timeZone: string | undefined }): string {
  if (row.usage.kind === "paused") {
    return `${row.alias} · paused: ${row.usage.reason}`;
  }
  if (row.signIn.kind === "needs-sign-in") {
    return `${row.alias} · needs sign-in: ${row.signIn.reason}`;
  }
  if (row.usage.kind === "not-measured") {
    return `${row.alias} · not measured: ${row.usage.reason}`;
  }
  const clauses = row.usage.windows.map((window) =>
    windowClause({ nowMs, modelHost: row.modelHost, timeZone, window }),
  );
  if (row.signIn.kind === "unknown") {
    clauses.push("sign-in unknown");
  }
  return [row.alias, ...clauses].join(" · ");
}

/** The headline's verdict over the rows: who needs a sign-in, or that every plan is signed in. */
function verdictOf({ rows }: { rows: readonly PlanUsageRow[] }): string {
  const live = rows.filter((row) => row.usage.kind !== "paused");
  const needs = live.filter((row) => row.signIn.kind === "needs-sign-in").length;
  const unknown = live.filter((row) => row.signIn.kind === "unknown").length;
  const parts: string[] = [];
  if (needs > 0) {
    parts.push(needs === 1 ? "1 needs sign-in" : `${String(needs)} need sign-in`);
  }
  if (unknown > 0) {
    parts.push(`${String(unknown)} sign-in unknown`);
  }
  if (parts.length === 0) {
    parts.push(`${String(live.length)} signed in`);
  }
  return parts.join(", ");
}

/**
 * The menu bar's plan lines for what the shell last learned.
 *
 * @param state the shell's last answer, or that none has arrived
 * @param nowMs the instant the menu is drawn, which ages the last answer
 * @param timeZone the zone times are read in; the machine's own when undefined
 * @returns the headline and the submenu's lines, which are empty when there is nothing under the headline
 */
export function planUsageTrayLines({
  nowMs,
  state,
  timeZone,
}: {
  nowMs: number;
  state: PlanUsageTrayState;
  timeZone: string | undefined;
}): PlanUsageTrayLines {
  switch (state.kind) {
    case "reading":
      return { headline: "Plans: reading", rows: [] };
    case "unavailable":
      return { headline: "Plans: unavailable", rows: [state.reason] };
    case "available": {
      const { reading } = state;
      if (reading.kind === "none-registered") {
        return { headline: "Plans: none registered", rows: [] };
      }
      const readAt = atOf({ iso: reading.observedAtIso, nowMs, timeZone });
      const rows = reading.rows.map((row) => rowLine({ nowMs, row, timeZone }));
      if (nowMs - state.receivedAtMs > STALE_AFTER_MS) {
        return { headline: `Plans: stale, last read ${readAt}`, rows };
      }
      return { headline: `Plans: ${verdictOf({ rows: reading.rows })} · read ${readAt}`, rows };
    }
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}
