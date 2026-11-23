/**
 * Reading the service map — what runs, what watches it, and what it talks to. The effectful edge.
 *
 * ## The map is read off SPANS, not off the dependency API
 *
 * MEASURED on a real organisation: `GET /api/v1/service_dependencies?env=production` returned a
 * couple of dozen services and exactly ONE edge. The console's own service map is drawn from spans, so this
 * is too — a `service × operation_name` aggregate over the spans index is what actually carries the graph,
 * and it returned tens of millions of `postgresql.query` spans and hundreds of thousands each of
 * `http.server.request` and `http.client.request` on the same day. Reproduce the thin answer with
 * `slopweaver datadog raw --path '/api/v1/service_dependencies?env=production'`.
 *
 * ## Every leg is optional and none of them is fatal
 *
 * A map is useful when it is partial and useless when it is absent, so a leg that fails contributes an
 * EMPTY list and one line to the build's `notMeasured` rather than failing the build. The alternative — one
 * missing scope on one endpoint kills the whole catalogue — is the shape that makes a tool nobody runs.
 *
 * ## The monitors are stored whole, query included
 *
 * Hundreds of monitors with their queries is the written record of what somebody decided was worth watching, and
 * each query is a shape somebody already found useful. A monitor's title and its query are both matched by
 * the catalogue gate, which is why the query is stored rather than summarised.
 */

import { incrementCount } from "#lib/collections.js";
import type { DatadogClient } from "../client.js";
import type { AbsoluteWindow } from "../window.js";
import { windowAsQueryBounds } from "../window.js";
import type {
  MapDashboard,
  MapEdge,
  MapEntity,
  MapIndex,
  MapMetricNamespace,
  MapMonitor,
  MapPipeline,
  MapRumApplication,
  ServiceMap,
} from "./catalogue.js";
import { presentOr } from "./envelope.js";

/** A map, and every leg that did not come back. */
export interface MapReading {
  readonly map: ServiceMap;
  /** One line per leg that failed, in the words the manifest's `notMeasured` prints. */
  readonly notMeasured: readonly string[];
}

/** How many monitors, dashboards and metric names one leg asks for. */
const PAGE = 1000;

/** How many `(service, operation)` groups the span aggregate asks for, per facet. */
const EDGE_GROUPS = 100;

/**
 * Run one map leg, turning a throw into an empty result and a stated line.
 *
 * @param what the leg's own name, as `notMeasured` prints it
 * @param read the call
 * @returns what it returned, or nothing plus the line saying so
 */
async function leg<T>({
  what,
  read,
}: {
  what: string;
  read: () => Promise<readonly T[]>;
}): Promise<{ values: readonly T[]; missed: string | null }> {
  try {
    return { missed: null, values: await read() };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { missed: `${what} — not read: ${detail}`, values: [] };
  }
}

/**
 * The metric namespace of one metric name — everything before its first dot.
 *
 * Namespaces rather than names, because a couple of thousand metric names is a list nobody reads and a
 * handful of namespaces is a fact about what an organisation instruments. The gate matches on the namespace for the same reason.
 *
 * @returns the namespace
 */
export function metricNamespace({ name }: { name: string }): string {
  // A split always yields at least one element, so the first is present — an honest assertion rather than a
  // fallback to the whole name, which would have been a second answer nobody asked for.
  return name.split(".")[0]!;
}

/**
 * Fold metric names into one entry per namespace, largest first.
 *
 * @param names every metric name the metrics listing returned
 * @returns one entry per namespace
 */
export function foldMetricNamespaces({ names }: { names: readonly string[] }): readonly MapMetricNamespace[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const namespace = metricNamespace({ name });
    incrementCount({ counts, key: namespace });
  }
  return [...counts.entries()]
    .map(([namespace, count]) => ({ names: count, namespace }))
    .toSorted((left, right) => right.names - left.names || left.namespace.localeCompare(right.namespace));
}

