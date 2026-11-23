/**
 * The telemetry products a census covers, and what each one's shapes are keyed on. Pure.
 *
 * ## Why a product list rather than the old family list
 *
 * The sampling catalogue this replaced knew five FAMILIES of one index each, because it sampled events and
 * folded them. A census counts first, and what can be counted is decided by the product's own analytics
 * endpoint: logs, spans, RUM, CI pipelines, CI tests, database queries, profiles and metrics each publish a
 * different one. So the unit here is the product, and the identity a row is keyed on is the one that product
 * actually discriminates by — a log pattern's fingerprint, a span's operation and kind, a RUM view group, a
 * pipeline, a test suite, a query signature, a metric name.
 *
 * Everything is in scope: anything in Datadog that has logs or telemetry belongs in the atlas, and for the voluminous products the atlas holds
 * SHAPES rather than rows.
 *
 * ## The unified event track is how an exemplar is fetched
 *
 * Every product below except `metrics` has a track on Datadog's own event platform
 * (`POST /api/v1/logs-analytics/list?type=<track>`), which is what every Explorer page in the console calls.
 * MEASURED on this install's site: it is metered at **85 requests per 10 seconds shared across every track**,
 * against 3 per 10 seconds for the public logs search and 5 per 60 seconds for spans. That single fact is
 * what makes one exemplar per shape affordable — tens of thousands of log patterns take under an hour rather than a day.
 * Reproduce the budget with the `x-ratelimit-name` header on any call:
 * `slopweaver datadog raw --method POST --path '/api/v1/logs-analytics/list?type=logs' --body '{"list":{}}'`.
 */
import type { UnifiedTrack } from "./boundaries.js";

/** Every product a census pass covers, in the order a report prints them. */
export const CENSUS_PRODUCTS = [
  "logs",
  "spans",
  "rum",
  "ci-pipelines",
  "ci-tests",
  "dbm",
  "profiles",
  "metrics",
] as const;

/** One product's id. */
export type CensusProduct = (typeof CENSUS_PRODUCTS)[number];

/** What one product is, and how a reader is meant to understand its rows. */
export interface CensusProductSpec {
  readonly product: CensusProduct;
  /** One line naming what a row of this product describes. */
  readonly meaning: string;
  /** The event-platform track an exemplar comes from, or nothing for a product with no events. */
  readonly track: UnifiedTrack | null;
}

/**
 * Every product, declared once.
 *
 * `track` is `null` only for `metrics`, which has no events at all: a metric's shape is its name, its type
 * and its tag keys, read from the metrics API rather than folded from an occurrence.
 *
 * @internal
 */
export const CENSUS_PRODUCT_SPECS: readonly CensusProductSpec[] = [
  {
    meaning: "a log pattern, keyed on Datadog's own message fingerprint",
    product: "logs",
    track: "logs",
  },
  {
    meaning: "a span kind, keyed on the operation it names and the span kind it carries",
    product: "spans",
    track: "trace",
  },
  {
    meaning: "a browser event, keyed on the application, the event type and the route group",
    product: "rum",
    track: "rum",
  },
  {
    meaning: "a CI pipeline shape, keyed on the pipeline name and the level of the event",
    product: "ci-pipelines",
    track: "cipipeline",
  },
  {
    meaning: "a test shape, keyed on the test service and the suite",
    product: "ci-tests",
    track: "citest",
  },
  {
    meaning: "a database query shape, keyed on the query signature — never the statement text",
    product: "dbm",
    track: "databasequery",
  },
  {
    meaning: "a profile shape, keyed on the service and the profiler family",
    product: "profiles",
    track: "profile",
  },
  {
    meaning: "a metric, keyed on its own name, carrying the tag keys it is queryable by",
    product: "metrics",
    track: null,
  },
];

/**
 * One product's declaration.
 *
 * @returns its spec
 */
export function censusProductSpec({ product }: { product: CensusProduct }): CensusProductSpec {
  const found = CENSUS_PRODUCT_SPECS.find((spec) => spec.product === product);
  if (found === undefined) {
    // Unreachable while both lists are derived from the same union, and asserted rather than defaulted: a
    // silent fallback here would describe one product as another in every row it wrote.
    throw new Error(`no census product spec for ${product}`);
  }
  return found;
}

/**
 * Read a product name against the closed list, refusing an unknown one.
 *
 * @param raw what the caller typed
 * @returns the product, or nothing when no product goes by that name
 */
export function censusProductNamed({ raw }: { raw: string }): CensusProduct | null {
  const found = CENSUS_PRODUCTS.find((product) => product === raw);
  if (found === undefined) {
    return null;
  }
  return found;
}
