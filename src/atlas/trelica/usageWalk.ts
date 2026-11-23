/**
 * The cost-explorer half of the client: one read walks its table inside the request body, page by page, and every
 * page is admitted by its dimension's strict boundary before a row of it is held.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { trelicaBoundaryRefusal, trelicaViewList } from "./admission.js";
import { TRELICA_AI_USAGE_READS, type TrelicaAiWindow, trelicaAiUsageBody, trelicaAiUsageCallId } from "./aiUsage.js";
import { TRELICA_AI_USAGE_BOUNDARIES } from "./aiUsageBoundaries.js";
import type { TrelicaHttp } from "./client.js";
import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";
import type { TrelicaAiUsageDimension } from "./model.js";

/** What one cost-explorer read returned. */
export interface TrelicaAiUsageResult {
  readonly dimension: TrelicaAiUsageDimension;
  readonly path: string;
  readonly statusCode: number;
  /** Every table row returned, across every page walked, as the dimension boundary's census view. */
  readonly rows: readonly unknown[];
  /** The row count the explorer itself stated for the whole window. */
  readonly total: number | null;
  /** The charted series — the explorer's top rows, each with its spend by period — as the census view. */
  readonly series: readonly unknown[];
  /** The period the series is bucketed by, as the explorer chose it for this window. */
  readonly granularity: string | null;
  /** Whether paging stopped at the spend floor rather than at the end of the table. */
  readonly stoppedAtFloor: boolean;
}

/** One cost-explorer page as admitted, its table and series as the census view. */
interface TrelicaUsagePage {
  readonly rows: readonly unknown[];
  readonly total: number;
  readonly series: readonly unknown[];
  readonly granularity: string;
}

/**
 * The spend one table row reports, or `null` when it carries none.
 *
 * @param row one cost-explorer table row
 * @returns its `metrics.spend`
 *
 * @internal
 */
export function trelicaAiRowSpend({ row }: { row: unknown }): number | null {
  if (!isRecord(row) || !isRecord(row["metrics"])) {
    return null;
  }
  const spend = row["metrics"]["spend"];
  return typeof spend === "number" && Number.isFinite(spend) ? spend : null;
}

/** POST one cost-explorer page, turning every non-success into a typed refusal. */
async function fetchUsagePage({
  dimension,
  window,
  tableSkip,
  headers,
  http,
  tenantOrigin,
}: {
  dimension: TrelicaAiUsageDimension;
  window: TrelicaAiWindow;
  tableSkip: number;
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
}): Promise<Result<{ statusCode: number; parsed: TrelicaUsagePage }, TrelicaAtlasError>> {
  const callId = trelicaAiUsageCallId({ dimension });
  // The endpoint and the boundary are both looked up by the one dimension, and both must name it back before the
  // request, so a path is never admitted through another dimension's boundary.
  const read = TRELICA_AI_USAGE_READS[dimension];
  const boundary = TRELICA_AI_USAGE_BOUNDARIES[dimension];
  if (read.dimension !== dimension || boundary.callId !== callId) {
    return err(TrelicaAtlasErrors.boundaryUnbound({ boundaryCallId: boundary.callId, callId }));
  }
  const response = await http({
    body: JSON.stringify(trelicaAiUsageBody({ tableSkip, window })),
    headers,
    method: "POST",
    url: `${tenantOrigin}${read.path}`,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const { statusCode } = response.value;
  if (statusCode < 200 || statusCode >= 300) {
    return err(TrelicaAtlasErrors.callRefused({ callId, statusCode }));
  }
  const admitted = boundary.parseJson({ text: response.value.text });
  if (admitted.isErr()) {
    return err(trelicaBoundaryRefusal({ callId, error: admitted.error }));
  }
  const view = boundary.censusView({ value: admitted.value });
  const table = isRecord(view) ? view["rows"] : null;
  return ok({
    parsed: {
      granularity: admitted.value.granularity,
      rows: trelicaViewList({ key: "items", view: table }),
      series: trelicaViewList({ key: "usageByDate", view }),
      total: admitted.value.rows.total,
    },
    statusCode,
  });
}

/**
 * Walk one cost-explorer read's table, page by page, under the same bound as every other call, admitting each page
 * through its dimension's strict boundary.
 *
 * @param dimension the cost-explorer row to walk, which picks both its endpoint and its boundary
 * @param stopBelowSpend stop paging once a row falls below this spend; `null` walks the whole table
 * @param maxPages the most pages one call may walk before it stops asking
 * @returns the table rows, the series and the granularity, or why the read did not answer
 */
export async function walkTrelicaUsageTable({
  dimension,
  window,
  stopBelowSpend,
  headers,
  http,
  tenantOrigin,
  maxPages,
}: {
  dimension: TrelicaAiUsageDimension;
  window: TrelicaAiWindow;
  stopBelowSpend: number | null;
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
  maxPages: number;
}): Promise<Result<TrelicaAiUsageResult, TrelicaAtlasError>> {
  const rows: unknown[] = [];
  let granularity: string | null = null;
  let series: readonly unknown[] = [];
  let total: number | null = null;
  let statusCode = 0;
  let stoppedAtFloor = false;
  for (let page = 0; page < maxPages; page += 1) {
    const answered = await fetchUsagePage({ dimension, headers, http, tableSkip: rows.length, tenantOrigin, window });
    if (answered.isErr()) {
      return err(answered.error);
    }
    ({ statusCode } = answered.value);
    const { parsed } = answered.value;
    if (page === 0) {
      ({ granularity, series, total } = parsed);
    }
    rows.push(...parsed.rows);
    stoppedAtFloor =
      stopBelowSpend !== null &&
      parsed.rows.some((row) => {
        const spend = trelicaAiRowSpend({ row });
        return spend !== null && spend < stopBelowSpend;
      });
    const exhausted = parsed.rows.length === 0 || rows.length >= parsed.total;
    if (exhausted || stoppedAtFloor) {
      break;
    }
  }
  return ok({
    dimension,
    granularity,
    path: TRELICA_AI_USAGE_READS[dimension].path,
    rows,
    series,
    statusCode,
    stoppedAtFloor,
    total,
  });
}
