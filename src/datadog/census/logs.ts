/**
 * The LOGS census: every pattern this organisation writes, counted, then exemplified one shape at a time.
 *
 * ## The pattern is Datadog's own, not a template this code invented
 *
 * Every log event carries `__dd.log_identity.raw_msg_fingerprint`, the fingerprint Datadog's own Patterns
 * view clusters on, and the logs aggregate groups by it as a reserved facet. MEASURED on this install's site
 * over seven days: **tens of thousands of distinct fingerprints across dozens of services**, and a query
 * `__dd.log_identity.raw_msg_fingerprint:<fp>` selects one pattern's own events. Reproduce the cardinality:
 *
 * ```bash
 * slopweaver datadog raw --method POST --path /api/v2/logs/analytics/aggregate \
 *   --body '{"compute":[{"aggregation":"cardinality","type":"total","metric":"__dd.log_identity.raw_msg_fingerprint"}],"filter":{"query":"*","from":"now-7d","to":"now"}}'
 * ```
 *
 * The sigil matters and getting it wrong is silent: `@__dd.log_identity.raw_msg_fingerprint` returns zero
 * buckets, because the field is reserved rather than custom.
 *
 * ## Why the pass is partitioned per service
 *
 * Datadog refuses a request that would produce more than 10,000 groups across all dimensions — literally,
 * `invalid_argument(Cannot generate more than 10000 groups across all dimensions…)`. One service at a time
 * keeps every partition inside that ceiling, and a service that reaches it anyway is re-asked per status,
 * which is the one facet that cuts a service's patterns into disjoint sets a detective cares about. A
 * partition still at the ceiling after that is STATED rather than silently truncated.
 */

import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { runGroupedLogsAggregate } from "../groupedAggregate.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { FINGERPRINT_FACET } from "./event.js";
import { type CountedShape, exemplifyShapes } from "./exemplify.js";
import type { CensusRow } from "./row.js";
import {
  type CensusClient,
  GROUP_LIMIT,
  type ProductCensus,
  SERVICE_LIMIT,
  type ServiceVolume,
  serviceClause,
  serviceOfBucket,
} from "./scope.js";

/**
 * The statuses a service is re-partitioned by when its patterns overflow one request.
 *
 * `error` first, because a partition that still overflows after the split loses its tail, and the tail
 * worth keeping is never the info lines.
 */
const STATUS_PARTITIONS: readonly string[] = ["error", "warn", "info", "debug"];

/** One pattern, counted, before any exemplar has been fetched. */
interface CountedPattern {
  readonly fingerprint: string;
  readonly count: number;
}

/**
 * Every service the logs index holds, with its own volume over the window.
 *
 * Unscoped by environment, which is the owner's all-environments scope read literally: a query carrying any `env:` clause
 * excludes exactly the events whose env tag is wrong or absent.
 *
 * @param client the shared client
 * @param window the absolute window
 * @returns the services, and the line for a listing that truncated or failed
 */
async function readLogServices({
  client,
  window,
}: {
  client: CensusClient;
  window: AbsoluteWindow;
}): Promise<{ services: readonly ServiceVolume[]; missed: string | null }> {
  const aggregate = await runGroupedLogsAggregate({
    client,
    facet: "service",
    limit: SERVICE_LIMIT,
    query: "*",
    window,
  });
  if (aggregate.isErr()) {
    return { missed: `the logs service listing — not read: ${aggregate.error.join("; ")}`, services: [] };
  }
  return {
    missed: aggregate.value.truncated
      ? `the logs service listing reached its ${String(SERVICE_LIMIT)}-group limit — services beyond it are absent from this census`
      : null,
    services: aggregate.value.buckets.map((bucket) => ({
      events: bucket.count,
      service: serviceOfBucket({ by: bucket.by }),
    })),
  };
}

/**
 * One grouped aggregate over the pattern facet.
 *
 * @param client the shared client
 * @param query the query selecting the partition
 * @param window the absolute window
 * @returns the patterns and whether the request hit its own ceiling
 */
async function countPatterns({
  client,
  query,
  window,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
}): Promise<Result<{ patterns: readonly CountedPattern[]; truncated: boolean }>> {
  const aggregate = await runGroupedLogsAggregate({
    client,
    facet: FINGERPRINT_FACET,
    limit: GROUP_LIMIT,
    query,
    window,
  });
  if (aggregate.isErr()) {
    return err(aggregate.error);
  }
  const patterns: CountedPattern[] = [];
  for (const bucket of aggregate.value.buckets) {
    const fingerprint = bucket.by[FINGERPRINT_FACET];
    if (fingerprint == null || fingerprint.length === 0) {
      continue;
    }
    patterns.push({ count: bucket.count, fingerprint });
  }
  return ok({ patterns, truncated: aggregate.value.truncated });
}

