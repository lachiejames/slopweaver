/**
 * What one `handover wake` run comes to, as a document: counted off the row loop's reports (`./wakeRows.ts`), and
 * printed as `--json` or as one line per row and a summary. Apart from `./wakeRun.ts`'s parsing and exit, so the
 * report a scheduler reads and the lines a chair reads are built in one place.
 */
import { parkWakePhrase } from "../../../handover/parkWake.js";
import type { WakeBudget } from "./wakeDueRow.js";
import {
  type ReconciliationCounts,
  reconciliationCounts,
  reconciliationPhrase,
  reconciliationSummary,
} from "./wakeReconcile.js";
import type { WakeRetry } from "./wakeRetry.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** The one document `--json` prints. */
export interface WakeReport {
  readonly observedAtIso: string;
  readonly dryRun: boolean;
  /** How many reseats this run could attempt: the wake's share of the boot window less {@link bootsInFlight}. */
  readonly maxSpawns: number;
  /** Claude sessions that started inside the 180-second boot window as the run began; 0 when nothing was due. */
  readonly bootsInFlight: number;
  readonly due: number;
  readonly attempted: number;
  readonly spawned: number;
  /** Parks retired because `cmux spawn` would refuse them forever, or that would be on a dry run. */
  readonly cleared: number;
  /** Merged pull requests' parks the real `handover finish` closed without a reseat, or would on a dry run. */
  readonly finished: number;
  /** Merged pull requests' parks whose wake was suspended on the owner's open question, or would be on a dry run. */
  readonly suspended: number;
  readonly rows: readonly WakeRowReport[];
  /** Slugs two docs share: no lifecycle verb can resolve one, so none is woken. */
  readonly duplicateSlugs: readonly string[];
  /** Slugs whose journal carries a line this build cannot read: never judged, each named. */
  readonly unreadable: readonly string[];
  /** The deferred attempt a `--retry` named, and how long it waited for the backoff. */
  readonly retry?: WakeRetry;
  /** Whether this was a `--settle-only` run, which reseats nothing. */
  readonly settleOnly: boolean;
  /** What the reconcile of parks on ended pull requests came to (`../../../handover/parkedLanding.ts`). */
  readonly reconciliation: ReconciliationCounts;
}

/** The actions that closed a merged park's run without a reseat, or would have on a dry run. */
const FINISH_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set(["finished", "would-finish"]);

/** The actions that suspended a park's wake on the owner's open question, or would have on a dry run. */
const SUSPEND_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set(["wake-suspended", "would-suspend"]);

/**
 * The report one wake pass comes to, counted off its rows.
 *
 * @param pass what the row loop came to: its reports, attempts, clears and boot budget
 * @param now the instant the run judged its rows at
 * @returns the report `printReport` prints and the verb's exit reads
 */
export function wakeReport({
  dryRun,
  duplicateSlugs,
  now,
  pass,
  retry,
  settleOnly,
  unreadable,
}: {
  dryRun: boolean;
  duplicateSlugs: readonly string[];
  now: Date;
  pass: {
    readonly attempted: number;
    readonly budget: WakeBudget;
    readonly cleared: number;
    readonly rows: readonly WakeRowReport[];
  };
  retry: WakeRetry | undefined;
  settleOnly: boolean;
  unreadable: readonly string[];
}): WakeReport {
  const { attempted, budget, cleared, rows } = pass;
  return {
    reconciliation: reconciliationCounts({ rows }),
    settleOnly,
    attempted,
    bootsInFlight: budget.bootsInFlight,
    cleared,
    dryRun,
    due: rows.filter((row) => row.judgement.kind === "due").length,
    duplicateSlugs,
    finished: rows.filter((row) => FINISH_ACTIONS.has(row.action)).length,
    maxSpawns: budget.budget,
    observedAtIso: now.toISOString(),
    rows,
    spawned: rows.filter((row) => row.action === "spawned").length,
    suspended: rows.filter((row) => SUSPEND_ACTIONS.has(row.action)).length,
    unreadable,
    ...(retry === undefined ? {} : { retry }),
  };
}

/** The output channels the report is printed on. */
type ReportChannels = Pick<HandoverWakeDeps, "writeDiagnostic" | "writeOut">;

/**
 * Print the report: one `--json` document, or one line per row and a summary.
 *
 * @param deps the output and diagnostic channels
 * @param json whether to print the one `--json` document instead of lines
 */
export function printReport({ deps, json, report }: { deps: ReportChannels; json: boolean; report: WakeReport }): void {
  if (json) {
    deps.writeOut(JSON.stringify(report, null, 2));
    return;
  }
  for (const row of report.rows) {
    printRowLines({ deps, row });
  }
  if (report.retry !== undefined) {
    deps.writeOut(
      `handover wake --retry ${report.retry.nonce}: waited ${String(report.retry.waitedMs)}ms for the backoff opening ${report.retry.retryAfterIso}`,
    );
  }
  for (const slug of report.duplicateSlugs) {
    deps.writeDiagnostic(`handover wake: ${slug} names two docs, so it is never woken — rename one`);
  }
  for (const name of report.unreadable) {
    deps.writeDiagnostic(`handover wake: ${name} did not read, so any park on it is not judged`);
  }
  const mode = report.dryRun ? " (dry run)" : "";
  const settleOnly = report.settleOnly ? " --settle-only" : "";
  deps.writeOut(
    `handover wake${settleOnly}${mode}: ${String(report.rows.length)} waking park(s), ${String(report.due)} due, ` +
      `${String(report.attempted)} of ${String(report.maxSpawns)} attempted, ${String(report.spawned)} reseated, ` +
      `${String(report.finished)} finished without a reseat, ${String(report.cleared)} cleared, ` +
      `${String(report.suspended)} suspended on the owner's question`,
  );
  const summary = reconciliationSummary({ counts: report.reconciliation, mode, rows: report.rows });
  if (summary !== undefined) {
    deps.writeOut(summary);
  }
}

/** One row's text lines: its verdict and action, then what its reconcile came to and its retry, when it has them. */
function printRowLines({ deps, row }: { deps: ReportChannels; row: WakeRowReport }): void {
  const verdict = VERDICT_WORDS[row.judgement.kind];
  deps.writeOut(
    `  ${row.slug} — parked ${parkWakePhrase({ wake: row.wake })}: ${verdict}, ${row.action} (${row.detail})`,
  );
  if (row.reconciliation !== undefined) {
    deps.writeOut(`    reconcile: ${reconciliationPhrase({ landing: row.reconciliation })}`);
  }
  if (row.action === "spawn-deferred" && row.attemptNonce !== undefined && row.retryAfterIso !== undefined) {
    deps.writeOut(
      `    retry: slopweaver handover wake --retry ${row.attemptNonce} (backoff opens ${row.retryAfterIso})`,
    );
  }
}

/** How a row's judgement reads in the text report. */
const VERDICT_WORDS: { readonly [K in WakeRowReport["judgement"]["kind"]]: string } = {
  due: "due",
  "not-due": "not-due",
  "not-judged": "SKIPPED",
  unknown: "UNKNOWN",
};
