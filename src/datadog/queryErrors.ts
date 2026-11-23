/**
 * The typed failures of asking Datadog for a number and deciding whether the answer can be believed — a logs
 * count (`logsCount.ts`), what a set of buckets may be read as (`counting.ts`), the raw path's own refusals
 * (`rawTransport.ts`, and `rawRequest.ts`'s boundary refusals), the unified event API's count
 * (`logsAnalytics.ts`) and the env re-check (`envFacetGuard.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`. The metrics scalar reader has its own beside it
 * (`metricsScalarErrors.ts`), because its failures name columns and cells of a different wire contract.
 * A variant carrying `reasons` keeps one line per problem, and {@link datadogQueryErrorLines} is how a
 * caller prints them without re-composing the joined `message`. These reach the bot's Slack answers and the
 * detective verbs, so every sentence here is the one those surfaces already printed, byte for byte — bar the
 * two raw-body refusals, which lead with the boundary's own sentence so a refusal names a key, never a value.
 *
 * Pure: values in, values out.
 */
import type { BoundaryDrift, BoundaryError, BoundaryNotJsonError, BoundaryShapeChangedError } from "#lib/boundary.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A logs-count failure whose sentence names how the candidate value arrived. */
interface CountSourceError<C extends string> extends Plain<C> {
  readonly source: string;
}

/** A list failure about one route's response, named by its path. */
interface PathListed<C extends string> extends Listed<C> {
  readonly path: string;
}

/** Every way a logs count, a bucket reading, a raw request or an env re-check can fail to be believed. */
export type DatadogQueryError =
  | Plain<"LOG_BUCKETS_MISSING">
  | (Plain<"LOG_BUCKET_COUNT_INVALID"> & { readonly bucketCount: number })
  | (Plain<"LOG_BUCKET_GROUPED"> & { readonly groupKeys: readonly string[] })
  | Plain<"LOG_COMPUTES_MISSING">
  | (Plain<"LOG_COMPUTE_MISSING"> & { readonly computeKey: string; readonly presentKeys: string })
  | (Plain<"LOG_COUNT_STRING_INVALID"> & { readonly raw: string })
  | (Plain<"LOG_COUNT_NOT_SCALAR"> & { readonly kind: string })
  | CountSourceError<"LOG_COUNT_NOT_SAFE_INTEGER">
  | CountSourceError<"LOG_COUNT_NEGATIVE">
  | (Plain<"LOG_QUERY_UNREACHABLE"> & { readonly apiHost: string; readonly detail: string })
  | (Plain<"LOG_QUERY_REJECTED"> & { readonly status: number; readonly detail: string })
  | (Listed<"BUCKETS_NOT_POPULATION"> & { readonly facet: string; readonly bucketCount: number })
  | (Listed<"UNGROUPED_BUCKET_COUNT_INVALID"> & { readonly route: string; readonly bucketCount: number })
  | (Listed<"UNGROUPED_BUCKET_GROUPED"> & { readonly route: string; readonly groupKeys: readonly string[] })
  | (Listed<"CARDINALITY_BUCKET_COUNT_INVALID"> & { readonly facet: string; readonly bucketCount: number })
  | (Listed<"CARDINALITY_BUCKET_GROUPED"> & { readonly facet: string; readonly groupKeys: readonly string[] })
  | (Listed<"READ_ONLY_ROUTE_REFUSED"> & { readonly route: string })
  | (Listed<"RAW_BODY_NOT_JSON"> & { readonly endpoint: string })
  | (Listed<"RAW_BODY_INVALID"> & { readonly endpoint: string; readonly drift: readonly BoundaryDrift[] })
  | Listed<"QUERY_REQUEST_FAILED">
  | (PathListed<"ANALYTICS_INCOMPLETE"> & { readonly status: string })
  | (PathListed<"ANALYTICS_TOTAL_MISMATCH"> & { readonly hitCount: number; readonly resultCount: number })
  | (PathListed<"ANALYTICS_ROWS_DISCLOSED"> & { readonly rowCount: number; readonly limit: number })
  | Listed<"ENV_SCOPE_UNVERIFIED">;

