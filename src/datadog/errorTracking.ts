/**
 * Error Tracking's issue list, read through the SDK's `ErrorTrackingApi.searchIssues` — the list the owner
 * reads as "For Review", with each issue's event count over a window, its service, its first-seen instant and
 * the state a triage moves it to.
 *
 * ## Why the console's words and not the API's
 *
 * The API says `OPEN`, `ACKNOWLEDGED`, `IGNORED`, `RESOLVED`, `EXCLUDED`; the console the owner reads says
 * "For Review", "Reviewed", "Ignored", "Resolved", "Excluded". A batch card that says `ACKNOWLEDGED` makes a
 * reader translate before they can act, so every rendering here uses {@link ERROR_TRACKING_STATE_LABELS} and
 * the flag takes the console's word in kebab case.
 *
 * ## Why the search result and the issue are joined here
 *
 * The search answers `data[]` — an id and a window count — and puts each issue's own attributes in
 * `included[]` only when asked for with `include=issue`. A hit whose issue is missing from `included` is a
 * malformed answer, never a row with blank fields: a batch that drafted a fix for "(unknown service)" would
 * be the confident wrong answer this package is arranged against.
 *
 * Pure: the one network call is {@link searchErrorTrackingIssues}, which takes the client as a parameter.
 */
import type { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import type { DdConsoleHost } from "./config.js";
import type { AbsoluteWindow } from "./window.js";

/** The API's issue states, in the order a triage moves an issue through them. */
export const ERROR_TRACKING_STATES = ["OPEN", "ACKNOWLEDGED", "IGNORED", "RESOLVED", "EXCLUDED"] as const;

/** One API issue state. */
export type ErrorTrackingState = (typeof ERROR_TRACKING_STATES)[number];

/** The console's word for each state — what a card says, and what `--state` takes in kebab case. */
export const ERROR_TRACKING_STATE_LABELS: Readonly<Record<ErrorTrackingState, string>> = {
  ACKNOWLEDGED: "Reviewed",
  EXCLUDED: "Excluded",
  IGNORED: "Ignored",
  OPEN: "For Review",
  RESOLVED: "Resolved",
};

/** Which telemetry an issue is grouped from: APM spans, logs, or browser RUM. */
export type ErrorTrackingTrack = "trace" | "logs" | "rum";

/** How the list is ordered: most events in the window, or most recently first seen. */
export type ErrorTrackingOrder = "count" | "newest";

/** One issue, joined from its search hit and its included attributes. */
export interface ErrorTrackingIssueRow {
  readonly id: string;
  /** Events in the searched window — the console's count column. */
  readonly count: number;
  readonly service: string | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly state: ErrorTrackingState;
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
  /** The deployed version the issue first appeared in, the regression-from-a-release signal. */
  readonly firstSeenVersion: string | null;
}

const nullable = z
  .string()
  .nullish()
  .transform((value) => (value === undefined ? null : value));

const hitSchema = z.object({
  attributes: z.object({ totalCount: z.number() }),
  id: z.string(),
});

const issueSchema = z.object({
  attributes: z.object({
    errorMessage: nullable,
    errorType: nullable,
    firstSeen: z.number(),
    firstSeenVersion: nullable,
    lastSeen: z.number(),
    service: nullable,
    state: z.enum(ERROR_TRACKING_STATES),
  }),
  id: z.string(),
  type: z.literal("issue"),
});

/**
 * Parse a `--state` value: the console's word in kebab case, or an API state name.
 *
 * @param value the flag value, e.g. `for-review` or `OPEN`
 * @returns the API state, or `null` when it names none
 */
export function parseErrorTrackingState({ value }: { value: string }): ErrorTrackingState | null {
  const upper = value.trim().toUpperCase();
  const byApiName = ERROR_TRACKING_STATES.find((state) => state === upper);
  if (byApiName !== undefined) {
    return byApiName;
  }
  const byLabel = ERROR_TRACKING_STATES.find(
    (state) => ERROR_TRACKING_STATE_LABELS[state].toLowerCase().replace(/ /g, "-") === value.trim().toLowerCase(),
  );
  if (byLabel !== undefined) {
    return byLabel;
  }
  return null;
}

/**
 * Join a search response's hits to their included issues, in the order the search ranked them.
 *
 * @param data the response's `data[]` — one hit per issue, carrying the window count
 * @param included the response's `included[]` — the issues' own attributes, among cases, users and teams
 * @returns every row, or every reason the answer was malformed
 */
export function issueRowsFromSearch({
  data,
  included,
}: {
  data: readonly unknown[];
  included: readonly unknown[];
}): Result<readonly ErrorTrackingIssueRow[]> {
  const issues = new Map<string, z.infer<typeof issueSchema>>();
  for (const item of included) {
    const parsed = issueSchema.safeParse(item);
    if (parsed.success) {
      issues.set(parsed.data.id, parsed.data);
    }
  }
  const rows: ErrorTrackingIssueRow[] = [];
  const problems: string[] = [];
  data.forEach((item, index) => {
    const hit = hitSchema.safeParse(item);
    if (!hit.success) {
      problems.push(`search hit ${String(index)} carries no id and window count`);
      return;
    }
    const issue = issues.get(hit.data.id);
    if (issue === undefined) {
      problems.push(`search hit ${hit.data.id} has no issue in included[] — was include=issue sent?`);
      return;
    }
    rows.push({
      count: hit.data.attributes.totalCount,
      errorMessage: issue.attributes.errorMessage,
      errorType: issue.attributes.errorType,
      firstSeenMs: issue.attributes.firstSeen,
      firstSeenVersion: issue.attributes.firstSeenVersion,
      id: issue.id,
      lastSeenMs: issue.attributes.lastSeen,
      service: issue.attributes.service,
      state: issue.attributes.state,
    });
  });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(rows);
}

/**
 * The most issues one search returns for a single state. MEASURED on a production org:
 * `slopweaver datadog errors --query env:production --from 30d` returned exactly 100 For Review and 100
 * Resolved beside a few dozen Reviewed, and the console shows "99+" For Review — so a state at this count is a floor.
 */
export const ERROR_TRACKING_STATE_CAP = 100;

/** How long each state's issues have stood since first seen, in whole days. */
export interface ErrorTrackingAgeSummary {
  readonly issues: number;
  /** The state reached {@link ERROR_TRACKING_STATE_CAP}, so `issues` is a floor, not a count. */
  readonly capped: boolean;
  readonly events: number;
  readonly medianAgeDays: number | null;
  readonly oldestAgeDays: number | null;
  /** Issues first seen more than 30 days before `now`. */
  readonly olderThan30Days: number;
}

const DAY_MS = 86_400_000;

/**
 * Summarise the rows per state: how many, how many events, and how old they are since first seen.
 *
 * @param rows the joined issue rows
 * @param nowMs the instant ages are measured from — passed in, never read, so a summary is reproducible
 * @returns one summary per state that has at least one row
 */
export function summariseIssuesByState({
  rows,
  nowMs,
}: {
  rows: readonly ErrorTrackingIssueRow[];
  nowMs: number;
}): Readonly<Partial<Record<ErrorTrackingState, ErrorTrackingAgeSummary>>> {
  const summary: Partial<Record<ErrorTrackingState, ErrorTrackingAgeSummary>> = {};
  for (const state of ERROR_TRACKING_STATES) {
    const inState = rows.filter((row) => row.state === state);
    if (inState.length === 0) {
      continue;
    }
    const ages = inState.map((row) => Math.floor((nowMs - row.firstSeenMs) / DAY_MS)).toSorted((a, b) => a - b);
    summary[state] = {
      capped: inState.length >= ERROR_TRACKING_STATE_CAP,
      events: inState.reduce((total, row) => total + row.count, 0),
      issues: inState.length,
      medianAgeDays: ages[Math.floor((ages.length - 1) / 2)]!,
      oldestAgeDays: ages[ages.length - 1]!,
      olderThan30Days: ages.filter((age) => age > 30).length,
    };
  }
  return summary;
}

/**
 * The console address of one issue.
 *
 * @param consoleHost the site's console host, from `DatadogConfig.consoleHost`
 * @param id the issue id
 * @returns the issue's Error Tracking page
 */
export function errorTrackingIssueLink({ consoleHost, id }: { consoleHost: DdConsoleHost; id: string }): string {
  return `https://${consoleHost}/error-tracking/issue/${id}`;
}

const ORDER_BY: Readonly<Record<ErrorTrackingOrder, v2.IssuesSearchRequestDataAttributesOrderBy>> = {
  count: "TOTAL_COUNT",
  newest: "FIRST_SEEN",
};

/**
 * Search Error Tracking's issues over a window — one read-only POST, the SDK's `searchIssues`.
 *
 * @param client the shared Datadog client
 * @param query an Error Tracking search query, e.g. `service:jobs-api env:production`
 * @param track which telemetry the issues are grouped from
 * @param order most events first, or most recently first seen
 * @param states the states to keep; empty keeps every state
 * @param window the absolute window counts are taken over
 * @returns the joined rows, or every reason the call or its answer failed
 */
export async function searchErrorTrackingIssues({
  client,
  query,
  track,
  order,
  states,
  window,
}: {
  client: DatadogClient;
  query: string;
  track: ErrorTrackingTrack;
  order: ErrorTrackingOrder;
  states: readonly ErrorTrackingState[];
  window: AbsoluteWindow;
}): Promise<Result<readonly ErrorTrackingIssueRow[]>> {
  const attributes: v2.IssuesSearchRequestDataAttributes = {
    from: window.fromMs,
    orderBy: ORDER_BY[order],
    query,
    to: window.toMs,
    track,
  };
  if (states.length > 0) {
    attributes.states = [...states];
  }
  let response: v2.IssuesSearchResponse;
  try {
    response = await client.errorTracking.searchIssues({
      body: { data: { attributes, type: "search_request" } },
      include: ["issue"],
    });
  } catch (error: unknown) {
    return err([`error tracking search failed: ${error instanceof Error ? error.message : String(error)}`]);
  }
  // An absent `data` is Datadog's empty answer — no issue matched — and an absent `included` follows from it.
  if (response.data === undefined) {
    return ok([]);
  }
  if (response.included === undefined) {
    return issueRowsFromSearch({ data: response.data, included: [] });
  }
  return issueRowsFromSearch({ data: response.data, included: response.included });
}
