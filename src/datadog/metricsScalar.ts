/**
 * One real query against Datadog's v2 metrics scalar-query endpoint: a single grouped `sum` aggregate,
 * read back as parallel tag/count buckets.
 *
 * `logsCount.ts` is the sibling for Logs Search; this is the metrics equivalent for a query whose evidence
 * is a metric rather than a log line count. The response shape is a different wire contract from a logs
 * aggregate bucket — columnar, not per-bucket — so it earns its own reader rather than being squeezed
 * through `readTotalCount`.
 *
 * ## The wire shape
 *
 * `queryScalarData` returns `data.attributes.columns`: one {@link GroupScalarColumnLike} per requested
 * `by` tag (`type: 'group'`, `values: string[][]`, one single-element inner array per bucket — an absent
 * tag comes back as the literal string `'N/A'`, never `null` or an empty array), plus exactly one
 * {@link NumberScalarColumnLike} named after the formula (`type: 'number'`, `values: (number | null)[]`).
 * Every column's `values` array is the same length — one entry per bucket — and that parallel-array
 * contract, not any bucket object, is what ties a tag combination to its count.
 *
 * ## Why an unreadable response is an ERROR and never a zero
 *
 * Same property `logsCount.ts` is built around: a malformed column shape, a missing tag, a `null` count or
 * a value outside the safe-integer range is a failure with a reason, and only a genuinely empty `values`
 * array is a real empty result. Nothing here coerces an unknown shape to `0`.
 *
 * ## Hardened against adversarial response shapes, not against a hand-crafted JS object
 *
 * An adversarial review pass ran several rounds against every nesting level of this response — an absent,
 * null or non-array `columns` field; a null or non-object column entry; a null, non-array or array-like
 * `values` field on either column kind; a null or malformed individual cell; a non-string column `name`;
 * a malformed `errors` field — and each was a genuine gap, fixed with {@link safeString} /
 * {@link describeUnexpectedValue} (which never recurse into a value's contents, so building the error
 * message itself cannot overflow the stack) plus a regression test. The last round's counterexample needs
 * an array-like object with a poisoned `.length` getter sitting inside an otherwise-valid cell —
 * `JSON.parse` cannot produce that shape; only hand-constructed JavaScript reaching this function directly
 * could. That is where hardening stopped: every remaining gap of this kind requires a response
 * `queryScalarData`'s real HTTP+JSON path cannot produce. Assume another exists rather than that none do if
 * this function is ever handed something other than a `JSON.parse`d HTTP response body.
 */
import type { v2 } from "@datadog/datadog-api-client";

import { err, ok } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import {
  columnKey,
  describeUnexpectedValue,
  type GroupScalarColumnLike,
  type NumberScalarColumnLike,
  partitionColumns,
  type ScalarColumnLike,
  safeString,
} from "./metricsScalarColumns.js";
import { type Read, DatadogMetricsScalarErrors as ScalarErrors } from "./metricsScalarErrors.js";
import { httpStatusOf } from "./verifyCredentials.js";
import type { AbsoluteWindow } from "./window.js";

/** The one formula name every request uses — there is exactly one query per request, so it never varies. */
const FORMULA_NAME = "q1";

/** One bucket: the tag values that identify it, and its count. */
export interface MetricsScalarBucket {
  readonly by: Readonly<Record<string, string>>;
  readonly count: number;
}

/** A scalar query's result, with everything needed to reproduce it. */
export interface MetricsScalarResult {
  readonly buckets: readonly MetricsScalarBucket[];
  readonly query: string;
  readonly truncated: boolean;
  readonly window: AbsoluteWindow;
}

/**
 * Build the one scalar-query request shape this module ever sends: a single named `sum` query over
 * `metrics`, with a descending count-limited formula.
 *
 * @param query the classic metrics query string, e.g. `sum:example.metric{...} by {...}.as_count()`
 * @param window the absolute window both bounds are read from
 * @param limit the maximum number of buckets to return, ordered by descending count
 * @returns the request body `queryScalarData` takes
 */
