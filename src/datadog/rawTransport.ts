/**
 * The raw authenticated transport, for the endpoints the typed SDK does not cover. It answers TEXT and never
 * interprets it.
 *
 * ## Why this exists at all, given there is a typed client
 *
 * The SDK ships far more API classes than `client.ts` exposes, and adding a typed one is one line — breadth
 * is not the problem. **The problem is that some of the most valuable endpoints have no SDK class at all**:
 * `/api/v1/logs-analytics/*` (the unified event API behind every explorer, and a second oracle for a proof
 * gate) is absent from the SDK entirely, as are several others. Without a raw path those are simply
 * unreachable, and "unreachable" is how a populated product gets recorded as empty.
 *
 * ## Why it answers text, and who reads it
 *
 * Reading what Datadog answered is a per-endpoint decision, so it is not made here. A fixed route reads through
 * `rawRequest.ts`, whose every call names a strict `defineBoundary` for its endpoint. `datadog raw` prints the
 * text unread, because it has no endpoint of its own to declare. The Datadog atlas admits it through each
 * operation's generated strict boundary in `atlas/datadog/apiCall.ts`. A 2xx that is not JSON is therefore a
 * SUCCESS here: whether that is a fault depends on what the caller expected, which only the caller knows.
 *
 * ## Read-only is enforced by the type, not by a convention
 *
 * This path never changes Datadog. A write is a named verb that goes through the SDK and the admit door —
 * `datadog submit`, `datadog hmi --enable`, `datadog monitor update|delete` — never a raw request.
 * {@link RawMethod} admits `GET` and `POST` only, so `PUT`, `PATCH` and `DELETE` are not expressible — a
 * mutating call here is a compile error rather than a review catch.
 *
 * `POST` is not read-only by itself, because Datadog uses it for both search and creation. So a POST is
 * additionally checked against {@link READ_ONLY_POST_ROUTES}, an explicit list rather than a suffix
 * pattern — a suffix pattern like `list|aggregate|search|…` can refuse the ONLY form a genuinely read-only
 * route happens to take. An explicit list makes each addition a one-line reviewable decision instead of a
 * regex nobody can predict the edges of.
 *
 * ## Why there is a retry loop here when `rateLimit.ts` says there should not be
 *
 * `rateLimit.ts` refuses a retry loop because the SDK already owns one, and a second policy would disagree
 * with the first while the first still ran underneath. That reasoning is unchanged — and it does not reach
 * here, because there is no SDK on this path to disagree with. The two loops govern disjoint routes.
 *
 * What keeps them from drifting is that this one is built from the SAME constants and the same header
 * parse: {@link RATE_LIMIT_MAX_RETRIES} attempts, `x-ratelimit-reset` preferred over
 * {@link RATE_LIMIT_BACKOFF_BASE_SECONDS}, read by {@link parseRateLimit}. Datadog sends no `retry-after`,
 * so the reset header is the only wait signal there is.
 */
import { errorMessage } from "../lib/errorMessage.js";
import type { Logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogConfig } from "./config.js";
import { type DatadogQueryError, DatadogQueryErrors, datadogQueryErrorLines } from "./queryErrors.js";
import {
  describeRateLimitWait,
  parseRateLimit,
  RATE_LIMIT_BACKOFF_BASE_SECONDS,
  RATE_LIMIT_MAX_RETRIES,
  type RateLimitSnapshot,
} from "./rateLimit.js";

/**
 * The only two methods this path can issue.
 *
 * The omissions are the feature. See the file header: read-only is a property of the type here, so no
 * future caller can reach for `DELETE` without changing this line and explaining why.
 */
export type RawMethod = "GET" | "POST";

/**
 * The POST routes that read rather than write, listed one by one.
 *
 * A route earns a place here by being a search, an aggregate or an enumeration — never a create. Compared
 * by the path with any query string removed, so `?type=logs` does not need its own entry while a different
 * path still does.
 */
