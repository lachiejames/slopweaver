/**
 * Reading buckets back off the four product aggregates the SDK exposes. The effectful edge.
 *
 * ## One reader per product, because the envelopes genuinely differ
 *
 * The logs aggregate answers in `data.buckets[].computes.c0`; RUM and both CI aggregates answer in the same
 * shape; the SPANS aggregate answers in a top-level `data` ARRAY whose members carry `attributes.by` and
 * `attributes.compute` — SINGULAR, an object, not the `computes` map its siblings use. That last difference
 * is the `compute`/`computes` trap `logsCount.ts` names, met on another surface: the SDK declares both
 * fields optional, so reading only one compiles and silently returns zero buckets, which is what the first
 * build of the catalogue this replaces actually did.
 *
 * A bucket whose compute cannot be read as a number is DROPPED rather than read as zero — the same
 * "unreadable is not empty" rule, because a shape reported with a count of zero reads as one that has
 * stopped emitting.
 */

import type { v2 } from "@datadog/datadog-api-client";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { presentOr } from "../detective/envelope.js";
import { type AbsoluteWindow, windowAsQueryBounds } from "../window.js";
import type { CensusClient } from "./scope.js";

/** The compute key every product's aggregate returns its first computation under. */
const TOTAL_COMPUTE_KEY = "c0";

/**
 * Whether one value the SDK typed loosely is a plain object this file may read keys off.
 *
 * A type PREDICATE rather than an assertion, because the SDK types a bucket's `by` and `computes` as `any`
 * and an assertion off `any` is what `no-unsafe-type-assertion` refuses — correctly, since nothing would
 * check it at runtime.
 *
 * @returns true for a record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One enumerated group, with the population the product attributed to it. */
interface ProductBucket {
  readonly by: Readonly<Record<string, string>>;
  readonly count: number;
}

/** One grouped read, with whether the request reached the limit it asked for. */
export interface ProductBuckets {
  readonly buckets: readonly ProductBucket[];
  /** `bucket count >= the product of the per-facet limits` — the only truncation signal Datadog gives. */
  readonly truncated: boolean;
  /**
   * The response's own `meta.traffic_type`, or nothing when it declared none. A spans aggregate declares
   * `"sampled"`; the logs aggregate omits the field. The SDK models it on no envelope, so it is read off
   * `meta.additionalProperties` by {@link trafficTypeFromMeta}.
   */
  readonly trafficType: string | null;
}

/**
 * Read `traffic_type` off one aggregate response's `meta`, where the SDK files every field it does not model.
 *
 * None of the four product envelopes the pinned SDK ships declares `traffic_type`, so the live spans reply's
 * `"sampled"` arrives in `meta.additionalProperties`. Taken as `unknown` and narrowed, because the SDK types
 * that bag as `any` and asserting off it would check nothing at runtime.
 *
 * @param meta the response's `meta` object, exactly as the SDK decoded it
 * @returns the declared traffic type, or nothing when the response carried no string there
 */
export function trafficTypeFromMeta({ meta }: { meta: unknown }): string | null {
  if (!isRecord(meta)) {
    return null;
  }
  const extra = meta["additionalProperties"];
  if (!isRecord(extra)) {
    return null;
  }
  const declared = extra["traffic_type"];
  if (typeof declared !== "string") {
    return null;
  }
  return declared;
}

/** One facet to group by, with how many groups of it to ask for. */
export interface GroupFacet {
  readonly facet: string;
  readonly limit: number;
}

/**
 * Read a compute value as a count, answering nothing when it is absent or not a number.
 *
 * @param raw the bucket's compute value, in whichever of the two fields carried it
 * @returns the count, or nothing
 */
function countOfCompute({ raw }: { raw: unknown }): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Read the `c0` entry out of whichever compute object a bucket carried.
 *
 * @param value the bucket's `computes` map or its singular `compute` object
 * @returns the count, or nothing when the object carries no readable one
 */
function computeTotal({ value }: { value: unknown }): number | null {
  if (!isRecord(value)) {
    return null;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (key === TOTAL_COMPUTE_KEY) {
      return countOfCompute({ raw });
    }
  }
  return null;
}