/** The factory's own return type, named once so no entry below wraps its signature. */
type E = DatadogQueryError;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** The logs-count failures: the aggregate response did not carry the one total this request asked for. */
const logsCountErrors = {
  logBucketCountInvalid: ({ bucketCount }: { bucketCount: number }): E => ({
    bucketCount,
    code: "LOG_BUCKET_COUNT_INVALID",
    message: `Datadog returned ${String(bucketCount)} buckets for an ungrouped total. Reading the first would report part of the answer as all of it — this function only handles a single total`,
  }),
  logBucketGrouped: ({ groupKeys }: { groupKeys: readonly string[] }): E => ({
    code: "LOG_BUCKET_GROUPED",
    groupKeys,
    message: `Datadog returned a bucket grouped by ${groupKeys.join(", ")}, but this request asked for an ungrouped total. Reading it would report one group's count as the whole answer`,
  }),
  logBucketsMissing: (): E => ({
    code: "LOG_BUCKETS_MISSING",
    message:
      "Datadog returned an aggregate response with no `data.buckets` field. This is a malformed response, NOT an empty result — the query may have been rejected in a way the SDK did not raise",
  }),
  /** `presentKeys` is the keys as the reader renders them, `(none)` included, so the sentence is unchanged. */
  logComputeMissing: ({ computeKey, presentKeys }: { computeKey: string; presentKeys: string }): E => ({
    code: "LOG_COMPUTE_MISSING",
    computeKey,
    message: `Datadog returned a bucket with no '${computeKey}' compute. The keys present were: ${presentKeys}`,
    presentKeys,
  }),
  logComputesMissing: (): E => ({
    code: "LOG_COMPUTES_MISSING",
    message:
      "Datadog returned a bucket with no `computes` field. Note that logs use `computes` (plural) and spans use `compute` (singular); reading the wrong one looks exactly like an empty result",
  }),
  logCountNegative: ({ source }: { source: string }): E => ({
    code: "LOG_COUNT_NEGATIVE",
    message: `Datadog returned ${source} as the count, and a count cannot be negative`,
    source,
  }),
  logCountNotSafeInteger: ({ source }: { source: string }): E => ({
    code: "LOG_COUNT_NOT_SAFE_INTEGER",
    message: `Datadog returned ${source} as the count, which is not a safe integer — it cannot be reported as a number without silently changing it`,
    source,
  }),
  logCountNotScalar: ({ kind }: { kind: string }): E => ({
    code: "LOG_COUNT_NOT_SCALAR",
    kind,
    message: `Datadog returned the count as ${kind} rather than a scalar. This request asked for a total, so the response shape does not match the request`,
  }),
  logCountStringInvalid: ({ raw }: { raw: string }): E => ({
    code: "LOG_COUNT_STRING_INVALID",
    message: `Datadog returned the count as the string '${raw}', which is not an integer`,
    raw,
  }),
  logQueryRejected: ({ status, detail }: { status: number; detail: string }): E => ({
    code: "LOG_QUERY_REJECTED",
    detail,
    message: `Datadog rejected the logs query with HTTP ${String(status)}: ${detail}`,
    status,
  }),
  logQueryUnreachable: ({ apiHost, detail }: { apiHost: string; detail: string }): E => ({
    apiHost,
    code: "LOG_QUERY_UNREACHABLE",
    detail,
    message: `the logs query never reached Datadog at ${apiHost}: ${detail}`,
  }),
} as const;

