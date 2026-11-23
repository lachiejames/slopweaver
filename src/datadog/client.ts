/**
 * The one Datadog client. Every verb is handed one; nothing constructs its own.
 *
 * ## Why the typed SDK and not raw `fetch`
 *
 * `@datadog/datadog-api-client` earns its place over raw `fetch` on two specific things rather than
 * general tidiness: the response models are typed (which is what catches the `computes`/`compute` trap
 * described in `logsCount.ts` at compile time), and its HTTP layer already implements header-driven
 * rate-limit backoff.
 *
 * ## What this module owns, and what it delegates
 *
 * It delegates the retry loop, because the SDK's is correct — see `rateLimit.ts` for the reasoning. It
 * owns three things the SDK does not do for you:
 *
 * 1. **Turning retry on.** `enableRetry` defaults to `false`. Left alone, the first 429 surfaces as a hard
 *    failure rather than a wait.
 * 2. **Pinning the site.** The SDK's default server is US1. A wrong site is not an error, it is an empty
 *    answer from another org, so the site is set explicitly from a validated config.
 * 3. **Making the wait visible.** The SDK sleeps inside its own HTTP layer with no hook and no log above
 *    debug, so a rate-limited verb simply appears to hang. Injecting a `fetch` that inspects each response
 *    is the seam that fixes this WITHOUT reimplementing the loop — the SDK still decides whether and how
 *    long to wait; this only reports what it is reacting to.
 */
import { client, v1, v2 } from "@datadog/datadog-api-client";

import type { Logger } from "../lib/logger.js";
import type { DatadogConfig } from "./config.js";
import {
  describeRateLimitWait,
  parseRateLimit,
  RATE_LIMIT_BACKOFF_BASE_SECONDS,
  RATE_LIMIT_MAX_RETRIES,
  type RateLimitSnapshot,
} from "./rateLimit.js";

/**
 * A constructed client: the validated config it was built from, plus the API surfaces this package uses.
 *
 * The API instances are exposed rather than wrapped one method at a time. A facade over each endpoint would
 * be a second, thinner API to keep in step with the SDK's, and the typed request/response models are the
 * main reason the SDK is here — hiding them behind hand-written signatures would give that back.
 */
export interface DatadogClient {
  readonly config: DatadogConfig;
  /** Logs search and aggregation. */
  readonly logs: v2.LogsApi;
  /** Span search and aggregation. Its body shape is the odd one out — see `domain.ts`. */
  readonly spans: v2.SpansApi;
  /** Metric tag configurations, the one bulk list of metric names. */
  readonly metrics: v2.MetricsApi;
  /** Monitor listing, including each monitor's query; `datadog monitor` (`monitorApi.ts`) is its one writer. */
  readonly monitors: v1.MonitorsApi;
  /** Dashboard listing. */
  readonly dashboards: v1.DashboardsApi;
  /** Log index listing — where a window's retention ceiling is read from, never assumed. */
  readonly logsIndexes: v1.LogsIndexesApi;
  /** Log pipeline listing — one per source on this organisation, and the map's record of what is parsed. */
  readonly logsPipelines: v1.LogsPipelinesApi;
  /** RUM applications and RUM events, which are the browser half of the shape catalogue. */
  readonly rum: v2.RUMApi;
  /** CI Visibility's pipeline events — the census's `ci-pipelines` product. */
  readonly ciPipelines: v2.CIVisibilityPipelinesApi;
  /** CI Visibility's test events — the census's `ci-tests` product. */
  readonly ciTests: v2.CIVisibilityTestsApi;
  /** The Software Catalog, read as provenance rather than as the service universe. */
  readonly softwareCatalog: v2.SoftwareCatalogApi;
  /**
   * Error Tracking's issues — `datadog errors` calls `searchIssues`; `datadog triage` calls `getIssue` and the
   * one write, `updateIssueState`.
   */
  readonly errorTracking: v2.ErrorTrackingApi;
  /** Used only by `verifyCredentials` — `validate` isolates the API key. */
  readonly authentication: v1.AuthenticationApi;
  /** Used only by `verifyCredentials` — `listPermissions` is the cheapest call that needs BOTH keys. */
  readonly roles: v2.RolesApi;
  /**
   * The rate-limit budget from the most recent metered response, or `null` if nothing metered has been
   * called yet. A snapshot rather than a running tally: the useful question after a slow verb is "what was
   * I up against", and the last response answers it without this module keeping accounting nobody reads.
   */
  readonly lastRateLimit: () => RateLimitSnapshot | null;
}