/**
 * Render a bucket's facet values as strings, dropping a facet the events did not carry.
 *
 * @param by the bucket's own facet map, as the SDK typed it
 * @returns the facet values
 */
function byAsStrings({ by }: { by: unknown }): Readonly<Record<string, string>> {
  if (!isRecord(by)) {
    return {};
  }
  const rendered: Record<string, string> = {};
  for (const [key, value] of Object.entries(by)) {
    if (typeof value === "string") {
      rendered[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      rendered[key] = `${value}`;
    }
  }
  return rendered;
}

/**
 * Whether a grouped read reached the ceiling its own limits implied.
 *
 * @param facets what was asked for
 * @param count how many buckets came back
 * @returns true when the answer may be short of the truth
 */
function truncatedBy({ facets, count }: { facets: readonly GroupFacet[]; count: number }): boolean {
  const ceiling = facets.reduce((product, facet) => product * facet.limit, 1);
  return count >= ceiling;
}

/**
 * Project the SPANS aggregate's top-level bucket array: `attributes.compute` (singular) else `computes`.
 *
 * Truncation is judged on the RAW length: a bucket dropped for an unreadable count still came back and still
 * filled the limit, so judging the kept length would call a limit-sized answer complete.
 *
 * @param returned the response's `data` array, absent already read as empty
 * @param facets what was asked for, so truncation can be judged
 * @param trafficType already read off the response's `meta` by the caller, carried through untouched
 * @returns the buckets, the truncation flag and the declared traffic type
 */
export function spanBucketsFrom({
  returned,
  facets,
  trafficType,
}: {
  returned: readonly v2.SpansAggregateBucket[];
  facets: readonly GroupFacet[];
  trafficType: string | null;
}): ProductBuckets {
  const buckets: ProductBucket[] = [];
  for (const bucket of returned) {
    const attributes: v2.SpansAggregateBucketAttributes | undefined = bucket.attributes;
    const singular = computeTotal({ value: attributes?.compute });
    const plural = computeTotal({ value: attributes?.computes });
    let count = plural;
    if (singular !== null) {
      count = singular;
    }
    if (count === null) {
      continue;
    }
    buckets.push({ by: byAsStrings({ by: attributes?.by }), count });
  }
  return { buckets, trafficType, truncated: truncatedBy({ count: returned.length, facets }) };
}

/** The sort every grouped read uses — descending by the count, so a limit is a top-N rather than a slice. */
const DESCENDING = { aggregation: "count", order: "desc", type: "measure" } as const;

/**
 * Run one grouped aggregate over the SPANS product.
 *
 * @param client the shared client
 * @param query the Datadog spans query
 * @param window the absolute window
 * @param facets the facets to cross-tabulate, outermost first
 * @returns the buckets, or the reason the call could not be made
 */
export async function spanGroups({
  client,
  query,
  window,
  facets,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
  facets: readonly GroupFacet[];
}): Promise<Result<ProductBuckets>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.spans.aggregateSpans({
      body: {
        data: {
          attributes: {
            compute: [{ aggregation: "count", type: "total" }],
            filter: { from, query, to },
            groupBy: facets.map((facet) => ({ facet: facet.facet, limit: facet.limit, sort: DESCENDING })),
          },
          type: "aggregate_request",
        },
      },
    });
    // The SDK declares `data` optional, and an absent one is an answer with no buckets rather than a
    // failure — said in a line of code rather than by an operator, which is what `no-silent-fallback` is
    // about: the two cases read identically downstream and only this line knows they differ.
    const returned = presentOr({ absent: [], value: response.data });
    return ok(spanBucketsFrom({ facets, returned, trafficType: trafficTypeFromMeta({ meta: response.meta }) }));
  } catch (error: unknown) {
    return err([`the spans aggregate over '${query}' did not come back: ${errorMessage({ error })}`]);
  }
}

/**
 * Run one grouped aggregate over the RUM product.
 *
 * @param client the shared client
 * @param query the Datadog RUM query
 * @param window the absolute window
 * @param facets the facets to cross-tabulate, outermost first
 * @returns the buckets, or the reason the call could not be made
 */