export function buildMetricsScalarRequest({
  query,
  window,
  limit,
}: {
  readonly query: string;
  readonly window: AbsoluteWindow;
  readonly limit: number;
}): v2.ScalarFormulaQueryRequest {
  return {
    data: {
      type: "scalar_request",
      attributes: {
        from: window.fromMs,
        to: window.toMs,
        queries: [{ aggregator: "sum", dataSource: "metrics", name: FORMULA_NAME, query }],
        formulas: [{ formula: FORMULA_NAME, limit: { count: limit, order: "desc" } }],
      },
    },
  };
}

/**
 * Read a scalar-query response into buckets, validating every shape assumption rather than trusting it.
 *
 * Pure, and the reason the effectful call below stays trivial: every response shape this can be
 * handed — a server-side `errors` field, a missing column, a mismatched tag set, a fractional or negative
 * count — is a unit test with no network.
 *
 * @param response the scalar-query response as the SDK deserialised it
 * @param expectedGroupTags the exact tag names the request's `by {...}` clause named, in any order
 * @param limit the limit the request was sent with, so an exactly-full response can be marked truncated
 * @returns the buckets and whether the result hit the limit, or why the response could not be read
 */
export function readMetricsScalarBuckets({
  response,
  expectedGroupTags,
  limit,
}: {
  readonly response: v2.ScalarFormulaQueryResponse;
  readonly expectedGroupTags: readonly string[];
  readonly limit: number;
}): Read<{ readonly buckets: readonly MetricsScalarBucket[]; readonly truncated: boolean }> {
  const columns = extractColumns({ response });
  if (columns.isErr()) {
    return err(columns.error);
  }
  const partitioned = partitionColumns({ columns: columns.value });
  if (partitioned.isErr()) {
    return err(partitioned.error);
  }
  const shape = validateColumnShape({ ...partitioned.value, expectedGroupTags });
  if (shape.isErr()) {
    return err(shape.error);
  }
  const buckets = readBuckets({ ...partitioned.value, bucketCount: shape.value.bucketCount });
  if (buckets.isErr()) {
    return err(buckets.error);
  }
  const dedupe = checkNoDuplicateKeys({ buckets: buckets.value });
  if (dedupe.isErr()) {
    return err(dedupe.error);
  }
  return ok({ buckets: buckets.value, truncated: shape.value.bucketCount === limit && shape.value.bucketCount > 0 });
}

/** The response carried no server-side error, and its columns array is present. */
function extractColumns({
  response,
}: {
  readonly response: v2.ScalarFormulaQueryResponse;
}): Read<readonly ScalarColumnLike[]> {
  if (response.errors !== undefined && response.errors.length > 0) {
    return err(ScalarErrors.scalarResponseError({ detail: safeString({ value: response.errors }) }));
  }
  // Read through an `unknown`-typed local, not the SDK's own declared column-array type: the checks below
  // (nullness, then `Array.isArray`) are real runtime guards against untrusted network data, not something
  // the type checker should be able to prove already true or false from the SDK's declaration alone.
  const columns: unknown = response.data?.attributes?.columns;
  // `== null` deliberately: an explicit `columns: null` is as unreadable as an absent field, and the two
  // must not be told apart by which one happens to be iterable — `for (const c of null)` throws, which
  // would escape as an uncaught exception rather than the Result error this function exists to return.
  if (columns == null) {
    return err(ScalarErrors.scalarColumnsMissing());
  }
  // `columns` is untrusted network data up to this point — nothing has proven it is an array yet, and
  // `partitionColumns`'s `for...of` throws on a non-iterable rather than returning the Result this
  // function exists to produce. This is the one place that guarantee gets established.
  if (!Array.isArray(columns)) {
    return err(ScalarErrors.scalarColumnsNotArray({ actual: describeUnexpectedValue({ value: columns }) }));
  }
  return ok(columns as readonly ScalarColumnLike[]);
}