/** Every list the map is assembled from, each already carrying the line for a leg that failed. */
interface MapLegs {
  readonly entities: { values: readonly MapEntity[]; missed: string | null };
  readonly monitors: { values: readonly MapMonitor[]; missed: string | null };
  readonly dashboards: { values: readonly MapDashboard[]; missed: string | null };
  readonly pipelines: { values: readonly MapPipeline[]; missed: string | null };
  readonly indexes: { values: readonly MapIndex[]; missed: string | null };
  readonly rumApplications: { values: readonly MapRumApplication[]; missed: string | null };
  readonly metricNames: { values: readonly string[]; missed: string | null };
  readonly edges: { values: readonly MapEdge[]; missed: string | null };
}

/**
 * Run every configuration leg of the map — the lists that describe what EXISTS rather than what happened.
 *
 * Split from {@link readServiceMap} so that function stays a composition rather than a hundred-line sequence
 * of near-identical blocks: each leg here is one endpoint and one projection, and a reader checking whether a
 * field is read correctly wants the eight of them side by side.
 *
 * @param client the shared client
 * @param window the absolute window the span edges are measured over
 * @returns every leg, each with its own values and its own failure line
 */
async function readMapLegs({ client, window }: { client: DatadogClient; window: AbsoluteWindow }): Promise<MapLegs> {
  return {
    dashboards: await leg<MapDashboard>({ read: () => readDashboards({ client }), what: "the dashboard listing" }),
    edges: await readSpanEdges({ client, window }),
    entities: await leg<MapEntity>({
      read: () => readEntities({ client }),
      what: "the Software Catalog entity listing",
    }),
    indexes: await leg<MapIndex>({ read: () => readIndexes({ client }), what: "the log index listing" }),
    metricNames: await leg<string>({ read: () => readMetricNames({ client }), what: "the metric name listing" }),
    monitors: await leg<MapMonitor>({ read: () => readMonitors({ client }), what: "the monitor listing" }),
    pipelines: await leg<MapPipeline>({ read: () => readPipelines({ client }), what: "the log pipeline listing" }),
    rumApplications: await leg<MapRumApplication>({
      read: () => readRumApplications({ client }),
      what: "the RUM application listing",
    }),
  };
}

/**
 * The dashboards, projected to what the map keeps.
 *
 * @param client the shared client
 * @returns one entry per dashboard
 */
async function readDashboards({ client }: { client: DatadogClient }): Promise<readonly MapDashboard[]> {
  const response = await client.dashboards.listDashboards({});
  const dashboards = presentOr({ absent: [], value: response.dashboards });
  return dashboards.map((dashboard) => {
    return {
      id: presentOr({ absent: "(unknown)", value: dashboard.id }),
      title: presentOr({ absent: "(untitled)", value: dashboard.title }),
    };
  });
}

/**
 * The Software Catalog entities, projected to what the map keeps.
 *
 * @param client the shared client
 * @returns one entry per entity
 */
async function readEntities({ client }: { client: DatadogClient }): Promise<readonly MapEntity[]> {
  const response = await client.softwareCatalog.listCatalogEntity({ pageLimit: PAGE });
  const data = presentOr({ absent: [], value: response.data });
  return data.map((entity) => {
    const attributes = presentOr({ absent: {}, value: entity.attributes });
    return {
      kind: presentOr({ absent: "(unknown)", value: attributes.kind }),
      name: presentOr({ absent: "(unnamed)", value: attributes.name }),
      owner: presentOr({ absent: null, value: attributes.owner }),
    };
  });
}

/**
 * The log indexes, whose shortest retention becomes the ceiling every window is checked against.
 *
 * @param client the shared client
 * @returns one entry per index
 */
