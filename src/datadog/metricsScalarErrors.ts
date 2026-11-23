/**
 * The typed failures of reading one metrics scalar-query response (`metricsScalar.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the logs query union rather than inside
 * it: the scalar response is a columnar wire contract of its own, and every one of these names a column,
 * a cell or a bucket of it. Each is one sentence, so a caller prints `message`.
 *
 * Every field arriving from the response is ALREADY rendered by the reader's own bounded, non-recursive
 * describers before it reaches a factory here — this module never touches an untrusted value itself.
 *
 * Pure: values in, values out.
 */
import type { Result } from "#lib/result.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure naming one column by its (already sanitised) name. */
interface ColumnError<C extends string> extends Plain<C> {
  readonly columnName: string;
}

/** A failure naming one bucket by its index. */
interface BucketError<C extends string> extends Plain<C> {
  readonly bucketIndex: number;
}

/** Every way reading a metrics scalar-query response, or reaching the endpoint, can fail. */
export type DatadogMetricsScalarError =
  | (ColumnError<"COLUMN_VALUES_NOT_ARRAY"> & { readonly actual: string })
  | (Plain<"COLUMN_ENTRY_NOT_OBJECT"> & { readonly actual: string })
  | (Plain<"COLUMN_TYPE_UNRECOGNISED"> & { readonly columnType: string })
  | (Plain<"NUMBER_COLUMNS_MULTIPLE"> & { readonly firstName: string; readonly secondName: string })
  | Plain<"NUMBER_COLUMN_MISSING">
  | (Plain<"SCALAR_RESPONSE_ERROR"> & { readonly detail: string })
  | Plain<"SCALAR_COLUMNS_MISSING">
  | (Plain<"SCALAR_COLUMNS_NOT_ARRAY"> & { readonly actual: string })
  | ColumnError<"NUMBER_COLUMN_VALUES_UNREADABLE">
  | (Plain<"GROUP_COLUMN_NAMES_DUPLICATED"> & { readonly names: readonly string[] })
  | (Plain<"GROUP_COLUMNS_MISMATCH"> & {
      readonly actual: string;
      readonly expected: readonly string[];
      readonly missing: readonly string[];
      readonly unexpected: readonly string[];
    })
  | ColumnError<"NUMBER_COLUMN_VALUES_MISSING">
  | (ColumnError<"COLUMN_LENGTH_MISMATCH"> & { readonly columnLength: number; readonly numberLength: number })
  | (ColumnError<"GROUP_CELL_CARDINALITY_INVALID"> & { readonly bucketIndex: number; readonly valueCount: string })
  | BucketError<"BUCKET_COUNT_MISSING">
  | (BucketError<"BUCKET_COUNT_NOT_SAFE_INTEGER"> & { readonly actual: string })
  | (BucketError<"BUCKET_COUNT_NEGATIVE"> & { readonly value: number })
  | (Plain<"BUCKET_TAGS_DUPLICATED"> & { readonly key: string })
  | (Plain<"METRICS_QUERY_UNREACHABLE"> & { readonly apiHost: string; readonly detail: string })
  | (Plain<"METRICS_QUERY_REJECTED"> & { readonly status: number; readonly detail: string });

/** What every step of reading a scalar response returns: a value, or the scalar reader's own typed failure. */
export type Read<T> = Result<T, DatadogMetricsScalarError>;