/** The group tag set matches what was requested, and every column's length agrees with the number column's. */
function validateColumnShape({
  groupColumns,
  numberColumn,
  expectedGroupTags,
}: {
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly numberColumn: NumberScalarColumnLike;
  readonly expectedGroupTags: readonly string[];
}): Read<{ readonly bucketCount: number }> {
  const tagCheck = checkGroupTags({ groupColumns, expectedGroupTags });
  if (tagCheck.isErr()) {
    return err(tagCheck.error);
  }
  // `== null` deliberately: an explicit `values: null` must error here, not fall through `?? 0` into a
  // false empty result — the bug this guards is a null count column reading as "healthy, zero buckets".
  if (numberColumn.values == null) {
    return err(ScalarErrors.numberColumnValuesUnreadable({ columnName: safeString({ value: numberColumn.name }) }));
  }
  const bucketCount = numberColumn.values.length;
  const lengthCheck = checkParallelLengths({ groupColumns, numberColumn, bucketCount });
  if (lengthCheck.isErr()) {
    return err(lengthCheck.error);
  }
  return ok({ bucketCount });
}

/** Every group column names an expected tag exactly once, and every expected tag has a column. */
function checkGroupTags({
  groupColumns,
  expectedGroupTags,
}: {
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly expectedGroupTags: readonly string[];
}): Read<null> {
  const names = groupColumns.map((column) => columnKey({ name: column.name }));
  const nameSet = new Set(names);
  if (nameSet.size !== names.length) {
    return err(ScalarErrors.groupColumnNamesDuplicated({ names }));
  }
  const expectedSet = new Set(expectedGroupTags);
  const missing = expectedGroupTags.filter((tag) => !nameSet.has(tag));
  const unexpected = names.filter((name) => !expectedSet.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return err(
      ScalarErrors.groupColumnsMismatch({
        actual: names.join(", ") || "(none)",
        expected: expectedGroupTags,
        missing,
        unexpected,
      }),
    );
  }
  return ok(null);
}

/** Every column's `values` array is the same length as the number column's — the parallel-array contract. */
function checkParallelLengths({
  groupColumns,
  numberColumn,
  bucketCount,
}: {
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly numberColumn: NumberScalarColumnLike;
  readonly bucketCount: number;
}): Read<null> {
  if (numberColumn.values == null) {
    return err(ScalarErrors.numberColumnValuesMissing({ columnName: safeString({ value: numberColumn.name }) }));
  }
  for (const column of groupColumns) {
    const length = column.values?.length ?? -1;
    if (length !== bucketCount) {
      return err(
        ScalarErrors.columnLengthMismatch({
          columnLength: length,
          columnName: safeString({ value: column.name }),
          numberLength: bucketCount,
        }),
      );
    }
  }
  return ok(null);
}

/**
 * Read one bucket's tag values off the group columns at a given index.
 *
 * @param groupColumns the group columns
 * @param index the bucket index to read
 * @returns the tag record, or why a cell at this index could not be read
 */
function readBucketByRecord({
  groupColumns,
  index,
}: {
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly index: number;
}): Read<Readonly<Record<string, string>>> {
  const by: Record<string, string> = {};
  for (const column of groupColumns) {
    const cell = column.values?.[index];
    // Optional chaining deliberately: a null cell is as malformed as a missing one, and `cell.length` on a
    // null cell would throw rather than reaching this Result-returning check.
    if (cell?.length !== 1) {
      return err(
        ScalarErrors.groupCellCardinalityInvalid({
          bucketIndex: index,
          columnName: safeString({ value: column.name }),
          valueCount: cell == null ? "no" : String(cell.length),
        }),
      );
    }
    // `cell[0]`'s declared type is `string`, but it is read off untrusted network data via the same
    // unchecked cast as everything else in this file — `safeString` is what stops a non-string cell
    // value (still possible despite the length-1 check above, which only proves the ARRAY shape) from
    // reaching `bucket.by`, where `checkNoDuplicateKeys`'s `JSON.stringify` would otherwise recurse into
    // it.
    const cellValue = cell[0];
    by[columnKey({ name: column.name })] = typeof cellValue === "string" ? cellValue : safeString({ value: cellValue });
  }
  return ok(by);
}

