/**
 * Running the live ladder against Datadog — counts, groups, hits, and what was happening around one event.
 *
 * The effectful half of {@link ./ladder}: every query string is built there, every rung is declared there,
 * and what is here is the request, the read-back and the mapping of a driver throw into this domain's own
 * typed failure.
 *
 * ## Every result states its window, and a window past retention is refused
 *
 * The knowledge register's tier-1 row is why: *"The prod index keeps ~15 days; a longer window silently
 * returns the same short series. A zero for an older window means 'not retained', never 'no events'."* A
 * count is meaningless without the window it was taken over, and a count over a window the index cannot
 * serve is worse than meaningless — it is a confident zero. So the window rides on every report and
 * {@link ../detective/errors.DatadogDetectiveErrors.windowPastRetention} is a refusal rather than a warning.
 *
 * ## Nothing here masks a field
 *
 * A hit comes back whole — `usr.id`, `usr.email`, `session.ip`, the lot. That is the owner's rule, stated
 * in full in {@link ./record}, and it is what makes the IP-to-uid correlation possible at all.
 * The redaction is at the Slack post, not here.
 */

import { err, ok, type Result } from "../../lib/result.js";
import type { DatadogClient } from "../client.js";
import type { DdConsoleHost } from "../config.js";
import { type DdLinkDomain, ddConsoleLink } from "../ddLink.js";
import { type CensusBucket, runMultiGroupedLogsAggregate } from "../groupedAggregate.js";
import type { AbsoluteWindow } from "../window.js";
import { windowAsQueryBounds } from "../window.js";
import { readPath } from "./attributes.js";
import { presentOr } from "./envelope.js";
import { type DatadogDetectiveError, DatadogDetectiveErrors } from "./errors.js";
import { isLogSurface, type ShapeFamily } from "./family.js";
import { DATADOG_RUNGS, type DatadogRung, datadogQuery } from "./ladder.js";
import { correlationKeys, type DatadogRecord, datadogRecordId } from "./record.js";
import { envOf, serviceOf, tagValue } from "./shape.js";

/** One rung's count, and the query that produced it. *
 * @internal
 */
export interface RungCount {
  readonly rung: DatadogRung;
  readonly query: string;
  readonly lines: number;
}

/** One keyword's whole ladder over Datadog. */
export interface DatadogLadderReport {
  readonly term: string;
  readonly rungs: readonly RungCount[];
  readonly window: AbsoluteWindow;
  readonly elapsedMs: number;
  /** The environments the caller narrowed to, empty when every environment was in scope. */
  readonly envs: readonly string[];
}

/** How many days one index is assumed to retain when the catalogue could not say. */
export const ASSUMED_RETENTION_DAYS = 15;

/** Milliseconds in a day, named so the retention arithmetic reads as days rather than as a magic number. */
const DAY_MS = 86_400_000;

/**
 * Refuse a window that reaches past what the index retains.
 *
 * @param window the absolute window
 * @param retentionDays what the catalogue's indexes reported, or nothing when it could not say
 * @returns nothing when the window is servable, or the typed refusal
 */
export function checkRetention({
  window,
  retentionDays,
}: {
  window: AbsoluteWindow;
  retentionDays: number | null;
}): Result<null, DatadogDetectiveError> {
  // An index that could not report its own retention is read at the assumed floor, out loud, because the
  // refusal below names the number it judged against and a silent substitution would not survive the read.
  let retained = ASSUMED_RETENTION_DAYS;
  if (retentionDays !== null) {
    retained = retentionDays;
  }
  const requested = Math.ceil((window.toMs - window.fromMs) / DAY_MS);
  if (requested > retained) {
    return err(DatadogDetectiveErrors.windowPastRetention({ requestedDays: requested, retainedDays: retained }));
  }
  return ok(null);
}

/**
 * Which console area a family's events are read in.
 *
 * @returns the console domain a link for this family opens
 */
export function linkDomainFor({ family }: { family: ShapeFamily }): DdLinkDomain {
  if (family === "span") {
    return "traces";
  }
  return isLogSurface({ family }) ? "logs" : "rum";
}

