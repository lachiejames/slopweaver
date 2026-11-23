/**
 * The strict boundary of each unified event track Datadog's console reads, one per `?type=`. Pure.
 *
 * The unified event track is Datadog's own undocumented console API: nothing in a published contract says its
 * envelope will stay as measured, so the envelope is pinned here, strict all the way down, and a change
 * announces itself by naming the key rather than being read as an empty page.
 *
 * ## The envelope, measured
 *
 * MEASURED on this install's site through `datadog raw`, key names and kinds only, on all seven tracks at `limit: 0`
 * and `limit: 2`: the body carries `elapsed`, `hitCount`, `requestId`, `status`, `type` and `result`; `result`
 * carries `count`, `events` and — on a page that returned rows only — `paging` with `after` and `values`; each
 * event wrapper carries exactly `"datadog.index"` (one dotted key, not a nested object), `event`, `event_id`
 * and `id`. Reproduce one track:
 *
 * ```text
 * slopweaver datadog raw --method POST --path '/api/v1/logs-analytics/list?type=trace' \
 *   --body '{"list":{"limit":2,"search":{"query":"*"},"time":{"from":<ms>,"to":<ms>}}}' --json
 * ```
 *
 * ## What is pinned, and what is deliberately not
 *
 * The ENVELOPE and the event WRAPPER are Datadog's, and are strict. The `event` inside a wrapper is declared
 * and not read here: its tree differs per track, per service and per emitter, carries organisation-emitted
 * custom attributes with an open key space, and `./event.ts` folds it defensively. So this boundary validates
 * Datadog's contract about the page, never the contents of anybody's telemetry.
 */
import { z } from "zod";

import { type Boundary, defineBoundary } from "#lib/boundary.js";

/** Every event track the census and the investigation verbs read, one per `?type=` the route serves. */
export const UNIFIED_TRACKS = ["logs", "trace", "rum", "cipipeline", "citest", "databasequery", "profile"] as const;

/** One unified event track. */
export type UnifiedTrack = (typeof UNIFIED_TRACKS)[number];

/**
 * One event as the page wraps it: Datadog's bookkeeping keys around the organisation's own event. Exported for
 * `../logsAnalytics.ts`, which reads the same route at `limit: 0` and refuses any row that arrives.
 */
export const TRACK_EVENT_WRAPPER = z.strictObject({
  "datadog.index": z.unknown().optional(),
  // Organisation-emitted telemetry with an open key space: declared, never validated here (see the header).
  event: z.unknown(),
  event_id: z.unknown().optional(),
  id: z.unknown().optional(),
});

/** One page of a unified track, as measured on all seven. */
const TRACK_PAGE_SCHEMA = z.strictObject({
  elapsed: z.unknown().optional(),
  hitCount: z.number(),
  requestId: z.unknown().optional(),
  result: z.strictObject({
    count: z.number(),
    events: z.array(TRACK_EVENT_WRAPPER),
    // Absent on a page that returned no rows, which is how the last page of a walk says so.
    paging: z
      .strictObject({
        after: z.string(),
        values: z.unknown().optional(),
      })
      .optional(),
  }),
  status: z.unknown().optional(),
  type: z.unknown().optional(),
});

/** What one page of a unified track reads as, once its boundary admitted it. */
export type TrackPageWire = z.output<typeof TRACK_PAGE_SCHEMA>;

/** One track's boundary, named by the endpoint a refusal should point at. */
function trackBoundary({ track }: { track: UnifiedTrack }): Boundary<TrackPageWire> {
  return defineBoundary({ endpoint: `POST /api/v1/logs-analytics/list?type=${track}`, schema: TRACK_PAGE_SCHEMA });
}

/**
 * Each track's own boundary, total over {@link UNIFIED_TRACKS}, so no track string reaches the route unbounded.
 * Seven declarations sharing one schema rather than one, so a refusal names the track that drifted.
 */
export const TRACK_PAGE_BOUNDARIES: Readonly<Record<UnifiedTrack, Boundary<TrackPageWire>>> = {
  cipipeline: trackBoundary({ track: "cipipeline" }),
  citest: trackBoundary({ track: "citest" }),
  databasequery: trackBoundary({ track: "databasequery" }),
  logs: trackBoundary({ track: "logs" }),
  profile: trackBoundary({ track: "profile" }),
  rum: trackBoundary({ track: "rum" }),
  trace: trackBoundary({ track: "trace" }),
};