/** Turn validated parallel columns into buckets, checking each row's shape as it goes. */
function readBuckets({
  groupColumns,
  numberColumn,
  bucketCount,
}: {
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly numberColumn: NumberScalarColumnLike;
  readonly bucketCount: number;
}): Read<readonly MetricsScalarBucket[]> {
  const buckets: MetricsScalarBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const by = readBucketByRecord({ groupColumns, index });
    if (by.isErr()) {
      return err(by.error);
    }
    const raw = numberColumn.values?.[index];
    const count = validateCount({ raw, bucketIndex: index });
    if (count.isErr()) {
      return err(count.error);
    }
    buckets.push({ by: by.value, count: count.value });
  }
  return ok(buckets);
}

/** The one gate every candidate count passes — mirrors `logsCount.ts#validateCount`. */
function validateCount({ raw, bucketIndex }: { raw: unknown; bucketIndex: number }): Read<number> {
  if (raw === null || raw === undefined) {
    return err(ScalarErrors.bucketCountMissing({ bucketIndex }));
  }
  // `raw`'s declared type upstream is `number | null`, but it is read off untrusted network data via an
  // unchecked cast — a nested-array count would satisfy neither `typeof` nor `isSafeInteger`, and
  // `describeUnexpectedValue` (not `String`) is what keeps this branch's own error message from recursing
  // into it.
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    return err(
      ScalarErrors.bucketCountNotSafeInteger({ actual: describeUnexpectedValue({ value: raw }), bucketIndex }),
    );
  }
  if (raw < 0) {
    return err(ScalarErrors.bucketCountNegative({ bucketIndex, value: raw }));
  }
  return ok(raw);
}

/** No two buckets may carry the identical tag combination — that would mean the grouping was not exhaustive. */
function checkNoDuplicateKeys({ buckets }: { readonly buckets: readonly MetricsScalarBucket[] }): Read<null> {
  const seen = new Set<string>();
  for (const bucket of buckets) {
    const key = JSON.stringify(Object.entries(bucket.by).toSorted(([left], [right]) => left.localeCompare(right)));
    if (seen.has(key)) {
      return err(ScalarErrors.bucketTagsDuplicated({ key }));
    }
    seen.add(key);
  }
  return ok(null);
}

/**
 * Run one grouped `sum` scalar query and read it back as buckets.
 *
 * @param client the shared client
 * @param query the classic metrics query string
 * @param expectedGroupTags the exact tag names the query's `by {...}` clause names
 * @param limit the maximum number of buckets to return, ordered by descending count
 * @param window the absolute window, already resolved so the result and any link share one instant
 * @returns the result, or why it could not be obtained
 */
export async function metricsScalarCount({
  client,
  query,
  expectedGroupTags,
  limit,
  window,
}: {
  readonly client: DatadogClient;
  readonly query: string;
  readonly expectedGroupTags: readonly string[];
  readonly limit: number;
  readonly window: AbsoluteWindow;
}): Promise<Read<MetricsScalarResult>> {
  let response: v2.ScalarFormulaQueryResponse;
  try {
    response = await client.metrics.queryScalarData({ body: buildMetricsScalarRequest({ query, window, limit }) });
  } catch (error: unknown) {
    const status = httpStatusOf({ error });
    const detail = error instanceof Error ? error.message : String(error);
    if (status === null) {
      return err(ScalarErrors.metricsQueryUnreachable({ apiHost: client.config.apiHost, detail }));
    }
    return err(ScalarErrors.metricsQueryRejected({ detail, status }));
  }
  const read = readMetricsScalarBuckets({ response, expectedGroupTags, limit });
  if (read.isErr()) {
    return err(read.error);
  }
  return ok({ buckets: read.value.buckets, query, truncated: read.value.truncated, window });
}