/**
 * Count one query's events, over one surface.
 *
 * @param client the shared client
 * @param query the whole query
 * @param window the absolute window
 * @returns the count, or the typed reason it could not be taken
 */
async function countQuery({
  client,
  query,
  window,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
}): Promise<Result<number, DatadogDetectiveError>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.logs.aggregateLogs({
      body: { compute: [{ aggregation: "count", type: "total" }], filter: { from, query, to } },
    });
    const raw = response.data?.buckets?.[0]?.computes?.["c0"];
    const count = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(count)) {
      // Unreadable is not empty — `logsCount.ts`'s own rule, and the one that keeps a missing compute from
      // becoming a confident zero.
      return err(DatadogDetectiveErrors.callFailed({ cause: "the aggregate returned no readable count", what: query }));
    }
    return ok(count);
  } catch (error: unknown) {
    return err(DatadogDetectiveErrors.callFailed({ cause: error, what: query }));
  }
}

/**
 * Fan one keyword across every rung of the Datadog ladder.
 *
 * @param client the shared client
 * @param term the keyword
 * @param window the absolute window
 * @param envs the environments to narrow to, empty for every environment
 * @param extra a clause the caller added, or nothing
 * @returns the ladder, or the typed reason a rung could not be counted
 */
export async function runDatadogLadder({
  client,
  term,
  window,
  envs,
  extra,
}: {
  client: DatadogClient;
  term: string;
  window: AbsoluteWindow;
  envs: readonly string[];
  extra?: string | undefined;
}): Promise<Result<DatadogLadderReport, DatadogDetectiveError>> {
  const started = Date.now();
  const rungs: RungCount[] = [];
  for (const rung of DATADOG_RUNGS) {
    const query = datadogQuery({ envs, extra, rung, term });
    const counted = await countQuery({ client, query, window });
    if (counted.isErr()) {
      return err(counted.error);
    }
    rungs.push({ lines: counted.value, query, rung });
  }
  return ok({ elapsedMs: Date.now() - started, envs, rungs, term, window });
}

/**
 * Split one rung's hits by a facet — where a wide count actually lives.
 *
 * @param client the shared client
 * @param term the keyword
 * @param rung which rung to split
 * @param facet the Datadog facet to group by
 * @param window the absolute window
 * @param envs the environments to narrow to, empty for every environment
 * @param limit how many groups to ask for
 * @returns the buckets, or the typed reason the aggregate could not be run
 */
export async function runDatadogGroups({
  client,
  term,
  rung,
  facet,
  window,
  envs,
  limit,
}: {
  client: DatadogClient;
  term: string;
  rung: DatadogRung;
  facet: string;
  window: AbsoluteWindow;
  envs: readonly string[];
  limit: number;
}): Promise<Result<readonly CensusBucket[], DatadogDetectiveError>> {
  const query = datadogQuery({ envs, rung, term });
  const aggregate = await runMultiGroupedLogsAggregate({ client, facets: [facet], limit, query, window });
  if (aggregate.isErr()) {
    return err(DatadogDetectiveErrors.callFailed({ cause: aggregate.error.join("; "), what: `${facet} of ${query}` }));
  }
  return ok(aggregate.value.buckets);
}

/**
 * The instant a record carries, from whatever the endpoint put in its timestamp field.
 *
 * An event with NO readable timestamp takes the window's own end rather than an empty string: every caller
 * renders this as a time and sorts on it, and an empty string sorts before every real instant while reading
 * as though the event happened at the epoch.
 *
 * @param occurred the raw timestamp field
 * @param window the window the search ran over
 * @returns the instant, ISO-8601
 */
function occurredIso({ occurred, window }: { occurred: unknown; window: AbsoluteWindow }): string {
  if (occurred instanceof Date) {
    return occurred.toISOString();
  }
  return typeof occurred === "string" && occurred.length > 0 ? occurred : new Date(window.toMs).toISOString();
}