async function readIndexes({ client }: { client: DatadogClient }): Promise<readonly MapIndex[]> {
  const response = await client.logsIndexes.listLogIndexes();
  const indexes = presentOr({ absent: [], value: response.indexes });
  return indexes.map((index) => {
    return { name: index.name, retentionDays: presentOr({ absent: null, value: index.numRetentionDays }) };
  });
}

/**
 * Every metric NAME, which {@link foldMetricNamespaces} then reduces to namespaces.
 *
 * The SDK types each entry as `Metric | MetricTagConfiguration | UnparsedObject`, and only the first two
 * carry an `id`. Reading it through a guard rather than narrowing on `type`, because the third member is
 * precisely the case where the response did not parse as either — a `type` check on it would be reading a
 * field of a value the SDK has already said it could not understand. An entry with no readable id is DROPPED
 * rather than kept under an empty name.
 *
 * @param client the shared client
 * @returns every readable metric name
 */
async function readMetricNames({ client }: { client: DatadogClient }): Promise<readonly string[]> {
  const response = await client.metrics.listTagConfigurations({ pageSize: 10_000 });
  const data = presentOr({ absent: [], value: response.data });
  return data.flatMap((metric) => ("id" in metric && typeof metric.id === "string" ? [metric.id] : []));
}

/**
 * The monitors, stored whole with their queries — the written record of what somebody watches.
 *
 * @param client the shared client
 * @returns one entry per monitor
 */
async function readMonitors({ client }: { client: DatadogClient }): Promise<readonly MapMonitor[]> {
  const response = await client.monitors.listMonitors({ pageSize: PAGE });
  return response.map((monitor) => {
    // Stored whole, query included: 236 monitors with their queries is the written record of what somebody
    // decided was worth watching, and the catalogue gate matches a query as TEXT.
    const { query, type } = monitor;
    const id = presentOr({ absent: -1, value: monitor.id });
    const name = presentOr({ absent: "(unnamed)", value: monitor.name });
    return {
      id,
      name,
      query,
      // `MonitorType` is a string-literal union PLUS `UnparsedObject`, which is the SDK's marker for a value
      // it could not understand. Reading it through a typeof guard is what keeps an unparsed one out of a
      // field the catalogue gate matches as text, rather than stringifying it to `[object Object]`.
      type: typeof type === "string" ? type : "(unknown)",
    };
  });
}

/**
 * The log pipelines, one per source on this organisation.
 *
 * @param client the shared client
 * @returns one entry per pipeline
 */
async function readPipelines({ client }: { client: DatadogClient }): Promise<readonly MapPipeline[]> {
  const response = await client.logsPipelines.listLogsPipelines();
  return response.map((pipeline) => {
    return {
      enabled: presentOr({ absent: false, value: pipeline.isEnabled }),
      id: presentOr({ absent: "(unknown)", value: pipeline.id }),
      name: pipeline.name,
    };
  });
}

/**
 * The RUM applications, which are also what decides whether a RUM cell is worth a request.
 *
 * @param client the shared client
 * @returns one entry per application
 */
async function readRumApplications({ client }: { client: DatadogClient }): Promise<readonly MapRumApplication[]> {
  const response = await client.rum.getRUMApplications();
  const data = presentOr({ absent: [], value: response.data });
  return data.map((application) => ({
    id: application.attributes.applicationId,
    name: application.attributes.name,
    type: application.attributes.type,
  }));
}

/**
 * Read the whole service map.
 *
 * @param client the shared client
 * @param window the absolute window the span edges are measured over
 * @returns the map, and one line per leg that did not come back
 */
export async function readServiceMap({
  client,
  window,
}: {
  client: DatadogClient;
  window: AbsoluteWindow;
}): Promise<MapReading> {
  const legs = await readMapLegs({ client, window });
  return {
    map: {
      dashboards: legs.dashboards.values,
      edges: legs.edges.values,
      entities: legs.entities.values,
      indexes: legs.indexes.values,
      metricNamespaces: foldMetricNamespaces({ names: legs.metricNames.values.filter((name) => name.length > 0) }),
      monitors: legs.monitors.values,
      pipelines: legs.pipelines.values,
      rumApplications: legs.rumApplications.values,
    },
    notMeasured: Object.values(legs)
      .map((one) => one.missed)
      .filter((line): line is string => line !== null),
  };
}

