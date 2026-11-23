/**
 * `/api/v1/logs-analytics/list` — the unified event API, and a second independent oracle for a count.
 *
 * ## Why a second way to count the same thing is worth a whole module
 *
 * A negative finding is the one an investigation is most likely to get wrong, because an empty result and a
 * failed call look identical from the outside. Saying *"this query really does return nothing"* needs two
 * independent paths to the number: a different API version, a different route, a different rate-limit
 * bucket, a different response shape.
 *
 * On a frozen closed hour, this route and `POST /api/v2/logs/analytics/aggregate` have been observed to
 * agree exactly — `hitCount: 7` here against `computes.c0: 7` there. On a query matching nothing, both
 * return a clean zero. That agreement is what a two-oracle proof gate rests on, and it is worth re-checking
 * per run rather than assumed.
 *
 * ## The wire shape
 *
 * ```text
 * POST /api/v1/logs-analytics/list?type=logs
 * body  {"list":{"search":{"query":"…"},"time":{"from":<ms>,"to":<ms>},"limit":0}}
 *
 * {"elapsed":377,"hitCount":7,"requestId":"…","status":"done","type":"logs",
 *  "result":{"count":7,"events":[…]}}
 * ```
 *
 * Three things about it that a reader would otherwise have to discover the hard way:
 *
 * - **The `list` wrapper is mandatory.** A flat body carrying the same `search`/`time`/`limit` keys is a
 *   hard **400**, not a silent drop. That is the good outcome — several Datadog routes discard a misplaced
 *   key and answer 200 — but it means the wrapper is not optional styling.
 * - **`status` is at the TOP level**, not under a `meta` object the way the v2 aggregates put it. A reader
 *   looking for `meta.status` finds nothing and grades a partial response as complete.
 * - **`limit: 0` returns the count with zero event rows.** `hitCount` has been observed identical at
 *   `limit: 0` and `limit: 1`, so the population does not depend on the page size.
 *
 * ## Why this NEVER fetches event rows
 *
 * {@link LOGS_ANALYTICS_LIMIT} is fixed at 0 and is not a parameter. The oracle wants a number, and a row
 * would pull raw telemetry into the process for no gain — a log line can carry sensitive fields (an OTP
 * code, an email, a phone number, a client IP) on any real estate's less-disciplined logging path. A count
 * is not a disclosure; a body is. Since `limit: 0` yields the same count, fetching rows would be pure
 * downside.
 *
 * ## Why logs, and not spans, is the counting oracle
 *
 * A logs reply carries no `traffic_type` field at all, while every spans aggregate carries
 * `traffic_type: "sampled"`. That asymmetry is the machine-checkable form of "counts from logs" — see
 * `domain.ts`, which encodes it rather than printing a warning about it.
 */
import { z } from "zod";