export const READ_ONLY_POST_ROUTES: ReadonlySet<string> = new Set([
  // The unified event API behind every explorer. The reason this module exists.
  "/api/v1/logs-analytics/list",
  "/api/v1/logs-analytics/aggregate",
  // The public v2 aggregates, reachable through the SDK too — listed so a cross-check can issue the same
  // window through both paths and compare, which is exactly what a two-oracle proof gate does.
  "/api/v2/logs/analytics/aggregate",
  "/api/v2/spans/analytics/aggregate",
  // The v2 query endpoints. Both take a POST only because a query with formulas and grouping does not fit
  // in a query string; neither has any create form at all. `cloud_cost` is the reason they are reachable
  // here rather than through `metricsScalar.ts`, which pins `dataSource: "metrics"`.
  "/api/v2/query/scalar",
  "/api/v2/query/timeseries",
]);

/** A 2xx answer's text, exactly as Datadog sent it, with the budget it was measured against. */
export interface RawTextResponse {
  readonly bodyText: string;
  readonly status: number;
  /** The rate-limit budget from this response, or `null` on an unmetered endpoint. */
  readonly rateLimit: RateLimitSnapshot | null;
}

/**
 * A failure that KEPT its HTTP status, for a caller carrying its own typed error union.
 *
 * {@link RawTransport.requestRawText} answers `readonly string[]`, which is right for a verb that only
 * displays what went wrong. It is not enough for a caller that BRANCHES: the Datadog atlas has to tell a 403
 * (a permission boundary this organisation genuinely does not cross, and a coverage state of its own) from a
 * 401 (a broken key) from a 429 (a budget that refills at a known time), and recovering a status by matching
 * the prose of a message is the fragile thing this type exists instead of.
 *
 * `status` is `null` when the request never reached Datadog at all, which is a different fact from any
 * status code and is why it is not `0`. A 2xx status here means the transport succeeded and the CALLER's
 * read of the body refused it (`rawRequest.ts` keeps it so a malformed 200 stays distinct from a 500).
 */
export interface RawFailure {
  readonly status: number | null;
  readonly reasons: readonly string[];
  /** The budget from the failing response, or `null` when there was none to read. */
  readonly rateLimit: RateLimitSnapshot | null;
}

/** The seam that performs the HTTP call. Injected so every branch below is reachable without a network. */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; headers: Readonly<Record<string, string>>; text: () => Promise<string> }>;

/** The seam that waits. Injected for the same reason — a test must not sleep for nine seconds. */
export type SleepLike = ({ seconds }: { seconds: number }) => Promise<void>;

/** One request's inputs, shared by both reads. */
interface RawTextRequest {
  readonly method: RawMethod;
  readonly path: string;
  /** The JSON request body, or omitted for none. */
  readonly body?: unknown;
}

/** A raw transport bound to one config, so no caller assembles a host or a credential header itself. */
export interface RawTransport {
  /**
   * Issue one request and answer its text.
   *
   * @param method `GET`, or `POST` against an allowlisted read route
   * @param path the API path, with any query string
   * @param body the JSON request body, or omitted for none
   * @returns the 2xx text, or every reason the call did not succeed
   */
  requestRawText: (input: RawTextRequest) => Promise<Result<RawTextResponse>>;
  /**
   * The same call, keeping the HTTP status on the failure arm.
   *
   * One loop serves both: {@link RawTransport.requestRawText} is a thin `mapErr` over this. A second loop
   * with its own retry policy is the thing `rateLimit.ts` refuses, so a caller needing to branch on a status
   * takes this rather than building one.
   *
   * @param method `GET`, or `POST` against an allowlisted read route
   * @param path the API path, with any query string
   * @param body the JSON request body, or omitted for none
   * @returns the 2xx text, or the failure with its status attached
   */
  requestRawTextWithStatus: (input: RawTextRequest) => Promise<Result<RawTextResponse, RawFailure>>;
  /** The budget from the most recent metered response, or `null` if nothing metered has been called. */
  lastRateLimit: () => RateLimitSnapshot | null;
}

/**
 * Strip a query string, so an allowlist entry covers every parameterisation of one route.
 *
 * The `!` is an invariant, not a guess: splitting a string on a string separator always yields at least one
 * element (`"".split("?")` is `[""]`), so index 0 is present for every path.
 */
function routeOf({ path }: { path: string }): string {
  return path.split("?")[0]!;
}

/**
 * Refuse a method/route pair that is not read-only.
 *
 * @param method the method being issued
 * @param path the API path
 * @returns nothing when the call only reads, or the reason it was refused
 */
