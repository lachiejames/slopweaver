/**
 * The coverage cells the cost explorer's half of a sync owns: one per usage dimension, the excluded API-key
 * tail, the budget count, and one per alert type.
 *
 * Each cell SAYS what it counted rather than only how it graded — a usage cell names how many rows were held
 * against the explorer's own total and the window they span, and the tail cell names the most the excluded
 * keys could sum to — so a reader can tell a deliberate exclusion from a read that never finished.
 */
import { TRELICA_AI_KEY_SPEND_FLOOR, type TrelicaAiWindow } from "./aiUsage.js";
import type { TrelicaCallResult } from "./client.js";
import { succeededTrelicaCoverageCell } from "./coverage.js";
import { TRELICA_CALLS } from "./inventory.js";
import type { TrelicaAiUsageDimension, TrelicaCoverageCell } from "./model.js";
import { type TrelicaAiUsageResult, trelicaAiRowSpend } from "./usageWalk.js";

/**
 * The surface the budget count is reported under, and the scope its gap is raised on.
 *
 * @internal
 */
export const TRELICA_AI_BUDGET_SURFACE = "ai-budgets";

/** What the cost explorer's half of a run hands the publisher. */
export interface TrelicaAiRunInput {
  readonly window: TrelicaAiWindow;
  readonly usage: readonly TrelicaAiUsageResult[];
  /** Every admitted call's result; the alert and budget rows are read out of it by id. */
  readonly results: readonly TrelicaCallResult[];
}

/**
 * The answered result for one admitted call.
 *
 * @param run what the run collected
 * @param callId the call to find
 * @returns its result, or `null` when it did not answer
 */
export function trelicaAiCallResult({
  run,
  callId,
}: {
  run: TrelicaAiRunInput;
  callId: string;
}): TrelicaCallResult | null {
  const found = run.results.find((result) => result.callId === callId);
  if (found === undefined) {
    return null;
  }
  return found;
}

/** The spend summed across one table's rows, skipping any that carry none. */
function spendOf({ rows }: { rows: readonly unknown[] }): number {
  return rows.reduce((total: number, row) => {
    const spend = trelicaAiRowSpend({ row });
    return spend === null ? total : total + spend;
  }, 0);
}

/** The series granularity the explorer charted, or that it charted none. */
function seriesLabel({ granularity }: { granularity: string | null }): string {
  if (granularity === null) {
    return "not charted";
  }
  return granularity;
}

/** Dollars, to the cent — or to four places under a cent, where the tail's largest key can live. */
function dollars({ amount }: { amount: number }): string {
  const subCent = amount > 0 && amount < 0.01;
  return `$${amount.toFixed(subCent ? 4 : 2)}`;
}

/**
 * One dimension's coverage cell, plus the API-key tail's when the dimension is `api-key`.
 *
 * @param run what the run collected
 * @param dimension the dimension to report
 * @param held how many of its rows the projection held
 * @param at this run's ISO timestamp
 * @returns the cells, deferred when the read did not answer
 */
export function trelicaAiUsageCells({
  run,
  dimension,
  held,
  at,
}: {
  run: TrelicaAiRunInput;
  dimension: TrelicaAiUsageDimension;
  held: number;
  at: string;
}): readonly TrelicaCoverageCell[] {
  const result = run.usage.find((entry) => entry.dimension === dimension);
  const span = `${run.window.startDate}..${run.window.endDate}`;
  const cell = ({
    surface,
    reason,
    state,
  }: Pick<TrelicaCoverageCell, "surface" | "reason" | "state">): TrelicaCoverageCell =>
    succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "first-party-api",
      reason,
      role: "authoritative",
      scope: dimension,
      state,
      surface,
    });
  if (result === undefined) {
    const reason = `the ${dimension} read did not answer this run, so its rows are as the last run that read them left them`;
    return [cell({ reason, state: "deferred", surface: `ai-usage:${dimension}` })];
  }
  const total = result.total === null ? "an unstated number of" : String(result.total);
  const series = seriesLabel({ granularity: result.granularity });
  // A team table's own rows are the roots of its tree, so summing them never counts a child twice.
  const reason =
    `${String(held)} ${dimension} row(s) held of ${total} over ${span}; ` +
    `${dollars({ amount: spendOf({ rows: result.rows }) })} across the rows read; series ${series}`;
  // Only the API-key read stops early on purpose; any other table read short hit the page bound.
  const short = dimension !== "api-key" && result.total !== null && result.rows.length < result.total;
  const own = cell({ reason, state: short ? "deferred" : "synced", surface: `ai-usage:${dimension}` });
  return dimension === "api-key" ? [own, keyTailCell({ at, result })] : [own];
}