export async function rumGroups({
  client,
  query,
  window,
  facets,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
  facets: readonly GroupFacet[];
}): Promise<Result<ProductBuckets>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.rum.aggregateRUMEvents({
      body: {
        compute: [{ aggregation: "count", type: "total" }],
        filter: { from, query, to },
        groupBy: facets.map((facet) => ({ facet: facet.facet, limit: facet.limit, sort: DESCENDING })),
      },
    });
    return ok(
      bucketsFrom({ facets, raw: response.data?.buckets, trafficType: trafficTypeFromMeta({ meta: response.meta }) }),
    );
  } catch (error: unknown) {
    return err([`the RUM aggregate over '${query}' did not come back: ${errorMessage({ error })}`]);
  }
}

/**
 * Run one grouped aggregate over the CI PIPELINES product.
 *
 * @param client the shared client
 * @param query the Datadog CI query
 * @param window the absolute window
 * @param facets the facets to cross-tabulate, outermost first
 * @returns the buckets, or the reason the call could not be made
 */
export async function ciPipelineGroups({
  client,
  query,
  window,
  facets,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
  facets: readonly GroupFacet[];
}): Promise<Result<ProductBuckets>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.ciPipelines.aggregateCIAppPipelineEvents({
      body: {
        compute: [{ aggregation: "count", type: "total" }],
        filter: { from, query, to },
        groupBy: facets.map((facet) => ({ facet: facet.facet, limit: facet.limit, sort: DESCENDING })),
      },
    });
    return ok(
      bucketsFrom({ facets, raw: response.data?.buckets, trafficType: trafficTypeFromMeta({ meta: response.meta }) }),
    );
  } catch (error: unknown) {
    return err([`the CI pipelines aggregate over '${query}' did not come back: ${errorMessage({ error })}`]);
  }
}

/**
 * Run one grouped aggregate over the CI TESTS product.
 *
 * @param client the shared client
 * @param query the Datadog test query
 * @param window the absolute window
 * @param facets the facets to cross-tabulate, outermost first
 * @returns the buckets, or the reason the call could not be made
 */
export async function ciTestGroups({
  client,
  query,
  window,
  facets,
}: {
  client: CensusClient;
  query: string;
  window: AbsoluteWindow;
  facets: readonly GroupFacet[];
}): Promise<Result<ProductBuckets>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.ciTests.aggregateCIAppTestEvents({
      body: {
        compute: [{ aggregation: "count", type: "total" }],
        filter: { from, query, to },
        groupBy: facets.map((facet) => ({ facet: facet.facet, limit: facet.limit, sort: DESCENDING })),
      },
    });
    return ok(
      bucketsFrom({ facets, raw: response.data?.buckets, trafficType: trafficTypeFromMeta({ meta: response.meta }) }),
    );
  } catch (error: unknown) {
    return err([`the CI tests aggregate over '${query}' did not come back: ${errorMessage({ error })}`]);
  }
}

/**
 * Project the `by`/`computes` bucket shape RUM and both CI products share, judging truncation on the raw
 * length for the reason {@link spanBucketsFrom} gives.
 *
 * @param raw the buckets the response carried
 * @param facets what was asked for, so truncation can be judged
 * @param trafficType already read off the response's `meta` by the caller, carried through untouched
 * @returns the buckets, the truncation flag and the declared traffic type
 */
export function bucketsFrom({
  raw,
  facets,
  trafficType,
}: {
  raw: unknown;
  facets: readonly GroupFacet[];
  trafficType: string | null;
}): ProductBuckets {
  const buckets: ProductBucket[] = [];
  // The RAW length judges truncation: a bucket dropped below for an unreadable count still filled the limit.
  let returned = 0;
  if (Array.isArray(raw)) {
    returned = raw.length;
    for (const bucket of raw) {
      if (!isRecord(bucket)) {
        continue;
      }
      const count = computeTotal({ value: bucket["computes"] });
      if (count === null) {
        continue;
      }
      buckets.push({ by: byAsStrings({ by: bucket["by"] }), count });
    }
  }
  return { buckets, trafficType, truncated: truncatedBy({ count: returned, facets }) };
}