export function assertReadOnly({ method, path }: { method: RawMethod; path: string }): Result<null, DatadogQueryError> {
  if (method === "GET") {
    return ok(null);
  }
  const route = routeOf({ path });
  if (READ_ONLY_POST_ROUTES.has(route)) {
    return ok(null);
  }
  return err(DatadogQueryErrors.readOnlyRouteRefused({ allowedRoutes: [...READ_ONLY_POST_ROUTES], route }));
}

/**
 * How long to wait before retrying a 429, preferring Datadog's own reset over the backoff base.
 *
 * `x-ratelimit-reset` is the only wait signal Datadog sends, and a 429 can arrive with no rate-limit headers
 * at all or a set lacking the reset (a malformed one); either way there is no reset to honour, so the retry
 * waits the base the header comment above names.
 */
function waitSeconds({ snapshot }: { snapshot: RateLimitSnapshot | null }): number {
  if (snapshot === null) {
    return RATE_LIMIT_BACKOFF_BASE_SECONDS;
  }
  const { resetSeconds } = snapshot;
  if (resetSeconds === null) {
    return RATE_LIMIT_BACKOFF_BASE_SECONDS;
  }
  return resetSeconds;
}

/** Copy the response headers into a plain record, so the parse stays pure over a value. */
function headerRecord({ headers }: { headers: Readonly<Record<string, string>> }): Record<string, string> {
  return { ...headers };
}

/**
 * Classify a non-2xx status, keeping the distinctions that change what a reader should conclude.
 *
 * The one that matters most: **a 400 means reachable-but-wrong-request-shape, never empty.** Several valid
 * event tracks answer a plausible-looking body with a 400, and recording those as "no data" would
 * misdescribe the estate.
 *
 * @param status the HTTP status
 * @param path the route
 * @param raw the response text, trimmed into the message so the reason is visible
 * @returns every reason worth reporting
 */
export function classifyRawStatus({
  status,
  path,
  raw,
}: {
  status: number;
  path: string;
  raw: string;
}): readonly string[] {
  const detail = raw.trim().slice(0, 400);
  if (status === 400) {
    return [
      `${path} returned HTTP 400: ${detail}`,
      "a 400 means reachable-but-wrong-request-shape, NOT empty — recording this as having no data would misdescribe the estate",
    ];
  }
  if (status === 401 || status === 403) {
    return [
      `${path} returned HTTP ${String(status)}: ${detail}`,
      "this is an entitlement or credential problem, not an empty product — and a 403 on one endpoint is not an auth verdict for the estate",
    ];
  }
  if (status === 404) {
    return [
      `${path} returned HTTP 404: ${detail}`,
      "the route is not there on this site — several documented Datadog paths have moved, so check the path before concluding the product is absent",
    ];
  }
  if (status === 429) {
    return [`${path} was rate limited and the retries were exhausted: ${detail}`];
  }
  return [`${path} returned HTTP ${String(status)}: ${detail}`];
}

/**
 * Build the raw transport.
 *
 * @param config a validated configuration, from `resolveDatadogConfig` — the host and both keys come from
 *   here so nothing hard-codes a site
 * @param logger where a rate-limit wait is announced, so a nine-second pause is not silent
 * @param fetchImpl the HTTP seam, defaulting to the global `fetch`
 * @param sleep the wait seam, defaulting to a real timer
 * @returns a transport bound to that config
 */
