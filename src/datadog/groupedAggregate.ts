/**
 * The one place a `DatadogClient`-based caller runs a grouped logs aggregate and reads back
 * {@link CensusBucket}s — so a second caller needing a different facet breakdown (after
 * `envFacetGuard.ts`'s per-env re-check, say) extends this rather than growing its own near-identical
 * grouped-fetch.
 *
 * Bucket-shape reading reuses `logsCount.ts`'s validated trap-avoidance for a SINGLE bucket
 * (`readTotalCount`'s `computes.c0`, pluralisation, stringly-typed values); this generalises it across
 * every bucket a grouped response returns.
 */
import type { v2 } from "@datadog/datadog-api-client";

import { absentAsEmpty } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import { httpStatusOf } from "./verifyCredentials.js";
import { type AbsoluteWindow, windowAsQueryBounds } from "./window.js";

/** The Datadog compute-key both `logsCount.ts` and this file read a bucket's total off. */
const TOTAL_COMPUTE_KEY = "c0";

/** One enumerated value of a facet, with the population Datadog attributed to it. */
export interface CensusBucket {
  /** The facet values identifying this bucket, e.g. `{service: 'example-worker', operation_name: 'Internal'}`. */
  readonly by: Readonly<Record<string, string | null>>;
  /** How many events Datadog reported. An estimate whenever the response declared its traffic sampled. */
  readonly count: number;
}

/**
 * Coerce a bucket's `c0` compute to a count, or `null` when it is missing or not a finite number.
 *
 * @param raw the bucket's `computes.c0` value, or `undefined` when absent
 * @returns the count, or `null` when the compute cannot be read as one
 */
function countFromCompute({ raw }: { raw: v2.LogsAggregateBucketValue | undefined }): number | null {
  let count: number;
  if (typeof raw === "number") {
    count = raw;
  } else if (typeof raw === "string") {
    count = Number.parseInt(raw, 10);
  } else {
    count = Number.NaN;
  }
  return Number.isFinite(count) ? count : null;
}

/**
 * Render one facet value as a string. The SDK types a bucket's `by` map as `any`-valued, so a facet value
 * is genuinely untyped — a plain string in every observed response, but rendered through `JSON.stringify`
 * rather than `String()`/a template literal, neither of which promise anything better than
 * `[object Object]` for a value that turns out not to be a primitive.
 *
 * @param value one facet value from a bucket's `by` map
 * @returns the rendered string
 */
function renderFacetValue({ value }: { value: unknown }): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }
  // `JSON.stringify` is typed as always returning a `string` — its runtime `undefined` case (a bare
  // function or `symbol` value) is not one Datadog would ever emit as a facet value.
  return JSON.stringify(value);
}

/**
 * Render a bucket's `by` record with every value coerced to a string or `null`.
 *
 * @param by the bucket's `by` record, as the SDK typed it, plus the JSON `null` its deserialiser passes through
 * @returns the same facet values, each rendered as a string, or `null` for an absent one
 */
function byAsStrings({
  by,
}: {
  by: Readonly<Record<string, unknown>> | null | undefined;
}): Readonly<Record<string, string | null>> {
  const rendered: Record<string, string | null> = {};
  if (by == null) {
    return rendered;
  }
  for (const [key, value] of Object.entries(by)) {
    rendered[key] = value === undefined ? null : renderFacetValue({ value });
  }
  return rendered;
}

/**
 * Turn one grouped logs-aggregate response into {@link CensusBucket}s.
 *
 * A bucket missing its `c0` compute or carrying a non-numeric one is dropped rather than read as zero —
 * the same "unreadable is not empty" rule `logsCount.ts#readTotalCount` enforces for the ungrouped case.
 *
 * @param response the SDK's grouped aggregate response
 * @returns one bucket per group Datadog returned
 */
export function bucketsFromResponse({ response }: { response: v2.LogsAggregateResponse }): readonly CensusBucket[] {
  const buckets: CensusBucket[] = [];
  for (const bucket of absentAsEmpty({ value: response.data?.buckets })) {
    const count = countFromCompute({ raw: bucket.computes?.[TOTAL_COMPUTE_KEY] });
    if (count === null) {
      continue;
    }
    buckets.push({ by: byAsStrings({ by: bucket.by }), count });
  }
  return buckets;
}

/** One facet's grouped breakdown, plus whether the requested limit means it may be incomplete. */
export interface GroupedAggregateResult {
  readonly buckets: readonly CensusBucket[];
  /** `returned bucket count >= limit` — the only signal Datadog's own truncation ever gives (no partial-page marker). */
  readonly truncated: boolean;
}

/**
 * Read one grouped response into buckets and a truncation flag.
 *
 * Truncation is judged on the buckets Datadog RETURNED, not the ones kept: a full response with one
 * unreadable bucket dropped is still full, and calling it complete would let a partition audit read a
 * truncated grouping as one that accounts for every event.
 *
 * @param response the SDK's grouped aggregate response
 * @param limit the per-facet limit the request was sent with
 * @param facetCount how many facets the request grouped by, so the ceiling is the limit to that power
 * @returns the readable buckets and whether the response reached its ceiling
 */
