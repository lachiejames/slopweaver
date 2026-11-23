/**
 * What a Datadog catalogue IS — the census document, the service map beside it, and the residue it states.
 *
 * Pure: the types, the schema version, and the folds a reader needs. {@link ./store} does the I/O, and
 * {@link ../census/build} is what fills it.
 *
 * ## It is a CENSUS now, not a sample, and that is the whole of the change
 *
 * The first version of this document sampled 500 events per `(family, env, service, status)` cell under a
 * 400-cell ceiling, and reported what it deferred. On a real organisation that ceiling deferred hundreds of
 * cells, more than the shapes it held. The owner rejects a ceiling as the wrong question: the atlas is
 * supposed to hold **every** shape of **every** service — every log pattern, every span kind with the fields
 * it carries, and the same for RUM, CI, tests and database monitoring — with a budget of about 10
 * gigabytes. So a row is now counted by the product's own aggregate and exemplified one shape at a time,
 * there is no cell ceiling to raise, and `notMeasured` reports a provider LIMIT rather than a budget this
 * code chose.
 *
 * ## Three things land, and no event ever does
 *
 * The service map (what runs, what watches it, what it talks to), the census rows (what every shape looks
 * like and how big it is), and the service volumes (how much each service emits, per product). The learnings
 * are the fourth thing a detective reads and they are deliberately NOT here: the knowledge register holds
 * them and `slopweaver knowledge recall` already prints them.
 *
 * ## The document states what it did not measure
 *
 * `notMeasured` is a field rather than a convention because the honest bound on a census is the thing a
 * reader most needs and least naturally asks for: a pass that reached twelve of thirty services is a useful
 * document and a dangerous one, and the difference is entirely whether it says so.
 */

import type { CensusProduct } from "../census/product.js";
import type { CensusRow } from "../census/row.js";

/**
 * The document's own version, bumped whenever a reader of an older file would be wrong rather than poorer.
 *
 * `2` is the census. A version-1 file held sampled shape rows under a cell ceiling and cannot be read by
 * this schema at all, which is the correct outcome: its rows claimed a `sampled` count that the census's own
 * `count` does not mean.
 */
export const CATALOGUE_SCHEMA_VERSION = 2;

/** One entry of the Software Catalog. */
export interface MapEntity {
  readonly kind: string;
  readonly name: string;
  readonly owner: string | null;
}

/** One monitor, with the query that is the written record of what somebody decided was worth watching. */
export interface MapMonitor {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly query: string;
}

/** One dashboard. */
export interface MapDashboard {
  readonly id: string;
  readonly title: string;
}