export function createRawTransport({
  config,
  logger,
  fetchImpl = globalFetch,
  sleep = realSleep,
}: {
  config: DatadogConfig;
  logger: Logger;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
}): RawTransport {
  let lastRateLimit: RateLimitSnapshot | null = null;

  const requestRawTextWithStatus = async ({
    method,
    path,
    body,
  }: RawTextRequest): Promise<Result<RawTextResponse, RawFailure>> => {
    const allowed = assertReadOnly({ method, path });
    if (allowed.isErr()) {
      // No request was issued, so there is no status to carry and none to invent.
      return err({ rateLimit: null, reasons: datadogQueryErrorLines({ error: allowed.error }), status: null });
    }
    const url = `https://${config.apiHost}${path}`;
    const init = requestInit({ method, config, body });

    // `<=` so RATE_LIMIT_MAX_RETRIES means retries, not total attempts — the same reading the SDK gives it.
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
      const attempted = await attemptOnce({ doFetch: fetchImpl, url, init, path });
      if (attempted.rateLimit !== null) {
        lastRateLimit = attempted.rateLimit;
      }
      if (attempted.retryable && attempt < RATE_LIMIT_MAX_RETRIES) {
        logger.warn({ msg: describeRateLimitWait({ snapshot: attempted.rateLimit }) });
        await sleep({ seconds: waitSeconds({ snapshot: attempted.rateLimit }) });
        continue;
      }
      return attempted.result;
    }
    // Unreachable: the loop above either returns or exhausts its attempts and returns on the last one.
    return err({
      rateLimit: null,
      reasons: [`${path} exhausted its retries without producing a result`],
      status: null,
    });
  };

  return rawTransportFrom({ lastRateLimit: () => lastRateLimit, requestRawTextWithStatus });
}

/**
 * Complete a transport from its status-carrying half, so `requestRawText` is DERIVED and never written twice.
 *
 * The two methods are one call with two error shapes, and the moment a caller (or a test fake) writes both
 * by hand they can disagree — a fake whose `requestRawText` succeeds while its `requestRawTextWithStatus`
 * refuses tests nothing. Everything that produces a `RawTransport`, real or fake, goes through here.
 *
 * @param requestRawTextWithStatus the one implementation, carrying the HTTP status on its failure arm
 * @param lastRateLimit the budget accessor this transport should expose
 * @returns the complete transport
 */
export function rawTransportFrom({
  requestRawTextWithStatus,
  lastRateLimit,
}: {
  requestRawTextWithStatus: RawTransport["requestRawTextWithStatus"];
  lastRateLimit: () => RateLimitSnapshot | null;
}): RawTransport {
  const requestRawText = async (input: RawTextRequest): Promise<Result<RawTextResponse>> =>
    (await requestRawTextWithStatus(input)).mapErr((failure) => failure.reasons);
  return { lastRateLimit, requestRawText, requestRawTextWithStatus };
}

/** The default HTTP seam: the global `fetch`, with its headers flattened into a plain record. */
const globalFetch: FetchLike = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: response.status, headers, text: () => response.text() };
};

/** The default wait seam: a real timer. */
const realSleep: SleepLike = ({ seconds }) =>
  new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

/** Assemble the request, so the credential headers are written in exactly one place. */
function requestInit({ method, config, body }: { method: RawMethod; config: DatadogConfig; body: unknown }): {
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  const headers = {
    "content-type": "application/json",
    "dd-api-key": config.apiKey,
    "dd-application-key": config.appKey,
  };
  return { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

/** One attempt: the outcome, its budget, and whether a retry could plausibly change it. */
async function attemptOnce({
  doFetch,
  url,
  init,
  path,
}: {
  doFetch: FetchLike;
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
  path: string;
}): Promise<{ result: Result<RawTextResponse, RawFailure>; rateLimit: RateLimitSnapshot | null; retryable: boolean }> {
  let status = 0;
  let headers: Readonly<Record<string, string>> = {};
  let raw = "";
  try {
    const response = await doFetch(url, init);
    status = response.status;
    headers = response.headers;
    raw = await response.text();
  } catch (error: unknown) {
    // Never reached Datadog at all. Distinct from every status-code branch, and distinct from empty — which
    // is why the failure's status is `null` here rather than a zero somebody could read as a status.
    return {
      result: err({
        rateLimit: null,
        reasons: [`the request to ${path} never reached Datadog at ${url}: ${errorMessage({ error })}`],
        status: null,
      }),
      rateLimit: null,
      retryable: false,
    };
  }
  const rateLimit = parseRateLimit({ headers: headerRecord({ headers }) });
  if (status === 429) {
    return {
      result: err({ rateLimit, reasons: classifyRawStatus({ status, path, raw }), status }),
      rateLimit,
      retryable: true,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      result: err({ rateLimit, reasons: classifyRawStatus({ status, path, raw }), status }),
      rateLimit,
      retryable: false,
    };
  }
  return { result: ok({ bodyText: raw, rateLimit, status }), rateLimit, retryable: false };
}