/** The counting guards: a bucket set read as something it cannot be. */
const countingErrors = {
  /** `limitLine` is the one line that says whether the count reached the limit — the caller decides which. */
  bucketsNotPopulation: ({
    facet,
    bucketCount,
    limitLine,
  }: {
    facet: string;
    bucketCount: number;
    limitLine: string;
  }): E => ({
    ...listed({
      code: "BUCKETS_NOT_POPULATION",
      reasons: [
        `refusing to report ${String(bucketCount)} '${facet}' buckets as the number of distinct '${facet}' values`,
        limitLine,
        `ask for a population directly: an ungrouped cardinality(${facet}) compute over the same query and window. It costs one more call against a tight budget, and it is the only honest answer`,
      ],
    }),
    bucketCount,
    facet,
  }),
  cardinalityBucketCountInvalid: ({ facet, bucketCount }: { facet: string; bucketCount: number }): E => ({
    ...listed({
      code: "CARDINALITY_BUCKET_COUNT_INVALID",
      reasons: [
        `a cardinality(${facet}) compute returned ${String(bucketCount)} buckets, so it was grouped rather than ungrouped`,
        "a grouped cardinality lies about presence, so this cannot be read as a population at all",
      ],
    }),
    bucketCount,
    facet,
  }),
  cardinalityBucketGrouped: ({ facet, groupKeys }: { facet: string; groupKeys: readonly string[] }): E => ({
    ...listed({
      code: "CARDINALITY_BUCKET_GROUPED",
      reasons: [
        `a cardinality(${facet}) compute returned a bucket grouped by ${groupKeys.join(", ")}, but a population must come from an ungrouped compute`,
        "reading it would report one group's distinct count as the whole population",
      ],
    }),
    facet,
    groupKeys,
  }),
  ungroupedBucketCountInvalid: ({ route, bucketCount }: { route: string; bucketCount: number }): E => ({
    ...listed({
      code: "UNGROUPED_BUCKET_COUNT_INVALID",
      reasons: [
        `${route} returned ${String(bucketCount)} buckets for an ungrouped total, so the request was not the one this assumed`,
        "reading the first would report a fragment of the answer as the whole of it",
      ],
    }),
    bucketCount,
    route,
  }),
  ungroupedBucketGrouped: ({ route, groupKeys }: { route: string; groupKeys: readonly string[] }): E => ({
    ...listed({
      code: "UNGROUPED_BUCKET_GROUPED",
      reasons: [
        `${route} returned a bucket grouped by ${groupKeys.join(", ")} for an ungrouped total, so it answers a narrower question than was asked`,
        "reading it would report one group's count as the whole answer",
      ],
    }),
    groupKeys,
    route,
  }),
} as const;