/** One log pipeline — one per source on this organisation. */
export interface MapPipeline {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

/** One log index and what it retains, which is the ceiling every window is checked against. */
export interface MapIndex {
  readonly name: string;
  readonly retentionDays: number | null;
}

/** One RUM application, as the RUM configuration API declares it rather than as its events report it. */
export interface MapRumApplication {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/** One metric namespace and how many metric names sit under it. */
export interface MapMetricNamespace {
  readonly namespace: string;
  readonly names: number;
}

/**
 * One edge of the service graph, read off spans rather than off the dependency API.
 *
 * MEASURED: `GET /api/v1/service_dependencies?env=production` returned a couple of dozen services
 * and ONE edge on a real organisation. The console's own map is drawn from spans, so this is too — a
 * `service × operation_name` aggregate is what actually carries the graph. Reproduce the thin answer with
 * `slopweaver datadog raw --path '/api/v1/service_dependencies?env=production'`.
 */
export interface MapEdge {
  readonly service: string;
  readonly operation: string;
  readonly spans: number;
}

/** What runs, what watches it, and what it talks to. */
export interface ServiceMap {
  readonly entities: readonly MapEntity[];
  readonly monitors: readonly MapMonitor[];
  readonly dashboards: readonly MapDashboard[];
  readonly pipelines: readonly MapPipeline[];
  readonly indexes: readonly MapIndex[];
  readonly rumApplications: readonly MapRumApplication[];
  readonly metricNamespaces: readonly MapMetricNamespace[];
  readonly edges: readonly MapEdge[];
}

/** How much one service emitted of one product, from the aggregate rather than from the rows. */
export interface ServiceVolume {
  readonly product: CensusProduct;
  readonly service: string;
  readonly events: number;
}

/** What one product's pass produced, so a reader can see where a thin section came from. */
export interface ProductTally {
  readonly product: CensusProduct;
  readonly rows: number;
  /** How many of those rows had at least one exemplar folded into them. */
  readonly exemplified: number;
  /** What this product's pass could not reach, in the words a report prints verbatim. */
  readonly notMeasured: readonly string[];
}

/** The absolute window a pass measured over, stated on every number it produced. *
 * @internal
 */
export interface CatalogueWindow {
  readonly fromIso: string;
  readonly toIso: string;
}

/** Everything about a census except the rows themselves, which stream beside it. *
 * @internal
 */
export interface CatalogueManifest {
  readonly schemaVersion: number;
  readonly builtAtIso: string;
  /** The Datadog site the pass read, so a census cannot be read against another organisation. */
  readonly site: string;
  readonly window: CatalogueWindow;
  /** The shortest retention across the indexes the map found, or nothing when none reported one. */
  readonly retentionDays: number | null;
  readonly map: ServiceMap;
  /** Every `(product, service)` pair that emitted in the window, with its volume. */
  readonly services: readonly ServiceVolume[];
  /** How many rows sit in the file beside this one. */
  readonly rows: number;
  /** One entry per product this pass ran. A product absent here was not asked for. */
  readonly products: readonly ProductTally[];
  /** What this pass did not reach, in the words a brief prints verbatim. */
  readonly notMeasured: readonly string[];
}

/** A manifest and the rows it describes, in memory. */
export interface Catalogue {
  readonly manifest: CatalogueManifest;
  readonly rows: readonly CensusRow[];
}

/**
 * Every distinct service the census knows about, from the rows and the volumes alike.
 *
 * Both sources, because they disagree in a way that matters: the volumes hold every service that emitted
 * anything, while the rows hold only the services a product's pass actually produced shapes for. A gate that
 * consulted only the rows would tell a detective that Datadog has nothing to say about a service whose
 * pattern pass failed.
 *
 * @returns the service names, sorted
 */
export function catalogueServices({ catalogue }: { catalogue: Catalogue }): readonly string[] {
  const names = new Set<string>();
  for (const volume of catalogue.manifest.services) {
    names.add(volume.service);
  }
  for (const row of catalogue.rows) {
    names.add(row.service);
  }
  for (const edge of catalogue.manifest.map.edges) {
    names.add(edge.service);
  }
  return [...names].toSorted();
}

/**
 * Every environment the census observed on an exemplar.
 *
 * @returns the environment names, sorted
 */
export function catalogueEnvs({ catalogue }: { catalogue: Catalogue }): readonly string[] {
  const names = new Set<string>();
  for (const row of catalogue.rows) {
    for (const env of row.envs) {
      names.add(env);
    }
  }
  return [...names].toSorted();
}

/**
 * How much each service emits, summed across every product it appears in.
 *
 * @returns the totals, by service name
 */
export function serviceTotals({ catalogue }: { catalogue: Catalogue }): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const volume of catalogue.manifest.services) {
    const seen = totals.get(volume.service);
    totals.set(volume.service, seen === undefined ? volume.events : seen + volume.events);
  }
  return totals;
}

/**
 * The shortest retention any index reports, which is the ceiling a window is checked against.
 *
 * The SHORTEST rather than the longest, because a query that spans two indexes is answered by both and the
 * one that has already rolled over contributes silent zeros — the tier-1 knowledge row's own finding. A
 * ceiling taken from the longest would call that window legal.
 *
 * @returns the days, or nothing when no index reported a retention
 */
export function shortestRetentionDays({ indexes }: { indexes: readonly MapIndex[] }): number | null {
  const days = indexes.map((index) => index.retentionDays).filter((value): value is number => value !== null);
  return days.length === 0 ? null : Math.min(...days);
}
