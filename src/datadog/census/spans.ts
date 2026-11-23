/**
 * The SPANS census: every span kind every service emits, what each carries, and what sits under it.
 *
 * Spans come in kinds: node inbound, HTTP outbound, Prisma internals and more. Each kind gets a shape, so
 * that before anyone goes into Datadog they know what to look for and which fields each span carries. So a row is keyed on
 * `operation_name` × `@span.kind`, which is exactly that vocabulary — `postgresql.query (client)`,
 * `http.server.request (server)` — and the resources underneath it are the members.
 *
 * ## Two requests per service, and why not one
 *
 * Datadog caps a request at 10,000 groups across all dimensions, so `operation × kind × resource` in one
 * call would force a resource limit of about forty per operation and silently drop the tail. Two calls —
 * `operation × kind`, then `operation × resource` — keep both complete to their own limits. The spans budget
 * is the tightest of any product here (`spans_public_api`, MEASURED 5 requests per 60 seconds on this install's site, shared
 * between search and aggregate), so this phase is paced rather than quick, and that is stated in the report
 * rather than hidden.
 */

import type { Logger } from "../../lib/logger.js";
import { presentOr } from "../detective/envelope.js";
import { quoteTerm } from "../detective/shape.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { spanGroups } from "./aggregate.js";
import { type CountedShape, exemplifyShapes } from "./exemplify.js";
import type { CensusMember } from "./row.js";
import { type CensusClient, type ProductCensus, SERVICE_LIMIT, type ServiceVolume, serviceClause } from "./scope.js";

/** How many operations one per-service request asks for. */
const OPERATION_LIMIT = 100;

/** How many span kinds one per-service request asks for — the vocabulary is a handful, not a hundred. */
const KIND_LIMIT = 20;

/** How many resources one per-service request asks for, per operation. */
const RESOURCE_LIMIT = 100;

/** The facet a span's kind is queried by. Custom, so it carries the `@` sigil. */
const KIND_FACET = "@span.kind";

/** What a kind or an operation reads as when a span declared none. */
const ABSENT = "(none)";

/** One `(operation, kind)` shape a service emits, counted, before exemplars. */
interface CountedSpanShape {
  readonly service: string;
  readonly operation: string;
  readonly kind: string;
  readonly count: number;
}

/**
 * Every service the spans index holds, with its own volume over the window.
 *
 * @param client the shared client
 * @param window the absolute window
 * @returns the services, and the line for a listing that truncated or failed
 */
async function readSpanServices({
  client,
  window,
}: {
  client: CensusClient;
  window: AbsoluteWindow;
}): Promise<{ services: readonly ServiceVolume[]; missed: string | null }> {
  const grouped = await spanGroups({
    client,
    facets: [{ facet: "service", limit: SERVICE_LIMIT }],
    query: "*",
    window,
  });
  if (grouped.isErr()) {
    return { missed: `the spans service listing — not read: ${grouped.error.join("; ")}`, services: [] };
  }
  return {
    missed: grouped.value.truncated
      ? `the spans service listing reached its ${String(SERVICE_LIMIT)}-group limit — services beyond it are absent from this census`
      : null,
    services: grouped.value.buckets.map((bucket) => {
      const name = bucket.by["service"];
      return { events: bucket.count, service: name === undefined || name.length === 0 ? ABSENT : name };
    }),
  };
}

/**
 * The `(operation, kind)` shapes one service emits.
 *
 * @param client the shared client
 * @param service the service to count
 * @param window the absolute window
 * @returns the shapes, and the line for a partition that reached its ceiling
 */
