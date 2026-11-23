/**
 * The strict boundaries of the two Datadog routes the telemetry reader calls. Pure.
 *
 * MEASURED on this install's site through `datadog raw`, key names and kinds only (never a value):
 *
 * - `GET /api/v1/logs/config/indexes` answers `indexes`, each index carrying `name`, `num_retention_days`,
 *   `num_flex_logs_retention_days`, `filter`, `exclusion_filters`, `daily_limit`, `daily_limit_reset`,
 *   `daily_limit_warning_threshold_percentage` and `is_rate_limited`. Reproduce:
 *   `slopweaver datadog raw --path /api/v1/logs/config/indexes --json`.
 * - `GET /api/v2/logs/events` answers `data`, `meta` and — on a page with a next one only — `links`; `meta`
 *   carries `elapsed`, `request_id`, `status` and, again only with a next page, `page.after`; each datum carries
 *   `id`, `type` and `attributes`. A query matching nothing answered `data: []` with no `links` and no
 *   `meta.page`. Reproduce: `slopweaver datadog raw --path '/api/v2/logs/events?filter[query]=*&page[limit]=2'
 *   --json`.
 *
 * Strict all the way down, so a key Datadog adds, drops or renames is refused by name. A datum's `attributes`
 * is declared and not validated: it is the log event itself, organisation-emitted with an open key space, which
 * `./telemetry.ts` projects defensively — this pins Datadog's envelope, never the contents of a log.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** The index-config route. A GET, so `assertReadOnly` passes it without an allowlist entry. */
export const RETENTION_PATH = "/api/v1/logs/config/indexes";

/** The logs-events route the failed-tool-call query runs against. */
export const EVENTS_PATH = "/api/v2/logs/events";

/** The index list: `name` and `num_retention_days` are read, the rest declared so a new key is refused. */
export const INDEX_LIST = defineBoundary({
  endpoint: `GET ${RETENTION_PATH}`,
  schema: z.strictObject({
    indexes: z.array(
      z.strictObject({
        daily_limit: z.unknown().optional(),
        daily_limit_reset: z.unknown().optional(),
        daily_limit_warning_threshold_percentage: z.unknown().optional(),
        exclusion_filters: z.unknown().optional(),
        filter: z.unknown().optional(),
        is_rate_limited: z.unknown().optional(),
        name: z.string(),
        num_flex_logs_retention_days: z.unknown().optional(),
        num_retention_days: z.number(),
      }),
    ),
  }),
});

/** One page of log events: `data`, `meta.status` and `meta.page.after` are read. */
export const EVENTS_PAGE = defineBoundary({
  endpoint: `GET ${EVENTS_PATH}`,
  schema: z.strictObject({
    data: z.array(
      z.strictObject({
        // The log event itself: declared, never validated here (see the header).
        attributes: z.unknown(),
        id: z.unknown().optional(),
        type: z.unknown().optional(),
      }),
    ),
    links: z.unknown().optional(),
    meta: z.strictObject({
      elapsed: z.unknown().optional(),
      // Absent on a result's last page, which is how Datadog says there is no further one.
      page: z.strictObject({ after: z.string() }).optional(),
      request_id: z.unknown().optional(),
      status: z.string(),
    }),
  }),
});