/**
 * The excluded API-key tail: its count, its largest row, and the most it could sum to.
 *
 * The tail is the explorer's total less every key READ that is not under the floor — not less the keys
 * HELD — so a key over the floor that the projection could not hold stays the unprojected gap's, and never
 * inflates a bound that assumes every tail key is worth at most the largest one under the floor.
 */
function keyTailCell({ result, at }: { result: TrelicaAiUsageResult; at: string }): TrelicaCoverageCell {
  const spends = result.rows.map((row) => trelicaAiRowSpend({ row }));
  const below = spends.filter((spend): spend is number => spend !== null && spend < TRELICA_AI_KEY_SPEND_FLOOR);
  // A row read with no spend at all is the unprojected gap's too: its worth is unknown, so it bounds nothing.
  const notBelow = spends.length - below.length;
  const largest = below.length === 0 ? 0 : Math.max(...below);
  const tail = result.total === null ? 0 : Math.max(result.total - notBelow, 0);
  // A walk that ended at its page bound before any key fell under the floor bounds nothing it did not read.
  const unbounded = below.length === 0 && tail > 0;
  let reason =
    `${String(tail)} API key(s) each spending under ${dollars({ amount: TRELICA_AI_KEY_SPEND_FLOOR })} over the window are counted and not held; ` +
    `the table is sorted by spend, the largest of them is ${dollars({ amount: largest })}, so together they are at most ` +
    `${dollars({ amount: tail * largest })}`;
  if (unbounded) {
    reason = `${String(tail)} API key(s) were never read: the walk reached its page bound before any key fell under ${dollars({ amount: TRELICA_AI_KEY_SPEND_FLOOR })}, so their spend is unbounded`;
  }
  return succeededTrelicaCoverageCell({
    artifacts: [],
    at,
    channel: "first-party-api",
    reason,
    role: "discovery",
    scope: "api-key-under-floor",
    state: unbounded ? "deferred" : "excluded",
    surface: "ai-usage:api-key-tail",
  });
}

/**
 * The budget count's cell: synced at zero, deferred when refused or when budgets exist to be measured.
 *
 * @param run what the run collected
 * @param at this run's ISO timestamp
 * @returns the cell
 */
export function trelicaAiBudgetCell({ run, at }: { run: TrelicaAiRunInput; at: string }): TrelicaCoverageCell {
  const budgets = trelicaAiCallResult({ callId: TRELICA_CALLS.aiBudgets.id, run });
  const count = budgets === null ? null : budgets.items.length;
  let reason = "the budget read did not answer this run";
  if (count !== null) {
    reason =
      count === 0
        ? "no AI-spend budget in any status, so there is no record shape to hold"
        : `${String(count)} AI-spend budget(s) exist and are counted, not held: no budget record had been seen when this projection was written`;
  }
  return succeededTrelicaCoverageCell({
    artifacts: [],
    at,
    channel: "first-party-api",
    reason,
    role: "authoritative",
    scope: TRELICA_AI_BUDGET_SURFACE,
    state: count === 0 ? "synced" : "deferred",
    surface: TRELICA_AI_BUDGET_SURFACE,
  });
}

/**
 * The two alert types' cells.
 *
 * @param run what the run collected
 * @param at this run's ISO timestamp
 * @returns one cell per alert history read
 */
export function trelicaAiAlertCells({
  run,
  at,
}: {
  run: TrelicaAiRunInput;
  at: string;
}): readonly TrelicaCoverageCell[] {
  return [TRELICA_CALLS.aiAlertsSpike, TRELICA_CALLS.aiAlertsBudget].map((call) => {
    const answered = trelicaAiCallResult({ callId: call.id, run });
    return succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "first-party-api",
      reason:
        answered === null
          ? `the ${call.id} read did not answer this run`
          : `${String(answered.items.length)} alert(s) of type ${call.query.type} in the explorer's history`,
      role: "authoritative",
      scope: call.id,
      state: answered === null ? "deferred" : "synced",
      surface: call.id,
    });
  });
}