/**
 * Turn one log event into a `dd:` record, whole and unmasked.
 *
 * @param attributes the event's own `attributes` object as the endpoint returned it
 * @param eventId Datadog's own opaque event id
 * @param family which surface it came from
 * @param consoleHost the site's console host
 * @param window the window the search was run over, which the link is frozen to
 * @returns the record
 */
export function recordFromLog({
  attributes,
  eventId,
  family,
  consoleHost,
  window,
}: {
  attributes: unknown;
  eventId: string;
  family: ShapeFamily;
  consoleHost: DdConsoleHost;
  window: AbsoluteWindow;
}): DatadogRecord {
  const message = readPath({ path: "message", value: attributes });
  const resource = readPath({ path: "resource_name", value: attributes });
  // A log carries its status as an attribute; a span and a RUM event carry it as a tag. Reading the tag is
  // a second question rather than a default for the first, so the absent case is named.
  const statusAttribute = readPath({ path: "status", value: attributes });
  let status: unknown = tagValue({ attributes, key: "status" });
  if (statusAttribute !== undefined) {
    status = statusAttribute;
  }
  const occurred = readPath({ path: "timestamp", value: attributes });
  const service = serviceOf({ attributes });
  // Not a nested ternary, by house rule and because the two fallbacks answer different questions: a log has
  // a message, a span has a resource, and a RUM view has neither — an empty string is the honest third case
  // rather than a third guess.
  let text = "";
  if (typeof message === "string") {
    text = message;
  } else if (typeof resource === "string") {
    text = resource;
  }
  return {
    attributes,
    env: envOf({ attributes }),
    family,
    id: datadogRecordId({ eventId, family }),
    // The link opens the SERVICE's own view frozen to the search's window, not the single event: Datadog has
    // no get-by-id route (see {@link ./hitsCache}) and no `@_id:` facet to search on either, so a link
    // claiming to open one event would 404 the reader. The frozen window plus the service is what a person
    // would actually type to find it again, and it is reproducible.
    link: ddConsoleLink({
      consoleHost,
      domain: linkDomainFor({ family }),
      query: service.length === 0 ? "*" : `service:${service}`,
      window,
    }),
    occurredAtIso: occurredIso({ occurred, window }),
    service,
    status: typeof status === "string" ? status : null,
    text,
  };
}

/** One log event off the wire, with the two fields a record needs already resolved. */
interface PagedLog {
  readonly attributes: unknown;
  readonly eventId: string;
}

/**
 * Unwrap one logs page, naming each absence the envelope allows rather than coalescing it.
 *
 * The SDK types `data`, `attributes` and `id` as optional on every logs response, so all three have to be
 * answered. A page with no `data` is an empty page. An event with no attributes carries nothing to read, and
 * one with no id is quoted as `(unknown)` — the id only ever reaches a reader, because Datadog has no
 * get-by-id route to spend it on.
 *
 * @param response what the logs GET returned
 * @returns one entry per event on the page
 */
function logsOf({
  response,
}: {
  response: { data?: readonly { attributes?: unknown; id?: string }[] | undefined };
}): readonly PagedLog[] {
  const data = presentOr({ absent: [], value: response.data });
  return data.map((log) => {
    const attributes = presentOr({ absent: {}, value: log.attributes });
    const id = presentOr({ absent: "(unknown)", value: log.id });
    return { attributes, eventId: id };
  });
}

/**
 * Read one page of one rung's events, newest first.
 *
 * @param client the shared client
 * @param term the keyword
 * @param rung which rung to page
 * @param window the absolute window
 * @param envs the environments to narrow to, empty for every environment
 * @param limit how many events to fetch
 * @param extra a clause the caller added, or nothing
 * @returns the page, or the typed reason it could not be read
 */
