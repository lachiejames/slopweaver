/**
 * The Datadog binding for {@link ./telemetry.js the telemetry reader} — the only place in `src/reflect/`
 * that talks to a network.
 *
 * There is **no new client here.** Everything below rides `src/datadog/`'s existing `RawRequester`: its
 * credential resolution, its read-only method type, its rate-limit retry and its "a malformed body is a
 * fault, not an empty result" rule. The standing decision keeps Datadog to one client, and a second
 * one would be a second thing to keep credentialed and correct. Each route's answer crosses its strict
 * boundary, declared and measured in `./telemetryBoundaries.ts`.
 *
 * The raw path rather than the typed SDK because both routes this module needs are GETs the SDK's
 * exposed classes do not cover, and `rawRequest.ts` exists for exactly that (see its header).
 */
import type { RawRequester } from "../datadog/rawRequest.js";
import { err, ok, type Result } from "../lib/result.js";
import { type TelemetryReadError, TelemetryReadErrors } from "./errors.js";
import type { RetentionHorizon, TelemetryPage, TelemetryPageFetcher } from "./telemetry.js";
import { EVENTS_PAGE, EVENTS_PATH, INDEX_LIST, RETENTION_PATH } from "./telemetryBoundaries.js";

/**
 * Read how long this org's log indexes keep data.
 *
 * Read rather than hard-coded, because the horizon is what tells an empty window apart from an aged-out
 * one, and a constant that drifts would make that distinction confidently wrong. A range is returned
 * rather than one number — see {@link RetentionHorizon}.
 *
 * @param requester the shared Datadog raw path
 * @returns the retention range, or why it could not be established
 */
export async function readRetentionHorizon({
  requester,
}: {
  requester: RawRequester;
}): Promise<Result<RetentionHorizon>> {
  const response = await requester.request({ boundary: INDEX_LIST, method: "GET", path: RETENTION_PATH });
  if (response.isErr()) {
    return err(response.error);
  }
  const days = response.value.body.indexes
    .map((index) => index.num_retention_days)
    .filter((value) => Number.isFinite(value));
  if (days.length === 0) {
    return err([
      `${RETENTION_PATH} named no index with a retention, so the aged-out horizon is unknown`,
      "an empty telemetry window cannot be told apart from an expired one without it",
    ]);
  }
  return ok({ maxDays: Math.max(...days), minDays: Math.min(...days) });
}

/**
 * Build the query string for one page of the failed-tool-call query.
 *
 * @param query the Datadog query
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param limit the page size
 * @param cursor Datadog's `meta.page.after` from the previous page, or `null` for the first
 * @returns the full route with its query string
 */
export function eventsPath({
  query,
  fromMs,
  toMs,
  limit,
  cursor,
}: {
  query: string;
  fromMs: number;
  toMs: number;
  limit: number;
  cursor: string | null;
}): string {
  const params = new URLSearchParams({
    "filter[from]": String(fromMs),
    "filter[query]": query,
    "filter[to]": String(toMs),
    "page[limit]": String(limit),
    // Newest first, so a capped read keeps the most recent failures rather than an arbitrary slice.
    sort: "-timestamp",
  });
  if (cursor !== null) {
    params.set("page[cursor]", cursor);
  }
  return `${EVENTS_PATH}?${params.toString()}`;
}

/**
 * Bind the page reader to one Datadog requester.
 *
 * @param requester the shared Datadog raw path
 * @returns a fetcher `readToolExecutionErrors` can page with
 */
export function createTelemetryPageFetcher({ requester }: { requester: RawRequester }): TelemetryPageFetcher {
  return async (input): Promise<Result<TelemetryPage, TelemetryReadError>> => {
    const path = eventsPath(input);
    const response = await requester.request({ boundary: EVENTS_PAGE, method: "GET", path });
    if (response.isErr()) {
      return err(TelemetryReadErrors.queryFailed({ query: input.query, reasons: response.error }));
    }
    const { data, meta } = response.value.body;
    return ok({
      events: data,
      // Datadog omits `meta.page` on a result's last page (measured): NULL means "no further page".
      nextCursor: meta.page === undefined ? null : meta.page.after,
      status: meta.status,
    });
  };
}
