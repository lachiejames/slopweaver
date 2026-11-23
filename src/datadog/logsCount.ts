/**
 * One real query: how many logs matched, over an absolute window.
 *
 * This is the thinnest useful thing that exercises the whole foundation — config, client, rate-limit
 * observation, window resolution and link freezing — and it exists to PROVE the plumbing rather than to be
 * a query surface. Aggregation with group-bys, timeseries and the high-cardinality guard belong to the
 * investigation work; adding them here would make this the third place that knows how to read a bucket.
 *
 * ## The traps this reads around
 *
 * **`computes` is plural for logs and singular for spans.** A logs aggregate bucket exposes `computes`; a
 * spans aggregate bucket exposes `compute`. Reading the wrong one yields `undefined` for every bucket,
 * which renders as "no data" and is indistinguishable from a genuinely empty result. The SDK's models are
 * what make this a compile error instead of a silent zero, and it is the main reason the typed client is
 * worth its weight over hand-rolled `fetch`.
 *
 * **A compute value is not necessarily a number.** `LogsAggregateBucketValue` is
 * `string | number | Array<TimeseriesPoint> | UnparsedObject`, so a count can legitimately arrive as a
 * string. A `count`/`total` compute has been observed arriving as a JSON number, but the type admits both
 * and a `typeof x === 'number'` guard that returns 0 on the string branch would under-report silently.
 *
 * ## Why an unreadable response is an ERROR and never a zero
 *
 * This is the single property the whole module is built around. "Datadog returned nothing" and "the
 * response did not contain a number where one was expected" are different facts with different fixes, and
 * the second one collapsing into `0` is how a broken client reports a healthy silence. So
 * {@link readTotalCount} returns a `Result`: a missing bucket, a missing compute key, or a value that is
 * not a number is a failure with a reason, and only a real numeric zero is a zero.
 */
import type { v2 } from "@datadog/datadog-api-client";

import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import { type DatadogQueryError, DatadogQueryErrors } from "./queryErrors.js";
import { httpStatusOf } from "./verifyCredentials.js";
import type { AbsoluteWindow } from "./window.js";
import { windowAsQueryBounds } from "./window.js";

/**
 * The key Datadog assigns an unnamed compute.
 *
 * Computes are returned keyed positionally — the first is `c0` — not by aggregation name.
 */
const TOTAL_COMPUTE_KEY = "c0";

/** A bucket's group keys — none when Datadog sent no `by` at all, or sent it as null. */
function groupKeysOf({ bucket }: { bucket: v2.LogsAggregateBucket | undefined }): readonly string[] {
  const by: unknown = bucket?.by;
  if (by == null) {
    return [];
  }
  return Object.keys(by);
}

/** A matched count, and everything needed to reproduce it. */
export interface LogsCountResult {
  readonly count: number;
  readonly query: string;
  readonly window: AbsoluteWindow;
}

/**
 * Read the total count out of an aggregate response.
 *
 * Pure, and the reason the effectful call below stays trivial: every shape this can be handed — no data, no
 * buckets, several buckets, a missing compute, a stringly-typed value — is a unit test with no network.
 *
 * @param response the aggregate response as the SDK deserialised it
 * @returns the count, or why the response did not contain one
 */
export function readTotalCount({
  response,
}: {
  response: v2.LogsAggregateResponse;
}): Result<number, DatadogQueryError> {
  const buckets = response.data?.buckets;
  if (buckets === undefined) {
    return err(DatadogQueryErrors.logBucketsMissing());
  }
  // `buckets: []` IS how Datadog encodes an empty ungrouped count — never a bucket holding `c0: 0` — so
  // this zero is Datadog's answer being read, not an unreadable response being coerced; erroring here would
  // make the most ordinary non-match a fault. A non-empty result returns one bucket, and more than one
  // means the request was not the one this function assumes — reading the first would then report a
  // fragment of the answer as the whole of it.
  if (buckets.length === 0) {
    return ok(0);
  }
  if (buckets.length > 1) {
    return err(DatadogQueryErrors.logBucketCountInvalid({ bucketCount: buckets.length }));
  }
  // The bucket must be UNGROUPED, which is a different claim from "there is only one of them" — an org with
  // a single matching service would return one bucket that is nonetheless a per-service total, and reading
  // it as the whole answer would be wrong in exactly the way the length check above is meant to prevent.
  // The request carries no `group_by`, so a populated `by` means the response does not answer what was
  // asked.
  const groupKeys = groupKeysOf({ bucket: buckets[0] });
  if (groupKeys.length > 0) {
    return err(DatadogQueryErrors.logBucketGrouped({ groupKeys }));
  }
  const computes = buckets[0]?.computes;
  if (computes === undefined) {
    return err(DatadogQueryErrors.logComputesMissing());
  }
  const raw = computes[TOTAL_COMPUTE_KEY];
  if (raw === undefined) {
    const presentKeys = Object.keys(computes).join(", ");
    return err(
      DatadogQueryErrors.logComputeMissing({
        computeKey: TOTAL_COMPUTE_KEY,
        presentKeys: presentKeys === "" ? "(none)" : presentKeys,
      }),
    );
  }
  return coerceCount({ raw });
}