/** The global `fetch`, reading each response's rate-limit headers and announcing a 429 wait. */
function rateLimitObservingFetch({
  logger,
  onSnapshot,
}: {
  logger: Logger;
  onSnapshot: (snapshot: RateLimitSnapshot) => void;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const snapshot = parseRateLimit({ headers });
    if (snapshot !== null) {
      onSnapshot(snapshot);
    }
    // 429 only. A 5xx also drives the SDK's retry, but reporting it here would duplicate the error the
    // caller is about to receive anyway; a rate-limit wait is the case where the verb otherwise says
    // nothing at all while it blocks.
    if (response.status === 429) {
      logger.warn({ msg: describeRateLimitWait({ snapshot }) });
    }
    return response;
  };
}

/**
 * Build the shared client.
 *
 * @param config a validated configuration, from `resolveDatadogConfig`
 * @param logger where a rate-limit wait is announced, so a nine-second pause is not silent
 * @param maxRetries how many times the SDK may retry a rate-limited call. Defaults to the interactive value;
 *   a sweep must raise it, because past the retry budget a rate-limited call IS the pacing mechanism
 * @returns the client every verb is handed
 */
export function createDatadogClient({
  config,
  logger,
  maxRetries = RATE_LIMIT_MAX_RETRIES,
}: {
  config: DatadogConfig;
  logger: Logger;
  maxRetries?: number;
}): DatadogClient {
  let lastRateLimit: RateLimitSnapshot | null = null;

  const configuration = client.createConfiguration({
    authMethods: { apiKeyAuth: config.apiKey, appKeyAuth: config.appKey },
    enableRetry: true,
    maxRetries,
    backoffBase: RATE_LIMIT_BACKOFF_BASE_SECONDS,
    fetch: rateLimitObservingFetch({
      logger,
      onSnapshot: (snapshot) => {
        lastRateLimit = snapshot;
      },
    }),
  });
  // The SDK refuses an operation it marks unstable until it is switched on HERE, on the built configuration:
  // `createConfiguration` ignores an `unstableOperations` parameter and starts every one false (measured,
  // passed as a parameter, `datadog hmi` read "Unstable operation … is disabled"). These two are
  // the whole of `datadog hmi` (`historicalIngestion.ts`); delete stays off because no verb switches HMI off.
  configuration.unstableOperations["v2.createHistoricalMetricsConfiguration"] = true;
  configuration.unstableOperations["v2.getHistoricalMetricsConfiguration"] = true;
  // The method, not the deprecated `client.setServerVariables(configuration, …)` free function, which
  // prints a warning to stderr on every invocation.
  configuration.setServerVariables({ site: config.site });

  return {
    config,
    logs: new v2.LogsApi(configuration),
    spans: new v2.SpansApi(configuration),
    metrics: new v2.MetricsApi(configuration),
    monitors: new v1.MonitorsApi(configuration),
    dashboards: new v1.DashboardsApi(configuration),
    logsIndexes: new v1.LogsIndexesApi(configuration),
    logsPipelines: new v1.LogsPipelinesApi(configuration),
    rum: new v2.RUMApi(configuration),
    ciPipelines: new v2.CIVisibilityPipelinesApi(configuration),
    ciTests: new v2.CIVisibilityTestsApi(configuration),
    softwareCatalog: new v2.SoftwareCatalogApi(configuration),
    errorTracking: new v2.ErrorTrackingApi(configuration),
    authentication: new v1.AuthenticationApi(configuration),
    roles: new v2.RolesApi(configuration),
    lastRateLimit: () => lastRateLimit,
  };
}