export async function runDatadogHits({
  client,
  term,
  rung,
  window,
  envs,
  limit,
  extra,
}: {
  client: DatadogClient;
  term: string;
  rung: DatadogRung;
  window: AbsoluteWindow;
  envs: readonly string[];
  limit: number;
  extra?: string | undefined;
}): Promise<Result<readonly DatadogRecord[], DatadogDetectiveError>> {
  const query = datadogQuery({ envs, extra, rung, term });
  try {
    const response = await client.logs.listLogsGet({
      filterFrom: new Date(window.fromMs),
      filterQuery: query,
      filterTo: new Date(window.toMs),
      pageLimit: limit,
      sort: "-timestamp",
    });
    return ok(
      logsOf({ response }).map((log) =>
        recordFromLog({
          attributes: log.attributes,
          consoleHost: client.config.consoleHost,
          eventId: log.eventId,
          family: "log",
          window,
        }),
      ),
    );
  } catch (error: unknown) {
    return err(DatadogDetectiveErrors.callFailed({ cause: error, what: query }));
  }
}

/** How a caller asks for the neighbours of one event. */
export const AROUND_MODES = ["trace", "request", "session", "ip", "service"] as const;

/** One around mode's id. */
export type DatadogAroundMode = (typeof AROUND_MODES)[number];

/**
 * The query that finds one event's neighbours, for one mode.
 *
 * The `ip` mode is the owner's own move, quoted in {@link ./record}: an event carrying a `session.ip` and no
 * `usr.id` is the start of a correlation that ends in a uid, and it only works if the IP is both readable
 * and searchable. A mode whose key the event does not carry returns nothing rather than widening to the
 * service, because silently answering a different question is the failure this whole package is against.
 *
 * @param record the event to read around
 * @param mode which correlation to follow
 * @returns the query, or nothing when the event carries no key for that mode
 */
export function aroundQuery({ record, mode }: { record: DatadogRecord; mode: DatadogAroundMode }): string | null {
  if (mode === "service") {
    return record.service.length === 0 ? null : `service:${record.service}`;
  }
  const keys = correlationKeys({ attributes: record.attributes });
  // A table rather than a chain of four ifs: the four correlations differ only in which key they read and
  // which facet they match on, so reading them side by side is what makes a wrong facet visible.
  const facets: Readonly<Record<Exclude<DatadogAroundMode, "service">, { facet: string; value: string | null }>> = {
    ip: { facet: "@session.ip", value: keys.ip },
    request: { facet: "@requestId", value: keys.requestId },
    session: { facet: "@session.id", value: keys.sessionId },
    trace: { facet: "@trace_id", value: keys.traceId },
  };
  const chosen = facets[mode];
  return chosen.value === null ? null : `${chosen.facet}:${chosen.value}`;
}

/**
 * Read what was happening around one event.
 *
 * @param client the shared client
 * @param record the event to read around, already fetched
 * @param mode which correlation to follow
 * @param window the absolute window around the event
 * @param limit how many neighbours to fetch
 * @returns the neighbours, or the typed reason they could not be read
 */
export async function runDatadogAround({
  client,
  record,
  mode,
  window,
  limit,
}: {
  client: DatadogClient;
  record: DatadogRecord;
  mode: DatadogAroundMode;
  window: AbsoluteWindow;
  limit: number;
}): Promise<Result<readonly DatadogRecord[], DatadogDetectiveError>> {
  const query = aroundQuery({ mode, record });
  if (query === null) {
    return err(
      DatadogDetectiveErrors.callFailed({
        cause: `${record.id} carries no ${mode} key, so there is nothing to correlate on`,
        what: `around --mode ${mode}`,
      }),
    );
  }
  try {
    const response = await client.logs.listLogsGet({
      filterFrom: new Date(window.fromMs),
      filterQuery: query,
      filterTo: new Date(window.toMs),
      pageLimit: limit,
      sort: "timestamp",
    });
    return ok(
      logsOf({ response }).map((log) =>
        recordFromLog({
          attributes: log.attributes,
          consoleHost: client.config.consoleHost,
          eventId: log.eventId,
          family: "log",
          window,
        }),
      ),
    );
  } catch (error: unknown) {
    return err(DatadogDetectiveErrors.callFailed({ cause: error, what: query }));
  }
}