/** The factory's own return type, named once so no entry below wraps its signature. */
type E = DatadogMetricsScalarError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogMetricsScalarErrors = {
  bucketCountMissing: ({ bucketIndex }: { bucketIndex: number }): E => ({
    bucketIndex,
    code: "BUCKET_COUNT_MISSING",
    message: `Datadog returned no count for bucket ${String(bucketIndex)} — a count aggregation should never produce a null value`,
  }),
  bucketCountNegative: ({ value, bucketIndex }: { value: number; bucketIndex: number }): E => ({
    bucketIndex,
    code: "BUCKET_COUNT_NEGATIVE",
    message: `Datadog returned ${String(value)} as bucket ${String(bucketIndex)}'s count, and a count cannot be negative`,
    value,
  }),
  bucketCountNotSafeInteger: ({ actual, bucketIndex }: { actual: string; bucketIndex: number }): E => ({
    actual,
    bucketIndex,
    code: "BUCKET_COUNT_NOT_SAFE_INTEGER",
    message: `Datadog returned ${actual} as bucket ${String(bucketIndex)}'s count, which is not a safe integer`,
  }),
  bucketTagsDuplicated: ({ key }: { key: string }): E => ({
    code: "BUCKET_TAGS_DUPLICATED",
    key,
    message: `Datadog returned two buckets with the identical tag combination ${key} — the grouping was not exhaustive`,
  }),
  columnEntryNotObject: ({ actual }: { actual: string }): E => ({
    actual,
    code: "COLUMN_ENTRY_NOT_OBJECT",
    message: `Datadog returned a column entry that is not an object: ${actual}`,
  }),
  columnLengthMismatch: ({
    columnName,
    columnLength,
    numberLength,
  }: {
    columnName: string;
    columnLength: number;
    numberLength: number;
  }): E => ({
    code: "COLUMN_LENGTH_MISMATCH",
    columnLength,
    columnName,
    message: `Datadog's group column '${columnName}' has ${String(columnLength)} value(s), but the number column has ${String(numberLength)} — the parallel-array contract does not hold`,
    numberLength,
  }),
  columnTypeUnrecognised: ({ columnType }: { columnType: string }): E => ({
    code: "COLUMN_TYPE_UNRECOGNISED",
    columnType,
    message: `Datadog returned a column of unrecognised type '${columnType}'`,
  }),
  columnValuesNotArray: ({ columnName, actual }: { columnName: string; actual: string }): E => ({
    actual,
    code: "COLUMN_VALUES_NOT_ARRAY",
    columnName,
    message: `Datadog returned column '${columnName}' with a \`values\` field that is not an array: ${actual}`,
  }),
  groupCellCardinalityInvalid: ({
    columnName,
    bucketIndex,
    valueCount,
  }: {
    columnName: string;
    bucketIndex: number;
    valueCount: string;
  }): E => ({
    bucketIndex,
    code: "GROUP_CELL_CARDINALITY_INVALID",
    columnName,
    message: `Datadog's group column '${columnName}' bucket ${String(bucketIndex)} carries ${valueCount} value(s), expected exactly one`,
    valueCount,
  }),
  groupColumnNamesDuplicated: ({ names }: { names: readonly string[] }): E => ({
    code: "GROUP_COLUMN_NAMES_DUPLICATED",
    message: `Datadog returned duplicate group column names: ${names.join(", ")}`,
    names,
  }),
  /** `actual` is the present names as the reader renders them, `(none)` included, so the sentence is unchanged. */
  groupColumnsMismatch: ({
    actual,
    expected,
    missing,
    unexpected,
  }: {
    actual: string;
    expected: readonly string[];
    missing: readonly string[];
    unexpected: readonly string[];
  }): E => ({
    actual,
    code: "GROUP_COLUMNS_MISMATCH",
    expected,
    message:
      `Datadog's group columns (${actual}) do not match the expected tags (${expected.join(", ")})` +
      (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
      (unexpected.length > 0 ? `; unexpected: ${unexpected.join(", ")}` : ""),
    missing,
    unexpected,
  }),
  metricsQueryRejected: ({ status, detail }: { status: number; detail: string }): E => ({
    code: "METRICS_QUERY_REJECTED",
    detail,
    message: `Datadog rejected the metrics scalar query with HTTP ${String(status)}: ${detail}`,
    status,
  }),
  metricsQueryUnreachable: ({ apiHost, detail }: { apiHost: string; detail: string }): E => ({
    apiHost,
    code: "METRICS_QUERY_UNREACHABLE",
    detail,
    message: `the metrics scalar query never reached Datadog at ${apiHost}: ${detail}`,
  }),
  numberColumnMissing: (): E => ({
    code: "NUMBER_COLUMN_MISSING",
    message: "Datadog returned no number column — the formula produced no readable series",
  }),
  numberColumnsMultiple: ({ firstName, secondName }: { firstName: string; secondName: string }): E => ({
    code: "NUMBER_COLUMNS_MULTIPLE",
    firstName,
    message: `Datadog returned more than one number column ('${firstName}' and '${secondName}'); this reader expects exactly one formula`,
    secondName,
  }),
  numberColumnValuesMissing: ({ columnName }: { columnName: string }): E => ({
    code: "NUMBER_COLUMN_VALUES_MISSING",
    columnName,
    message: `Datadog returned a number column '${columnName}' with no \`values\` field`,
  }),
  numberColumnValuesUnreadable: ({ columnName }: { columnName: string }): E => ({
    code: "NUMBER_COLUMN_VALUES_UNREADABLE",
    columnName,
    message: `Datadog returned a number column '${columnName}' with no readable \`values\` field`,
  }),
  scalarColumnsMissing: (): E => ({
    code: "SCALAR_COLUMNS_MISSING",
    message:
      "Datadog returned a scalar-query response with no `data.attributes.columns` field. This is a malformed response, NOT an empty result",
  }),
  scalarColumnsNotArray: ({ actual }: { actual: string }): E => ({
    actual,
    code: "SCALAR_COLUMNS_NOT_ARRAY",
    message: `Datadog returned a scalar-query response whose \`data.attributes.columns\` field is not an array: ${actual}`,
  }),
  scalarResponseError: ({ detail }: { detail: string }): E => ({
    code: "SCALAR_RESPONSE_ERROR",
    detail,
    message: `Datadog returned a scalar-query error alongside its response: ${detail}`,
  }),
} as const;