/**
 * Coerce a compute value to a count.
 *
 * A `string` branch exists because the SDK's own type admits one. Both branches then go through the SAME
 * {@link validateCount}, which is the point: guarding only the numeric branch left a 400-digit decimal
 * string parsing to `Infinity`, and `Infinity > 0` reads as a successful non-empty count while
 * `JSON.stringify` renders it as `null`. Two branches producing a number needed one validator, not two.
 *
 * @param raw the compute value as the SDK typed it
 * @returns the count, or why the value was not one
 */
function coerceCount({ raw }: { raw: v2.LogsAggregateBucketValue }): Result<number, DatadogQueryError> {
  if (typeof raw === "number") {
    return validateCount({ value: raw, source: `the number ${String(raw)}` });
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return /^\d+$/.test(trimmed)
      ? validateCount({ value: Number.parseInt(trimmed, 10), source: `the string '${raw}'` })
      : err(DatadogQueryErrors.logCountStringInvalid({ raw }));
  }
  return err(
    DatadogQueryErrors.logCountNotScalar({ kind: Array.isArray(raw) ? "a timeseries array" : "an unparsed object" }),
  );
}

/**
 * The one gate every candidate count passes.
 *
 * `isSafeInteger` rather than `isFinite`, because a count beyond 2^53 has already lost precision by the
 * time it is a JS number — reporting a silently-wrong figure is the failure this module exists to prevent,
 * and no real log count approaches the bound. A negative or fractional value means the response did not
 * answer the `count`/`total` request that was sent.
 *
 * @param value the parsed candidate
 * @param source how the value arrived, for an error that says what was actually received
 * @returns the count, or why it is not usable as one
 */
function validateCount({ value, source }: { value: number; source: string }): Result<number, DatadogQueryError> {
  if (!Number.isSafeInteger(value)) {
    return err(DatadogQueryErrors.logCountNotSafeInteger({ source }));
  }
  if (value < 0) {
    return err(DatadogQueryErrors.logCountNegative({ source }));
  }
  return ok(value);
}

/**
 * Run one ungrouped aggregate and read its single `c0` compute back through {@link readTotalCount} — the
 * one place both `logsCount` and `logsSum` go through, so the bucket-shape traps documented above (plural
 * `computes`, a stringly-typed value, an unexpectedly grouped response) are guarded exactly once regardless
 * of which aggregation produced the number.
 *
 * @param client the shared client
 * @param query the Datadog logs query
 * @param window the absolute window, already resolved so the number and any link share one instant
 * @param compute the single-element compute list to send — `count`/`total` or `sum`/`total` over a metric
 * @returns the validated scalar, or why it could not be read
 */
async function runUngroupedAggregate({
  client,
  query,
  window,
  compute,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
  compute: NonNullable<Parameters<DatadogClient["logs"]["aggregateLogs"]>[0]["body"]["compute"]>;
}): Promise<Result<number, DatadogQueryError>> {
  const { from, to } = windowAsQueryBounds({ window });
  try {
    const response = await client.logs.aggregateLogs({ body: { compute, filter: { query, from, to } } });
    return readTotalCount({ response });
  } catch (error: unknown) {
    const status = httpStatusOf({ error });
    const detail = error instanceof Error ? error.message : String(error);
    if (status === null) {
      return err(DatadogQueryErrors.logQueryUnreachable({ apiHost: client.config.apiHost, detail }));
    }
    return err(DatadogQueryErrors.logQueryRejected({ detail, status }));
  }
}

/**
 * Count the logs matching a query over a window.
 *
 * @param client the shared client
 * @param query the Datadog logs query
 * @param window the absolute window, already resolved so the count and any link share one instant
 * @returns the count with its query and window, or why the count could not be obtained
 */
export async function logsCount({
  client,
  query,
  window,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
}): Promise<Result<LogsCountResult, DatadogQueryError>> {
  const count = await runUngroupedAggregate({
    client,
    query,
    window,
    compute: [{ aggregation: "count", type: "total" }],
  });
  if (count.isErr()) {
    return err(count.error);
  }
  return ok({ count: count.value, query, window });
}

/** A summed metric total, and everything needed to reproduce it. */
export interface LogsSumResult {
  readonly sum: number;
  readonly query: string;
  readonly metric: string;
  readonly window: AbsoluteWindow;
}

/**
 * Sum a numeric log attribute matching a query over a window — e.g. a per-row violation count some other
 * threshold check already computed, so a caller can total it across a run's several rows without
 * re-deriving what "firing" means.
 *
 * @param client the shared client
 * @param query the Datadog logs query
 * @param metric the attribute to sum, written with its `@` prefix (`@violations`)
 * @param window the absolute window, already resolved so the sum and any link share one instant
 * @returns the sum with its query, metric and window, or why it could not be obtained
 */
export async function logsSum({
  client,
  query,
  metric,
  window,
}: {
  client: DatadogClient;
  query: string;
  metric: string;
  window: AbsoluteWindow;
}): Promise<Result<LogsSumResult, DatadogQueryError>> {
  const sum = await runUngroupedAggregate({
    client,
    query,
    window,
    compute: [{ aggregation: "sum", metric, type: "total" }],
  });
  if (sum.isErr()) {
    return err(sum.error);
  }
  return ok({ sum: sum.value, query, metric, window });
}