/**
 * Read the `c0` total out of a spans bucket's compute map, whichever of the two fields carried it.
 *
 * The SDK types both as `any`, so this is the guard that makes the read honest: a missing or non-numeric
 * compute returns nothing rather than zero, which is `logsCount.ts`'s own "unreadable is not empty" rule.
 *
 * @param value the bucket's `compute` or `computes` field
 * @returns the count, or nothing when the field does not carry one
 */
function readSpanCompute({ value }: { value: unknown }): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion
  const raw = (value as Record<string, unknown>)["c0"];
  const count = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(count) ? count : null;
}

/**
 * Read the graph's edges off the spans aggregate.
 *
 * Grouped by `service × operation_name` rather than by a peer field, because the spans aggregate's peer
 * facets are inconsistently populated — `postgresql.query` can carry no `peer.service` at all — so an
 * edge keyed on the peer would silently drop the tens of millions of spans that are most of the graph. The
 * operation names what a service TALKS TO, in the vocabulary the instrumentation actually used, and the
 * catalog's own datastores and queues name the far ends.
 *
 * @param client the shared client
 * @param window the absolute window
 * @returns the edges, or nothing plus the line saying why
 */
async function readSpanEdges({
  client,
  window,
}: {
  client: DatadogClient;
  window: AbsoluteWindow;
}): Promise<{ values: readonly MapEdge[]; missed: string | null }> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.spans.aggregateSpans({
      body: {
        data: {
          attributes: {
            compute: [{ aggregation: "count", type: "total" }],
            filter: { from, query: "*", to },
            groupBy: [
              { facet: "service", limit: EDGE_GROUPS, sort: { aggregation: "count", order: "desc", type: "measure" } },
              {
                facet: "operation_name",
                limit: EDGE_GROUPS,
                sort: { aggregation: "count", order: "desc", type: "measure" },
              },
            ],
          },
          type: "aggregate_request",
        },
      },
    });
    const edges: MapEdge[] = [];
    const data = presentOr({ absent: [], value: response.data });
    for (const bucket of data) {
      const attributes = presentOr({ absent: {}, value: bucket.attributes });
      const { compute, computes } = attributes;
      const by = presentOr({ absent: {}, value: attributes.by });
      // MEASURED: the SPANS aggregate answers in `attributes.compute` (singular, an object),
      // not in `attributes.computes` the way the LOGS aggregate does — reproduce with
      // `slopweaver datadog raw --method POST --path /api/v2/spans/analytics/aggregate --body '{"data":{"type":"aggregate_request","attributes":{"compute":[{"aggregation":"count","type":"total"}],"filter":{"query":"*","from":"now-1d","to":"now"},"group_by":[{"facet":"operation_name","limit":5,"sort":{"aggregation":"count","order":"desc","type":"measure"}}]}}}'`.
      // The SDK declares BOTH fields as optional, so reading only one compiles and silently returns zero
      // edges — which is exactly what the first build of this catalogue did. This is the `computes`/`compute`
      // trap `logsCount.ts` names, met on the other surface.
      const singular = readSpanCompute({ value: compute });
      const plural = readSpanCompute({ value: computes });
      let spans = plural;
      if (singular !== null) {
        spans = singular;
      }
      if (spans === null) {
        continue;
      }
      const { operation_name: operation = "(none)", service = "(none)" } = by;
      edges.push({ operation: String(operation), service: String(service), spans });
    }
    return { missed: null, values: edges.toSorted((left, right) => right.spans - left.spans) };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { missed: `the span-derived service edges — not read: ${detail}`, values: [] };
  }
}