import { absentAsEmpty } from "#lib/absent.js";
import { type Boundary, defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../lib/result.js";
import { TRACK_EVENT_WRAPPER } from "./census/boundaries.js";
import { type DatadogQueryError, DatadogQueryErrors } from "./queryErrors.js";
import type { RawRequester } from "./rawRequest.js";
import type { AbsoluteWindow } from "./window.js";

/**
 * The page size every call uses: none.
 *
 * A constant rather than a parameter, so no caller can turn the oracle into an event reader. See the file
 * header for why that matters more than it looks.
 */
export const LOGS_ANALYTICS_LIMIT = 0;

/** The event tracks this route serves that this package reads. `spans` is deliberately absent — see below. */
const LOGS_ANALYTICS_TRACKS = ["logs", "rum", "citest", "cipipeline"] as const;

export type LogsAnalyticsTrack = (typeof LOGS_ANALYTICS_TRACKS)[number];

/**
 * Why `spans` is not a track here.
 *
 * `POST /api/v1/logs-analytics/list?type=spans` answers HTTP **400** `{"code":"InvalidArgument","message":"No
 * valid indexes specified"}` for every body shape, while `logs`, `rum`, `replay`, `databasequery`, `citest`
 * and `cipipeline` all return 200. The working substitutes are the v2 routes. Recorded as a constant because
 * a 400 here reads exactly like "empty" to anything that only checks for rows.
 */
export const SPANS_TRACK_UNAVAILABLE =
  'the unified list route does not serve the spans track — it answers HTTP 400 "No valid indexes specified" for every body shape. Use /api/v2/spans/analytics/aggregate instead';

/**
 * The response, one strict boundary per track, since each `?type=` is its own endpoint to a reader of a refusal.
 *
 * Strict all the way down, so a key Datadog adds, drops or renames is refused by name rather than read past.
 * MEASURED on this install's site through `datadog raw`, keys and kinds only, the `logs` track at `limit: 0`:
 * `elapsed`, `hitCount`, `requestId`, `status`, `type`, and `result` carrying `count` and `events` — reproduce
 * with `slopweaver datadog raw --method POST --path '/api/v1/logs-analytics/list?type=logs' --body
 * '{"list":{"limit":0,"search":{"query":"*"},"time":{"from":<ms>,"to":<ms>}}}' --json`. The other three tracks
 * carry the same envelope (`census/boundaries.ts` measured all seven). Every field this module READS is
 * required: an absent `hitCount` is a response that does not answer the question, and defaulting it to zero
 * is precisely the coercion the whole package refuses.
 *
 * `result.events` is the census's measured event wrapper, and {@link logsAnalyticsCount} refuses any row that
 * arrives: the request fixes `limit: 0`, so a row breaks the disclosure promise rather than Datadog's contract,
 * and that refusal says so. `result.paging` is declared unread for the same case — the route carries it beside
 * rows, and it is absent at `limit: 0`. `events` is optional rather than defaulted: an absent key and an empty
 * one both mean no rows came back.
 */
const LOGS_ANALYTICS_SCHEMA = z.strictObject({
  elapsed: z.unknown().optional(),
  hitCount: z.number().int().nonnegative(),
  requestId: z.unknown().optional(),
  result: z.strictObject({
    count: z.number().int().nonnegative(),
    events: z.array(TRACK_EVENT_WRAPPER).optional(),
    paging: z.unknown().optional(),
  }),
  status: z.string(),
  type: z.unknown().optional(),
});

/** Each counted track's own boundary, total over the tracks, so no route is reached unbounded. */
const LOGS_ANALYTICS_BOUNDARIES: Readonly<
  Record<LogsAnalyticsTrack, Boundary<z.output<typeof LOGS_ANALYTICS_SCHEMA>>>
> = {
  cipipeline: defineBoundary({
    endpoint: "POST /api/v1/logs-analytics/list?type=cipipeline (limit 0)",
    schema: LOGS_ANALYTICS_SCHEMA,
  }),
  citest: defineBoundary({
    endpoint: "POST /api/v1/logs-analytics/list?type=citest (limit 0)",
    schema: LOGS_ANALYTICS_SCHEMA,
  }),
  logs: defineBoundary({
    endpoint: "POST /api/v1/logs-analytics/list?type=logs (limit 0)",
    schema: LOGS_ANALYTICS_SCHEMA,
  }),
  rum: defineBoundary({
    endpoint: "POST /api/v1/logs-analytics/list?type=rum (limit 0)",
    schema: LOGS_ANALYTICS_SCHEMA,
  }),
};

/** A count from the unified event API, and everything needed to reproduce it. */
export interface LogsAnalyticsCount {
  readonly count: number;
  readonly query: string;
  readonly track: LogsAnalyticsTrack;
  readonly window: AbsoluteWindow;
}

/**
 * The status the route reports when it has finished counting.
 *
 * Exact equality, and anything else — including `timeout` — is a partial answer. Same rule as the v2
 * aggregates' `meta.status`, in a different place on the wire.
 */
const DONE = "done";

/**
 * Count the events matching a query on one track, over an absolute window.
 *
 * @param requester the raw request path, since this route has no SDK class
 * @param query the Datadog query
 * @param window the absolute window, already resolved so the count and any link share one instant
 * @param track which event track to count, default `logs`
 * @returns the count with its query and window, or every reason it cannot be believed
 */
export async function logsAnalyticsCount({
  requester,
  query,
  window,
  track = "logs",
}: {
  requester: RawRequester;
  query: string;
  window: AbsoluteWindow;
  track?: LogsAnalyticsTrack;
}): Promise<Result<LogsAnalyticsCount, DatadogQueryError>> {
  const path = `/api/v1/logs-analytics/list?type=${track}`;
  const response = await requester.request({
    method: "POST",
    path,
    boundary: LOGS_ANALYTICS_BOUNDARIES[track],
    // The `list` wrapper is mandatory; a flat body is a hard 400. See the file header.
    body: {
      list: {
        search: { query },
        time: { from: window.fromMs, to: window.toMs },
        limit: LOGS_ANALYTICS_LIMIT,
      },
    },
  });
  if (response.isErr()) {
    return err(DatadogQueryErrors.queryRequestFailed({ reasons: response.error }));
  }
  const body = response.value.body;
  if (body.status !== DONE) {
    return err(DatadogQueryErrors.analyticsIncomplete({ expected: DONE, path, status: body.status }));
  }
  if (body.hitCount !== body.result.count) {
    // Two renderings of the same number in the same body. If they ever disagree, neither is trustworthy —
    // this is a free internal consistency check on the oracle itself.
    return err(
      DatadogQueryErrors.analyticsTotalMismatch({ hitCount: body.hitCount, path, resultCount: body.result.count }),
    );
  }
  const rows = absentAsEmpty({ value: body.result.events });
  if (rows.length > 0) {
    return err(DatadogQueryErrors.analyticsRowsDisclosed({ limit: LOGS_ANALYTICS_LIMIT, path, rowCount: rows.length }));
  }
  return ok({ count: body.hitCount, query, track, window });
}
