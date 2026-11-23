/**
 * The cost explorer's org-wide reads — one per dimension it groups AI spend by — and the ONLY body any of
 * them is ever sent.
 *
 * ## Why these are a second table rather than rows in `inventory.ts`
 *
 * MEASURED, after the tenant granted this account its AI Consumption permission: every read here
 * is a `POST` whose body carries a date window and pages its table INSIDE that body (`tableSkip`,
 * `tableTake`), answering `{granularity, usageByDate, rows: {items, total}}` rather than the `{items, total}`
 * page every `inventory.ts` row walks with a query string. So the paging is a different loop, and the body
 * is the one thing a run must vary — the window ends today.
 *
 * The property `inventory.ts` holds survives that: a caller names a DIMENSION, never a path, and the body is
 * built here from a fixed template plus a window {@link trelicaAiWindow} derives from an instant. Neither
 * input can name an endpoint or add a field. The same client service also declares `GenerateSampleData`
 * and per-application `{id}/…` reads; none is listed, so none is reachable.
 *
 * ## The window is two years, and its granularity is the explorer's choice
 *
 * The explorer picks the granularity of its series from the window's length: thirty days answered `Daily`,
 * a window of about two years `Monthly`, one reaching back six years `Yearly`. The trailing two-year window held every dollar of
 * AI spend the longer yearly window found (MEASURED by comparing the two), so it holds the whole record while
 * keeping a monthly series. The granularity actually answered is stored rather than assumed.
 */
import { yyyyMmDdTodayPlus } from "#lib/date.js";

import type { TrelicaAiUsageDimension } from "./model.js";

/** One org-wide cost-explorer read. */
export interface TrelicaAiUsageRead {
  readonly dimension: TrelicaAiUsageDimension;
  /** The path beneath the tenant origin. */
  readonly path: string;
  /** Why reading this changes nothing. Checked by a reviewer against the row, not against a call site. */
  readonly whyRead: string;
}

/** The read the explorer's Overview tab makes for every grouping it offers, organisation-wide. */
const WHY =
  "aggregates the AI spend and token usage this tenant has already recorded over a date window, grouped one way — the POST carries the window because the platform's own cost explorer reads this way, and it is the table that page renders";

/**
 * Every cost-explorer read this atlas may make, keyed by dimension.
 *
 * @internal
 */
export const TRELICA_AI_USAGE_READS: Readonly<Record<TrelicaAiUsageDimension, TrelicaAiUsageRead>> = Object.freeze({
  "api-key": Object.freeze({ dimension: "api-key", path: "/AppsApi/AppAIUsage/UsageByApiKey", whyRead: WHY }),
  app: Object.freeze({ dimension: "app", path: "/AppsApi/AppAIUsage/UsageByApp", whyRead: WHY }),
  "cost-center": Object.freeze({
    dimension: "cost-center",
    path: "/AppsApi/AppAIUsage/UsageByCostCenter",
    whyRead: WHY,
  }),
  model: Object.freeze({ dimension: "model", path: "/AppsApi/AppAIUsage/UsageByModel", whyRead: WHY }),
  person: Object.freeze({ dimension: "person", path: "/AppsApi/AppAIUsage/UsageByPerson", whyRead: WHY }),
  team: Object.freeze({ dimension: "team", path: "/AppsApi/AppAIUsage/UsageByTeam", whyRead: WHY }),
});

/**
 * The call id a usage read is journalled under and its boundary is bound to, so a refusal names the dimension.
 *
 * @param dimension the read's dimension
 * @returns `ai-usage:<dimension>`
 */
export function trelicaAiUsageCallId({ dimension }: { dimension: TrelicaAiUsageDimension }): string {
  return `ai-usage:${dimension}`;
}

/**
 * How many days back the window reaches.
 *
 * Two years, so the explorer answers a `Monthly` series (MEASURED: a two-year window answered
 * `Monthly`; one reaching back six years `Yearly`) while holding every dollar the yearly window recorded.
 * Reproduce with `slopweaver atlas trelica sync` and read the `granularity` an `ai-usage` row stores.
 *
 * @internal
 */
export const TRELICA_AI_WINDOW_DAYS = 730;

/**
 * How many table rows one page asks for. The explorer's own client asks for ten; two hundred keeps the
 * API-key table, sorted by spend, to fewer pages before the spend floor stops the walk.
 *
 * @internal
 */
export const TRELICA_AI_TABLE_TAKE = 200;

/**
 * How many series rows the explorer charts. Its own client asks for six; the table is unaffected.
 *
 * @internal
 */
export const TRELICA_AI_TOP_N = 6;

/**
 * The spend below which an API key is no longer held as its own entity.
 *
 * MEASURED: over the window, a short head of keys by spend carries the money and the long tail below the
 * floor is per-run evaluation keys. Holding them would be one entity per evaluation run, each saying almost
 * nothing. The tail is still accounted for: its count
 * and its summed spend are a coverage cell, so no dollar goes unreported. Reproduce with
 * `slopweaver atlas trelica sync` and read the `api-key` coverage cell on the `ai-usage` kind.
 *
 * @internal
 */
export const TRELICA_AI_KEY_SPEND_FLOOR = 1;

/** A date window, both ends `YYYY-MM-DD`, inclusive. */
export interface TrelicaAiWindow {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * The window one run reads: {@link TRELICA_AI_WINDOW_DAYS} days ending on the run's own day.
 *
 * @param at this run's ISO instant
 * @returns the window, both ends as calendar dates in UTC
 */
export function trelicaAiWindow({ at }: { at: string }): TrelicaAiWindow {
  const now = new Date(at);
  return {
    endDate: yyyyMmDdTodayPlus({ days: 0, now }),
    startDate: yyyyMmDdTodayPlus({ days: -TRELICA_AI_WINDOW_DAYS, now }),
  };
}

/**
 * The body one page of one read is sent. The template is fixed; only the window and the offset vary.
 *
 * @param window the run's window
 * @param tableSkip how many table rows earlier pages already returned
 * @returns the JSON body
 */
export function trelicaAiUsageBody({
  window,
  tableSkip,
}: {
  window: TrelicaAiWindow;
  tableSkip: number;
}): Readonly<Record<string, unknown>> {
  return {
    endDate: window.endDate,
    includeTableData: true,
    startDate: window.startDate,
    tableSkip,
    tableTake: TRELICA_AI_TABLE_TAKE,
    topN: TRELICA_AI_TOP_N,
  };
}