/** The raw path's own refusals, the unified event API's count checks, and the env re-check. */
const requestErrors = {
  analyticsIncomplete: ({ path, status, expected }: { path: string; status: string; expected: string }): E => ({
    ...listed({
      code: "ANALYTICS_INCOMPLETE",
      reasons: [
        `${path} reported status '${status}' rather than '${expected}', so its count may be partial`,
        "a partial count is not a smaller true count — reporting it would understate by an unknown amount",
      ],
    }),
    path,
    status,
  }),
  analyticsRowsDisclosed: ({ path, rowCount, limit }: { path: string; rowCount: number; limit: number }): E => ({
    ...listed({
      code: "ANALYTICS_ROWS_DISCLOSED",
      reasons: [
        `${path} returned ${String(rowCount)} event rows against a requested limit of ${String(limit)}`,
        "this path must never receive raw event bodies — a real estate's logs can carry sensitive fields on at least one route, so a row is a disclosure a count is not",
      ],
    }),
    limit,
    path,
    rowCount,
  }),
  analyticsTotalMismatch: ({
    path,
    hitCount,
    resultCount,
  }: {
    path: string;
    hitCount: number;
    resultCount: number;
  }): E => ({
    ...listed({
      code: "ANALYTICS_TOTAL_MISMATCH",
      reasons: [
        `${path} returned hitCount ${String(hitCount)} but result.count ${String(resultCount)}`,
        "the same response gave two different totals, so neither can be used as an independent oracle",
      ],
    }),
    hitCount,
    path,
    resultCount,
  }),
  /** `reasons` is the grouped aggregate's own failure, followed here by why that leaves prod unestablished. */
  envScopeUnverified: ({ reasons }: { reasons: readonly string[] }): E =>
    listed({
      code: "ENV_SCOPE_UNVERIFIED",
      reasons: [
        ...reasons,
        "this query was scoped to production and the env facet could not be re-checked, so nothing establishes that the matched events are production",
      ],
    }),
  queryRequestFailed: ({ reasons }: { reasons: readonly string[] }): E =>
    listed({ code: "QUERY_REQUEST_FAILED", reasons }),
  /** The boundary's own sentence leads: it names the endpoint and each drifted key, and never a value. */
  rawBodyInvalid: ({ refusal }: { refusal: BoundaryShapeChangedError }): E => ({
    ...listed({
      code: "RAW_BODY_INVALID",
      reasons: [
        refusal.message,
        "this is a malformed response, NOT an empty result — the request may have been rejected in a way the status code did not show",
      ],
    }),
    drift: refusal.drift,
    endpoint: refusal.endpoint,
  }),
  rawBodyNotJson: ({ refusal }: { refusal: BoundaryNotJsonError }): E => ({
    ...listed({
      code: "RAW_BODY_NOT_JSON",
      reasons: [
        refusal.message,
        "this is a malformed response, NOT an empty result — reading it as zero would be a confident wrong answer",
      ],
    }),
    endpoint: refusal.endpoint,
  }),
  readOnlyRouteRefused: ({ route, allowedRoutes }: { route: string; allowedRoutes: readonly string[] }): E => ({
    ...listed({
      code: "READ_ONLY_ROUTE_REFUSED",
      reasons: [
        `refusing to POST ${route}: it is not one of the routes recorded as read-only`,
        "the raw path never changes Datadog configuration — a write is a named, door-routed verb such as datadog monitor — so a POST here has to be named as a search or an aggregate before it can be issued",
        `if it genuinely only reads, add it to READ_ONLY_POST_ROUTES in datadog/rawTransport.ts. Currently allowed: ${allowedRoutes.join(", ")}`,
      ],
    }),
    route,
  }),
} as const;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogQueryErrors = { ...logsCountErrors, ...countingErrors, ...requestErrors } as const;

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * a list-carrying failure as its list, and every logs-count failure as its one message.
 *
 * @returns the lines, in order
 */
export function datadogQueryErrorLines({ error }: { error: DatadogQueryError }): readonly string[] {
  if (
    error.code === "LOG_BUCKETS_MISSING" ||
    error.code === "LOG_BUCKET_COUNT_INVALID" ||
    error.code === "LOG_BUCKET_GROUPED" ||
    error.code === "LOG_COMPUTES_MISSING" ||
    error.code === "LOG_COMPUTE_MISSING" ||
    error.code === "LOG_COUNT_STRING_INVALID" ||
    error.code === "LOG_COUNT_NOT_SCALAR" ||
    error.code === "LOG_COUNT_NOT_SAFE_INTEGER" ||
    error.code === "LOG_COUNT_NEGATIVE" ||
    error.code === "LOG_QUERY_UNREACHABLE" ||
    error.code === "LOG_QUERY_REJECTED"
  ) {
    return [error.message];
  }
  return error.reasons;
}

/**
 * Map a boundary's refusal of a raw Datadog body into this union, on its code.
 *
 * @param refusal what the endpoint's `defineBoundary` refused
 * @returns the raw-body variant carrying the boundary's own sentence
 */
export function datadogBoundaryRefusal({ refusal }: { refusal: BoundaryError }): DatadogQueryError {
  switch (refusal.code) {
    case "BOUNDARY_NOT_JSON":
      return DatadogQueryErrors.rawBodyNotJson({ refusal });
    case "BOUNDARY_SHAPE_CHANGED":
      return DatadogQueryErrors.rawBodyInvalid({ refusal });
    default: {
      const unhandled: never = refusal;
      return unhandled;
    }
  }
}
