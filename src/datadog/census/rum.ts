/**
 * The RUM census: every browser application, the event types it emits, and the routes those happen on.
 *
 * MEASURED on this install's site over one day: `customer-ui` emits millions of `resource` events, about a
 * hundred thousand each of `long_task` and `action`, and tens of thousands of `view` and `session` events, and the view groups underneath are the
 * application's own routes (`/overview`, `/checkout/deposit`, `/customers/?`). So a row is keyed on
 * `(application, @type)` and the route groups are its members — which is the vocabulary a person uses when
 * they ask what a page does, rather than the one the transport uses.
 *
 * The RUM budget is the most generous of any product here (`rum_public_analytics_aggregate_api`, 167 per 60
 * seconds), so this phase is two requests per application and costs seconds.
 */

import type { Logger } from "../../lib/logger.js";
import { presentOr } from "../detective/envelope.js";
import { quoteTerm } from "../detective/shape.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { rumGroups } from "./aggregate.js";
import { type CountedShape, exemplifyShapes } from "./exemplify.js";
import type { CensusMember } from "./row.js";
import {
  type CensusClient,
  type ProductCensus,
  SERVICE_LIMIT,
  type ServiceVolume,
  serviceClause,
  serviceOfBucket,
} from "./scope.js";

/** How many event types one request asks for — RUM declares a handful, so this is a ceiling with headroom. */
const TYPE_LIMIT = 20;

/** How many route groups one request asks for, per application. */
const VIEW_LIMIT = 500;

/** The facet a RUM event's own kind is queried by. */
const TYPE_FACET = "@type";

/** The facet a RUM event's route group is queried by. */
const VIEW_FACET = "@view.url_path_group";

/**
 * Every RUM application that emitted in the window, with its volume.
 *
 * Read off the events rather than off the applications API deliberately: an application that is registered
 * and silent is a fact about configuration, while this census is about what the telemetry actually holds.
 * The registered list stays in the service map beside it, so both are available and neither is mistaken for
 * the other.
 *
 * @param client the shared client
 * @param window the absolute window
 * @returns the applications, and the line for a listing that failed
 */
async function readRumApplications({
  client,
  window,
}: {
  client: CensusClient;
  window: AbsoluteWindow;
}): Promise<{ services: readonly ServiceVolume[]; missed: string | null }> {
  const grouped = await rumGroups({ client, facets: [{ facet: "service", limit: SERVICE_LIMIT }], query: "*", window });
  if (grouped.isErr()) {
    return { missed: `the RUM application listing — not read: ${grouped.error.join("; ")}`, services: [] };
  }
  return {
    missed: null,
    services: grouped.value.buckets.map((bucket) => ({
      events: bucket.count,
      service: serviceOfBucket({ by: bucket.by }),
    })),
  };
}

/**
 * The route groups one application's event types happen on, keyed by type.
 *
 * @param client the shared client
 * @param query the clause selecting the application
 * @param window the absolute window
 * @returns the members by event type, whether the request reached its ceiling, and the line for a failure
 */
async function readViewGroups({
  client,
  query,
  window,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
}): Promise<{ byType: ReadonlyMap<string, readonly CensusMember[]>; truncated: boolean; missed: string | null }> {
  const grouped = await rumGroups({
    client,
    facets: [
      { facet: TYPE_FACET, limit: TYPE_LIMIT },
      { facet: VIEW_FACET, limit: VIEW_LIMIT },
    ],
    query,
    window,
  });
  if (grouped.isErr()) {
    return { byType: new Map(), missed: grouped.error.join("; "), truncated: false };
  }
  const byType = new Map<string, CensusMember[]>();
  for (const bucket of grouped.value.buckets) {
    const type = bucket.by[TYPE_FACET];
    const view = bucket.by[VIEW_FACET];
    if (type === undefined || view === undefined) {
      continue;
    }
    const existing = byType.get(type);
    if (existing === undefined) {
      byType.set(type, [{ count: bucket.count, name: view }]);
      continue;
    }
    existing.push({ count: bucket.count, name: view });
  }
  return { byType, missed: null, truncated: grouped.value.truncated };
}

/**
 * Count one application's event types and attach the routes each happens on.
 *
 * @param client the shared client
 * @param service the application
 * @param window the absolute window
 * @returns the shapes an exemplar pass consumes, and what this application's requests could not reach
 */
async function countApplication({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ shapes: readonly CountedShape[]; notMeasured: readonly string[] }> {
  const query = serviceClause({ service });
  const types = await rumGroups({ client, facets: [{ facet: TYPE_FACET, limit: TYPE_LIMIT }], query, window });
  if (types.isErr()) {
    return { notMeasured: [`${service}'s RUM event types — not counted: ${types.error.join("; ")}`], shapes: [] };
  }
  const views = await readViewGroups({ client, query, window });
  const notMeasured = views.missed === null ? [] : [`${service}'s RUM route groups — not read: ${views.missed}`];
  const shapes = types.value.buckets.flatMap((bucket): readonly CountedShape[] => {
    const type = bucket.by[TYPE_FACET];
    if (type === undefined || type.length === 0) {
      return [];
    }
    const members = views.byType.get(type);
    return [
      {
        count: bucket.count,
        identity: type,
        label: `${service} ${type}`,
        members: presentOr({ absent: [], value: members }),
        membersTruncated: views.truncated,
        query: `${query} ${TYPE_FACET}:${quoteTerm({ value: type })}`,
        service,
      },
    ];
  });
  return { notMeasured, shapes };
}

/**
 * Build the RUM census: every application, every event type, its route groups and one exemplar page.
 *
 * @param client the shared client, for the aggregates
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where per-application progress goes
 * @returns the rows, the applications and everything the pass could not reach
 */
export async function censusRum({
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
  const listing = await readRumApplications({ client, window });
  const notMeasured: string[] = listing.missed === null ? [] : [listing.missed];
  const shapes: CountedShape[] = [];
  for (const entry of listing.services) {
    const counted = await countApplication({ client, service: entry.service, window });
    notMeasured.push(...counted.notMeasured);
    shapes.push(...counted.shapes);
    logger.info({ msg: `census rum ${entry.service} → ${String(counted.shapes.length)} event type(s)` });
  }
  const exemplified = await exemplifyShapes({ logger, product: "rum", requester, shapes, track: "rum", window });
  return {
    notMeasured: [...notMeasured, ...exemplified.notMeasured],
    rows: exemplified.rows,
    services: listing.services,
  };
}
