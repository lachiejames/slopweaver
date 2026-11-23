/**
 * The cost explorer's half of `sync.ts`: read every dimension, then build the `ai-usage` and `ai-alert` kind
 * files and the gaps they owe.
 *
 * ## Every dollar is accounted for, including the ones not held as rows
 *
 * The API-key table is the one table held only in part (`aiUsage.ts`'s {@link TRELICA_AI_KEY_SPEND_FLOOR}):
 * MEASURED: the keys below the floor are per-run evaluation keys, so the table's key count grows with how
 * often evaluations run. So the keys below the floor are a coverage cell rather than a silence — their
 * count, the largest single one, and the most they could sum to — and a reader can tell the excluded tail
 * from a table the read never finished.
 *
 * ## Budgets are counted, never projected
 *
 * MEASURED: no read has yet answered a budget record, so there is no measured shape to project. A count is all that is stored, and the day one appears the run raises a gap
 * saying the shape is now there to measure, rather than guessing a schema for it in advance.
 */
import { err, ok, type Result } from "../../lib/result.js";

import {
  TRELICA_AI_BUDGET_SURFACE,
  type TrelicaAiRunInput,
  trelicaAiAlertCells,
  trelicaAiBudgetCell,
  trelicaAiCallResult,
  trelicaAiUsageCells,
} from "./aiCoverage.js";
import { projectTrelicaAiAlerts, projectTrelicaAiUsage } from "./aiProjection.js";
import { TRELICA_AI_KEY_SPEND_FLOOR, type TrelicaAiWindow, trelicaAiUsageCallId } from "./aiUsage.js";
import type { TrelicaCallResult, TrelicaClient } from "./client.js";
import { withTrelicaCoverageCell } from "./coverage.js";
import type { TrelicaAtlasError } from "./errors.js";
import { openTrelicaGap, type TrelicaGapRecheck } from "./gaps.js";
import { TRELICA_CALLS } from "./inventory.js";
import { mergeTrelicaChannel } from "./merge.js";
import {
  TRELICA_AI_USAGE_DIMENSIONS,
  type TrelicaAiUsageDimension,
  type TrelicaAtlasEntity,
  type TrelicaAtlasGap,
  type TrelicaAtlasKindFile,
  type TrelicaCoverageCell,
} from "./model.js";
import type { TrelicaAiUsageResult } from "./usageWalk.js";

/** What the cost explorer's half of one run collected. */
export interface TrelicaAiReads {
  readonly usage: readonly TrelicaAiUsageResult[];
  readonly failures: readonly { readonly callId: string; readonly error: TrelicaAtlasError }[];
}

/**
 * Make every cost-explorer read, keeping a failure rather than aborting the run.
 *
 * @param client the session-holding client
 * @param window the run's window
 * @returns what answered and what did not
 */
export async function readTrelicaAiUsage({
  client,
  window,
}: {
  client: TrelicaClient;
  window: TrelicaAiWindow;
}): Promise<TrelicaAiReads> {
  const usage: TrelicaAiUsageResult[] = [];
  const failures: { callId: string; error: TrelicaAtlasError }[] = [];
  for (const dimension of TRELICA_AI_USAGE_DIMENSIONS) {
    const stopBelowSpend = dimension === "api-key" ? TRELICA_AI_KEY_SPEND_FLOOR : null;
    const answered = await client.usage({ dimension, stopBelowSpend, window });
    if (answered.isErr()) {
      failures.push({ callId: trelicaAiUsageCallId({ dimension }), error: answered.error });
      continue;
    }
    usage.push(answered.value);
  }
  return { failures, usage };
}

/**
 * One usage read as the call it was, so the method map records it as an operation this atlas made.
 *
 * @param result what the read returned
 * @returns the read in the shape every other admitted call is projected from
 */
export function trelicaAiUsageAsCall({ result }: { result: TrelicaAiUsageResult }): TrelicaCallResult {
  return {
    callId: trelicaAiUsageCallId({ dimension: result.dimension }),
    httpMethod: "POST",
    items: result.rows,
    path: result.path,
    statusCode: result.statusCode,
    total: result.total,
  };
}

/** The two kind files, and the counts the outcome reports. */
export interface TrelicaAiKindFiles {
  readonly usageFile: TrelicaAtlasKindFile;
  readonly alertFile: TrelicaAtlasKindFile;
  readonly freshUsage: number;
  readonly freshAlerts: number;
  readonly unprojected: ReadonlyMap<TrelicaAiUsageDimension, number>;
}

/** A kind file with the given cells replaced, the given entities installed, and nothing else touched. */
function kindFileWith({
  stored,
  entities,
  cells,
  at,
}: {
  stored: TrelicaAtlasKindFile;
  entities: readonly TrelicaAtlasEntity[];
  cells: readonly TrelicaCoverageCell[];
  at: string;
}): TrelicaAtlasKindFile {
  const coverage = cells.reduce(
    (held: readonly TrelicaCoverageCell[], replacement) => withTrelicaCoverageCell({ cells: held, replacement }),
    stored.coverage,
  );
  return { ...stored, coverage: [...coverage], entities: [...entities], updatedAt: at };
}