/**
 * Re-ask one service's patterns per status, for a service whose whole set overflows one request.
 *
 * @param client the shared client
 * @param service the service being partitioned
 * @param window the absolute window
 * @returns the merged patterns, and one line per partition still at the ceiling
 */
async function partitionByStatus({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ patterns: readonly CountedPattern[]; notMeasured: readonly string[] }> {
  const base = serviceClause({ service });
  const merged = new Map<string, number>();
  const notMeasured: string[] = [];
  for (const status of STATUS_PARTITIONS) {
    const part = await countPatterns({ client, query: `${base} status:${status}`, window });
    if (part.isErr()) {
      notMeasured.push(`${service}'s ${status} log patterns — not counted: ${part.error.join("; ")}`);
      continue;
    }
    for (const pattern of part.value.patterns) {
      merged.set(pattern.fingerprint, pattern.count);
    }
    if (part.value.truncated) {
      notMeasured.push(
        `${service} wrote more than ${String(GROUP_LIMIT)} distinct ${status} log patterns in this window — the smallest of them are absent from this census`,
      );
    }
  }
  return {
    notMeasured,
    patterns: [...merged.entries()].map(([fingerprint, count]) => ({ count, fingerprint })),
  };
}

/**
 * Every pattern one service wrote, re-partitioned by status when one request cannot hold them all.
 *
 * @param client the shared client
 * @param service the service to count, or the absent marker
 * @param window the absolute window
 * @returns the patterns, and one line per partition that stayed at the ceiling
 */
async function readServicePatterns({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ patterns: readonly CountedPattern[]; notMeasured: readonly string[] }> {
  const whole = await countPatterns({ client, query: serviceClause({ service }), window });
  if (whole.isErr()) {
    return { notMeasured: [`${service}'s log patterns — not counted: ${whole.error.join("; ")}`], patterns: [] };
  }
  if (!whole.value.truncated) {
    return { notMeasured: [], patterns: whole.value.patterns };
  }
  return partitionByStatus({ client, service, window });
}

/**
 * The shape one counted pattern becomes, query included.
 *
 * @param service the service that wrote it
 * @param pattern the counted pattern
 * @returns the shape an exemplar pass consumes
 */
export function patternShape({ service, pattern }: { service: string; pattern: CountedPattern }): CountedShape {
  return {
    count: pattern.count,
    identity: pattern.fingerprint,
    // Replaced by the exemplar's own template where one comes back; a pattern nothing could be read for
    // still names itself by the fingerprint a query takes.
    label: `pattern ${pattern.fingerprint}`,
    members: [],
    membersTruncated: false,
    query: `${serviceClause({ service })} ${FINGERPRINT_FACET}:${pattern.fingerprint}`,
    service,
  };
}

/**
 * Build the whole logs census: every service, every pattern, one exemplar page each.
 *
 * @param client the shared client, for the aggregates
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where per-phase progress goes, so a forty-minute pass is not a silent one
 * @returns the rows, the services and everything the pass could not reach
 */
export async function censusLogs({
  client,
  requester,
  window,
  logger,
}: {
  client: CensusClient;
  requester: RawRequester;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ProductCensus> {
  const listing = await readLogServices({ client, window });
  const notMeasured: string[] = listing.missed === null ? [] : [listing.missed];
  const shapes: CountedShape[] = [];
  for (const [index, entry] of listing.services.entries()) {
    const found = await readServicePatterns({ client, service: entry.service, window });
    notMeasured.push(...found.notMeasured);
    shapes.push(...found.patterns.map((pattern) => patternShape({ pattern, service: entry.service })));
    logger.info({
      msg: `census logs ${String(index + 1)}/${String(listing.services.length)} ${entry.service} → ${String(found.patterns.length)} pattern(s)`,
    });
  }
  logger.info({ msg: `census logs: ${String(shapes.length)} pattern(s) counted, fetching one exemplar each` });
  const exemplified = await exemplifyShapes({ logger, product: "logs", requester, shapes, track: "logs", window });
  return {
    notMeasured: [...notMeasured, ...exemplified.notMeasured],
    rows: labelFromTemplate({ rows: exemplified.rows }),
    services: listing.services,
  };
}

/**
 * Give each pattern row the template its exemplar produced, where one came back.
 *
 * A row's label is what a person reads and what the gate matches, so a fingerprint is the fallback rather
 * than the answer — and the substitution happens HERE, once, rather than inside the shared exemplar phase,
 * which has no business knowing that the logs product has a message at all.
 *
 * @param rows the rows the exemplar phase produced
 * @returns the same rows, each labelled by its template where it has one
 */
function labelFromTemplate({ rows }: { rows: readonly CensusRow[] }): readonly CensusRow[] {
  return rows.map((row) => {
    if (row.template === null || row.template.length === 0) {
      return row;
    }
    return { ...row, label: row.template };
  });
}