async function readServiceSpanShapes({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ shapes: readonly CountedSpanShape[]; notMeasured: readonly string[] }> {
  const grouped = await spanGroups({
    client,
    facets: [
      { facet: "operation_name", limit: OPERATION_LIMIT },
      { facet: KIND_FACET, limit: KIND_LIMIT },
    ],
    query: serviceClause({ service }),
    window,
  });
  if (grouped.isErr()) {
    return { notMeasured: [`${service}'s span kinds — not counted: ${grouped.error.join("; ")}`], shapes: [] };
  }
  const shapes = grouped.value.buckets.map((bucket) => {
    const operation = bucket.by["operation_name"];
    const kind = bucket.by[KIND_FACET];
    return {
      count: bucket.count,
      kind: kind === undefined || kind.length === 0 ? ABSENT : kind,
      operation: operation === undefined || operation.length === 0 ? ABSENT : operation,
      service,
    };
  });
  return {
    notMeasured: grouped.value.truncated
      ? [
          `${service} emits more than ${String(OPERATION_LIMIT)} span operations in this window — the rarest of them are absent from this census`,
        ]
      : [],
    shapes,
  };
}

/**
 * The resources one service's operations carry, which become the members under each shape.
 *
 * @param client the shared client
 * @param service the service to read
 * @param window the absolute window
 * @returns the members by operation, and the line for a request that reached its ceiling
 */
async function readServiceResources({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ byOperation: ReadonlyMap<string, readonly CensusMember[]>; truncated: boolean; missed: string | null }> {
  const grouped = await spanGroups({
    client,
    facets: [
      { facet: "operation_name", limit: OPERATION_LIMIT },
      { facet: "resource_name", limit: RESOURCE_LIMIT },
    ],
    query: serviceClause({ service }),
    window,
  });
  if (grouped.isErr()) {
    return {
      byOperation: new Map(),
      missed: `${service}'s span resources — not read: ${grouped.error.join("; ")}`,
      truncated: false,
    };
  }
  const byOperation = new Map<string, CensusMember[]>();
  for (const bucket of grouped.value.buckets) {
    const operation = bucket.by["operation_name"];
    const resource = bucket.by["resource_name"];
    if (operation === undefined || resource === undefined) {
      continue;
    }
    const existing = byOperation.get(operation);
    if (existing === undefined) {
      byOperation.set(operation, [{ count: bucket.count, name: resource }]);
      continue;
    }
    existing.push({ count: bucket.count, name: resource });
  }
  return { byOperation, missed: null, truncated: grouped.value.truncated };
}

/**
 * The query that selects one span shape's own events.
 *
 * @param shape the counted shape
 * @returns the query
 */
export function spanShapeQuery({ shape }: { shape: CountedSpanShape }): string {
  const kind = shape.kind === ABSENT ? [] : [`${KIND_FACET}:${quoteTerm({ value: shape.kind })}`];
  return [
    serviceClause({ service: shape.service }),
    `operation_name:${quoteTerm({ value: shape.operation })}`,
    ...kind,
  ].join(" ");
}

/**
 * Count one service's span shapes and attach the resources under each.
 *
 * @param client the shared client
 * @param service the service to read
 * @param window the absolute window
 * @returns the shapes an exemplar pass consumes, and what this service's two requests could not reach
 */
async function countServiceSpans({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ shapes: readonly CountedShape[]; notMeasured: readonly string[] }> {
  const counted = await readServiceSpanShapes({ client, service, window });
  const resources = await readServiceResources({ client, service, window });
  const notMeasured = [...counted.notMeasured, ...(resources.missed === null ? [] : [resources.missed])];
  const shapes = counted.shapes.map((shape): CountedShape => {
    const members = resources.byOperation.get(shape.operation);
    return {
      count: shape.count,
      identity: `${shape.operation}|${shape.kind}`,
      label: `${shape.operation} (${shape.kind})`,
      members: presentOr({ absent: [], value: members }),
      membersTruncated: resources.truncated,
      query: spanShapeQuery({ shape }),
      service: shape.service,
    };
  });
  return { notMeasured, shapes };
}

/**
 * Build the whole spans census: every service, every `(operation, kind)`, its resources and one exemplar page.
 *
 * @param client the shared client, for the aggregates
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where per-service progress goes
 * @returns the rows, the services and everything the pass could not reach
 */
export async function censusSpans({
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
  const listing = await readSpanServices({ client, window });
  const notMeasured: string[] = listing.missed === null ? [] : [listing.missed];
  const shapes: CountedShape[] = [];
  for (const [index, entry] of listing.services.entries()) {
    const counted = await countServiceSpans({ client, service: entry.service, window });
    notMeasured.push(...counted.notMeasured);
    shapes.push(...counted.shapes);
    logger.info({
      msg: `census spans ${String(index + 1)}/${String(listing.services.length)} ${entry.service} → ${String(counted.shapes.length)} span kind(s)`,
    });
  }
  const exemplified = await exemplifyShapes({ logger, product: "spans", requester, shapes, track: "trace", window });
  return {
    notMeasured: [...notMeasured, ...exemplified.notMeasured],
    rows: exemplified.rows,
    services: listing.services,
  };
}