export function groupedAggregateFrom({
  response,
  limit,
  facetCount,
}: {
  response: v2.LogsAggregateResponse;
  limit: number;
  facetCount: number;
}): GroupedAggregateResult {
  const raw = response.data?.buckets;
  // A reply with no bucket list returned nothing, so it cannot have reached the ceiling.
  const returned = raw === undefined ? 0 : raw.length;
  return { buckets: bucketsFromResponse({ response }), truncated: returned >= limit ** facetCount };
}

/**
 * Run one grouped logs aggregate, sorted descending by whichever measure was computed — a limited
 * unsorted group_by is a lexicographic slice, not a top-N, so the sort is not optional here.
 *
 * @param client the shared client
 * @param query the Datadog logs query
 * @param window the absolute window, already resolved
 * @param facet the facet to group by
 * @param limit how many groups to ask for — also the truncation signal, see {@link GroupedAggregateResult}
 * @param metric when given, the compute is `sum(metric)`; when omitted, a plain event `count`
 * @returns the buckets and truncation flag, or why the call could not be made
 */
export async function runGroupedLogsAggregate({
  client,
  query,
  window,
  facet,
  limit,
  metric = null,
}: {
  client: LogsAggregateClient;
  query: string;
  window: AbsoluteWindow;
  facet: string;
  limit: number;
  metric?: string | null;
}): Promise<Result<GroupedAggregateResult>> {
  return runMultiGroupedLogsAggregate({ client, facets: [facet], limit, metric, query, window });
}

/**
 * Run one logs aggregate grouped by SEVERAL facets at once — a cross-tabulation rather than a breakdown.
 *
 * The single-facet form above delegates here, so there is one request builder and one error message rather
 * than two that agree only in principle. Two facets is what a stratified sample needs: the cells a Datadog
 * shape catalogue samples are `(env, service)` pairs, and asking for them as two separate breakdowns cannot
 * recover the pairing — a service present in three environments and a service present in one look identical
 * in two flat lists.
 *
 * The `limit` is PER FACET, which is Datadog's own semantics rather than a choice here, so the number of
 * buckets a call can return is the product across the facets. The truncation flag is therefore conservative:
 * it fires when the bucket count reaches the product, which is the only signal Datadog gives at all.
 *
 * @param client the shared client
 * @param query the Datadog logs query
 * @param window the absolute window, already resolved
 * @param facets the facets to cross-tabulate, outermost first
 * @param limit how many groups to ask for PER FACET
 * @param metric when given, the compute is `sum(metric)`; when omitted, a plain event `count`
 * @returns the buckets and truncation flag, or why the call could not be made
 */
export async function runMultiGroupedLogsAggregate({
  client,
  query,
  window,
  facets,
  limit,
  metric = null,
}: {
  client: LogsAggregateClient;
  query: string;
  window: AbsoluteWindow;
  facets: readonly string[];
  limit: number;
  metric?: string | null;
}): Promise<Result<GroupedAggregateResult>> {
  const { from, to } = windowAsQueryBounds({ window });
  const compute: v2.LogsCompute =
    metric === null ? { aggregation: "count", type: "total" } : { aggregation: "sum", metric, type: "total" };
  const sort: v2.LogsAggregateSort =
    metric === null
      ? { aggregation: "count", type: "measure", order: "desc" }
      : { aggregation: "sum", metric, type: "measure", order: "desc" };
  const named = facets.join(" × ");
  try {
    const response = await client.logs.aggregateLogs({
      body: {
        compute: [compute],
        filter: { query, from, to },
        groupBy: facets.map((facet) => ({ facet, limit, sort })),
      },
    });
    return ok(groupedAggregateFrom({ facetCount: facets.length, limit, response }));
  } catch (error: unknown) {
    const status = httpStatusOf({ error });
    const detail = error instanceof Error ? error.message : String(error);
    return err([
      status === null
        ? `the grouped '${named}' aggregate never reached Datadog at ${client.config.apiHost}: ${detail}`
        : `Datadog rejected the grouped '${named}' aggregate with HTTP ${String(status)}: ${detail}`,
    ]);
  }
}

/**
 * The slice of the client a grouped logs aggregate uses.
 *
 * Narrower than the whole client so a caller can be unit-tested with a plain fake rather than a mock, which
 * is what `.claude/rules/testing.md` asks for. A real {@link ./client.DatadogClient} satisfies it
 * structurally, so no call site changes.
 */
export interface LogsAggregateClient {
  readonly logs: Pick<DatadogClient["logs"], "aggregateLogs">;
  readonly config: Pick<DatadogClient["config"], "apiHost">;
}