/** Every usage dimension projected, with its coverage cells and how many rows it could not hold. */
function projectedUsage({ run, at }: { run: TrelicaAiRunInput; at: string }): {
  usage: TrelicaAtlasEntity[];
  cells: TrelicaCoverageCell[];
  unprojected: Map<TrelicaAiUsageDimension, number>;
} {
  const usage: TrelicaAtlasEntity[] = [];
  const cells: TrelicaCoverageCell[] = [];
  const unprojected = new Map<TrelicaAiUsageDimension, number>();
  for (const dimension of TRELICA_AI_USAGE_DIMENSIONS) {
    const result = run.usage.find((entry) => entry.dimension === dimension);
    const minimumSpend = dimension === "api-key" ? TRELICA_AI_KEY_SPEND_FLOOR : null;
    const projected =
      result === undefined ? null : projectTrelicaAiUsage({ at, minimumSpend, result, window: run.window });
    const held = projected === null ? 0 : projected.entities.length;
    usage.push(...(projected === null ? [] : projected.entities));
    unprojected.set(dimension, projected === null ? 0 : projected.unprojected);
    cells.push(...trelicaAiUsageCells({ at, dimension, held, run }));
  }
  return { cells, unprojected, usage };
}

/**
 * Project and merge the cost explorer's answers into the `ai-usage` and `ai-alert` kind files.
 *
 * @param storedUsage the `ai-usage` file as the generation holds it
 * @param storedAlerts the `ai-alert` file as the generation holds it
 * @param run what the cost-explorer reads returned
 * @param at this run's ISO timestamp
 * @returns both files and the counts, or the first reason a merge could not be made
 */
export function trelicaAiKindFiles({
  storedUsage,
  storedAlerts,
  run,
  at,
}: {
  storedUsage: TrelicaAtlasKindFile;
  storedAlerts: TrelicaAtlasKindFile;
  run: TrelicaAiRunInput;
  at: string;
}): Result<TrelicaAiKindFiles> {
  const { usage, cells, unprojected } = projectedUsage({ at, run });
  cells.push(trelicaAiBudgetCell({ at, run }));
  const mergedUsage = mergeTrelicaChannel({
    at,
    channel: "first-party-api",
    observed: usage,
    stored: storedUsage.entities,
  });
  if (mergedUsage.isErr()) {
    return err(mergedUsage.error);
  }
  const alertRecords = [TRELICA_CALLS.aiAlertsSpike.id, TRELICA_CALLS.aiAlertsBudget.id].flatMap((callId) => {
    const answered = trelicaAiCallResult({ callId, run });
    return answered === null ? [] : answered.items;
  });
  const alerts = projectTrelicaAiAlerts({ at, endpoint: TRELICA_CALLS.aiAlertsSpike.path, records: alertRecords });
  const mergedAlerts = mergeTrelicaChannel({
    at,
    channel: "first-party-api",
    observed: alerts,
    stored: storedAlerts.entities,
  });
  if (mergedAlerts.isErr()) {
    return err(mergedAlerts.error);
  }
  const alertCells = trelicaAiAlertCells({ at, run });
  return ok({
    alertFile: kindFileWith({ at, cells: alertCells, entities: mergedAlerts.value, stored: storedAlerts }),
    freshAlerts: alerts.length,
    freshUsage: usage.length,
    unprojected,
    usageFile: kindFileWith({ at, cells, entities: mergedUsage.value, stored: storedUsage }),
  });
}

/**
 * The gaps the cost explorer's half of a run observed, and the conditions it genuinely rechecked.
 *
 * @param run what the cost-explorer reads returned
 * @param unprojected how many rows each dimension's projection could not hold
 * @param at this run's ISO timestamp
 * @returns the observed gaps and the rechecks that may close earlier ones
 */
export function trelicaAiGaps({
  run,
  unprojected,
  at,
}: {
  run: TrelicaAiRunInput;
  unprojected: ReadonlyMap<TrelicaAiUsageDimension, number>;
  at: string;
}): { observed: readonly TrelicaAtlasGap[]; rechecks: readonly TrelicaGapRecheck[] } {
  const observed: TrelicaAtlasGap[] = [];
  const rechecks: TrelicaGapRecheck[] = [];
  const budgets = trelicaAiCallResult({ callId: TRELICA_CALLS.aiBudgets.id, run });
  if (budgets !== null) {
    rechecks.push({
      condition: "ai-budget-shape-unmeasured",
      resolved: budgets.items.length === 0,
      scope: TRELICA_AI_BUDGET_SURFACE,
    });
  }
  if (budgets !== null && budgets.items.length > 0) {
    observed.push(
      openTrelicaGap({
        at,
        condition: "ai-budget-shape-unmeasured",
        fields: [],
        kind: "ai-usage",
        reason: `${String(budgets.items.length)} AI-spend budget(s) now exist and are only counted: measure one record's shape and add a projection for it`,
        scope: TRELICA_AI_BUDGET_SURFACE,
        surfaces: ["first-party-api"],
      }),
    );
  }
  for (const result of run.usage) {
    const count = unprojected.get(result.dimension);
    const scope = trelicaAiUsageCallId({ dimension: result.dimension });
    rechecks.push({ condition: "ai-usage-row-unprojected", resolved: count === 0, scope });
    if (count !== undefined && count > 0) {
      observed.push(
        openTrelicaGap({
          at,
          condition: "ai-usage-row-unprojected",
          fields: [],
          kind: "ai-usage",
          reason: `${String(count)} ${result.dimension} row(s) carried no key, no label or an incomplete set of figures, and were left out rather than zero-filled`,
          scope,
          surfaces: ["first-party-api"],
        }),
      );
    }
  }
  return { observed, rechecks };
}
