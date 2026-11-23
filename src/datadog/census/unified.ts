/**
 * Reading one page off Datadog's unified event track. The effectful edge; the fold is pure.
 *
 * ## Why this endpoint and not the public per-product search
 *
 * `POST /api/v1/logs-analytics/list?type=<track>` is what every Explorer page in the console calls, it takes
 * ordinary API keys, and it reaches products whose public search either does not exist (database queries,
 * profiles) or is metered an order of magnitude tighter. MEASURED on this install's site from the
 * `x-ratelimit-*` headers: `event_platform_queries_execute_request` allows **85 requests per 10 seconds
 * shared across every track**, against `logs_public_search_api` at 3 per 10 seconds and `spans_public_api`
 * at 5 per 60. A per-shape exemplar pass is affordable at the first budget and not at the other two.
 *
 * It is already inside the read-only property `rawTransport.ts` enforces in its TYPE: both `logs-analytics`
 * routes are on `READ_ONLY_POST_ROUTES`, so nothing here widens what this package may do to Datadog. Every page
 * crosses its track's strict boundary (`./boundaries.ts`), so an envelope Datadog changes is refused by name.
 *
 * ## A cursor, measured
 *
 * The response carries `result.paging.after`, and the request takes it back as a top-level `after` inside
 * the `list` envelope — measured by sending the cursor three ways and comparing the returned event ids.
 * Reproduce: take `result.paging.after` from one call and send it as `{"list":{…,"after":"<cursor>"}}`.
 */

import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { TRACK_PAGE_BOUNDARIES, type UnifiedTrack } from "./boundaries.js";
import { readTrackEvent, type TrackEvent } from "./event.js";

/** The most events one page may ask for — Datadog's own ceiling on this route, measured. */
export const TRACK_PAGE_LIMIT = 1000;

/** One page of a track, already unwrapped. */
export interface TrackPage {
  readonly events: readonly TrackEvent[];
  /** Each event's log-pattern fingerprint, positionally — `null` on a track that carries none. */
  readonly fingerprints: readonly (string | null)[];
  /** How many events the whole query matched, which is a COUNT of the window rather than of the page. */
  readonly hitCount: number;
  /** The cursor the next page is asked with, or nothing when this was the last one. */
  readonly after: string | null;
}

/**
 * The request body one track read sends.
 *
 * Its own function so a test can assert the envelope without a network: the `list` wrapper is required and
 * an omitted one answers `Missing required 'list' field`, which is the single fact that unlocked this
 * endpoint at all.
 *
 * @param query the Datadog search query, in the same syntax the Explorer takes
 * @param window the absolute window
 * @param limit how many events to ask for
 * @param after the cursor from a previous page, or nothing for the first
 * @returns the body
 */
export function trackListBody({
  query,
  window,
  limit,
  after,
}: {
  query: string;
  window: AbsoluteWindow;
  limit: number;
  after: string | null;
}): Readonly<Record<string, unknown>> {
  const list: Record<string, unknown> = {
    limit,
    search: { query },
    time: { from: window.fromMs, to: window.toMs },
  };
  if (after !== null) {
    list["after"] = after;
  }
  return { list };
}

/**
 * Read one page of one track.
 *
 * @param requester the read-only raw path, bound to this install's site and credentials
 * @param track the event track, e.g. `logs`, `trace`, `databasequery`
 * @param query the Datadog search query
 * @param window the absolute window
 * @param limit how many events to ask for
 * @param after the cursor from a previous page, or nothing for the first
 * @returns the page, or every reason the call cannot be believed
 */
export async function readTrackPage({
  requester,
  track,
  query,
  window,
  limit,
  after = null,
}: {
  requester: RawRequester;
  track: UnifiedTrack;
  query: string;
  window: AbsoluteWindow;
  limit: number;
  after?: string | null;
}): Promise<Result<TrackPage>> {
  const response = await requester.request({
    body: trackListBody({ after, limit, query, window }),
    boundary: TRACK_PAGE_BOUNDARIES[track],
    method: "POST",
    path: `/api/v1/logs-analytics/list?type=${track}`,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const fallbackIso = new Date(window.toMs).toISOString();
  const events: TrackEvent[] = [];
  const fingerprints: (string | null)[] = [];
  for (const raw of response.value.body.result.events) {
    const read = readTrackEvent({ fallbackIso, raw });
    if (read === null) {
      continue;
    }
    events.push(read.event);
    fingerprints.push(read.fingerprint);
  }
  const { hitCount, result } = response.value.body;
  // An absent `paging` (measured on a page with no rows) ends the walk; an empty cursor is read the same way.
  const cursor = result.paging === undefined || result.paging.after.length === 0 ? null : result.paging.after;
  return ok({ after: cursor, events, fingerprints, hitCount });
}

/**
 * Read one shape's exemplars — a single small page, which is what a census spends per shape.
 *
 * A failed read answers an EMPTY list plus the line saying so rather than failing the pass, which is the
 * same rule every leg of the catalogue this replaced followed: a census missing four shapes' attribute
 * paths is useful, and one that refused to finish because a service was renamed mid-pass is not.
 *
 * @param requester the read-only raw path
 * @param track the event track
 * @param query the query that selects exactly this shape
 * @param window the absolute window
 * @param limit how many exemplars to fold
 * @param logger where a rate-limit wait is announced
 * @returns the exemplars, and the line for a build's `notMeasured` when there are none
 */
export async function readExemplars({
  requester,
  track,
  query,
  window,
  limit,
  logger,
}: {
  requester: RawRequester;
  track: UnifiedTrack;
  query: string;
  window: AbsoluteWindow;
  limit: number;
  logger: Logger;
}): Promise<{ events: readonly TrackEvent[]; missed: string | null }> {
  const page = await readTrackPage({ limit, query, requester, track, window });
  if (page.isErr()) {
    logger.debug({ msg: `census exemplar ${track} ${query} — ${page.error.join("; ")}` });
    return { events: [], missed: `${track} ${query} — no exemplar: ${page.error.join("; ")}` };
  }
  return { events: page.value.events, missed: null };
}
