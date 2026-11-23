/**
 * Historical Metrics Ingestion (HMI), read and switched on per metric through the official SDK.
 *
 * ## Why this exists, and what it answers that the console toggle never did
 *
 * Datadog accepts a backdated metric point only for a metric with HMI enabled; sent anywhere else, the point
 * silently burns its (timestamp, tagset) slot for good (`seriesSubmit.ts` carries the incident). HMI was once believed
 * to be a console-only switch, and the V2 console's version of it has the defect this module is built
 * against: a request to turn it on goes through but it may not turn on, and nothing says whether it is on.
 * So enabling is never
 * the end of the verb: every metric is READ BACK afterwards, and the answer is what the read-back says.
 *
 * ## The route, and why it is the SDK's rather than `rawTransport.ts`'s
 *
 * `@datadog/datadog-api-client`'s v2 `MetricsApi` carries `createHistoricalMetricsConfiguration` (POST
 * `/api/v2/metrics/historical-metrics-configurations`) and `getHistoricalMetricsConfiguration` (GET
 * `…/{metric_name}`). The resource's EXISTENCE is the setting — the SDK's own model says there is no separate
 * enabled attribute — so a 200 means on and a 404 means off. MEASURED on this install's site with `slopweaver
 * datadog raw --path /api/v2/metrics/historical-metrics-configurations/<metric>`: `sdlc.v1.pr.merged_daily`
 * answered 200 with a `created_at`, `trajectory.task.turns` answered 404 `"… not found"`.
 * `rawTransport.ts` is read-only by its TYPE, and a POST allowlisted into it would be the lie its header
 * refuses, so the write goes through the SDK here, named as a write.
 *
 * ## What a read-back does NOT prove
 *
 * That the configuration exists, not that Datadog's intake already honours it. How long that takes after
 * the POST is unmeasured, so the verb says so in its output rather than letting "on" read as "safe to
 * backfill this second".
 */
import { client } from "@datadog/datadog-api-client";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";

/**
 * A Datadog metric name: starts with a letter, then letters, digits, underscores and dots, at most 200
 * characters — Datadog's documented naming rule. Checked before anything is sent, because a malformed name
 * reaches the API as a path segment.
 */
const METRIC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.]{0,199}$/u;

/** One metric's HMI setting, as Datadog reported it. */
export type HmiState =
  | { readonly metric: string; readonly enabled: true; readonly createdIso: string | null }
  | { readonly metric: string; readonly enabled: false };

/**
 * What one lookup found: the configuration resource, or its absence.
 *
 * @internal exported only because {@link HmiApi}'s `get` returns it.
 */
export type HmiLookup = { readonly found: true; readonly createdIso: string | null } | { readonly found: false };

/**
 * The two calls this module makes, as a seam: the real one wraps the SDK, a test passes plain functions.
 * A lookup that is neither found nor absent (a 403, a 5xx, no network) THROWS, and the callers below turn
 * that into a typed error naming the metric.
 */
export interface HmiApi {
  readonly get: (request: { metric: string }) => Promise<HmiLookup>;
  readonly create: (request: { metric: string }) => Promise<void>;
}

/** A requested name that is not a Datadog metric name. */
export interface HmiMetricNameInvalidError {
  readonly code: "METRIC_NAME_INVALID";
  readonly message: string;
  readonly names: readonly string[];
}

/** A lookup that answered neither on nor off — the setting is UNKNOWN, which is not the same as off. */
export interface HmiReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly metric: string;
}

/** Datadog refused an enable. `enabledBefore` names what had already been switched on by this run. */
export interface HmiEnableRejectedError {
  readonly code: "ENABLE_REJECTED";
  readonly message: string;
  readonly metric: string;
  readonly enabledBefore: readonly string[];
}

/**
 * Datadog answered an enable with 404: it has never received a point for this metric, and HMI attaches only
 * to a metric it knows. MEASURED on all twelve trajectory task metrics, which had only ever
 * travelled by a replay that refused to send without HMI — the likeliest reading of the V2 console's failure to
 * turn it on.
 */
export interface HmiMetricUnknownError {
  readonly code: "METRIC_UNKNOWN";
  readonly message: string;
  readonly metric: string;
  readonly enabledBefore: readonly string[];
}

/** Every enable was accepted, and the read-back still finds some metrics off — the V2 console's gotcha. */
export interface HmiNotOnAfterEnableError {
  readonly code: "NOT_ON_AFTER_ENABLE";
  readonly message: string;
  readonly stillOff: readonly string[];
}

/** Every way reading or enabling HMI can fail. `code` is what a caller branches on. */
export type DatadogHmiError =
  | HmiMetricNameInvalidError
  | HmiReadFailedError
  | HmiEnableRejectedError
  | HmiMetricUnknownError
  | HmiNotOnAfterEnableError;

/** The factories the real code calls, so a test fixture is built the same way the product builds one. */
export const DatadogHmiErrors = {
  enableRejected: ({
    metric,
    enabledBefore,
    cause,
  }: {
    metric: string;
    enabledBefore: readonly string[];
    cause: unknown;
  }): HmiEnableRejectedError => ({
    code: "ENABLE_REJECTED",
    enabledBefore,
    message:
      `Datadog refused to enable Historical Metrics Ingestion for ${metric}: ${describeCause({ cause })} — ` +
      `${String(enabledBefore.length)} metric(s) had already been enabled by this run` +
      (enabledBefore.length > 0 ? ` (${enabledBefore.join(", ")})` : ""),
    metric,
  }),
  metricUnknown: ({
    metric,
    enabledBefore,
  }: {
    metric: string;
    enabledBefore: readonly string[];
  }): HmiMetricUnknownError => ({
    code: "METRIC_UNKNOWN",
    enabledBefore,
    message:
      `Datadog has never received a point for ${metric}, and will not switch Historical Metrics Ingestion on ` +
      "for a metric it does not know. Send it one CURRENT point of its own type first (`slopweaver datadog " +
      "submit`, never with --allow-late), then re-run — " +
      `${String(enabledBefore.length)} metric(s) had already been enabled by this run`,
    metric,
  }),
  metricNameInvalid: ({ names }: { names: readonly string[] }): HmiMetricNameInvalidError => ({
    code: "METRIC_NAME_INVALID",
    message:
      `not a Datadog metric name: ${names.join(", ")} — a name starts with a letter and holds only letters, ` +
      "digits, underscores and dots, at most 200 characters",
    names,
  }),
  notOnAfterEnable: ({ stillOff }: { stillOff: readonly string[] }): HmiNotOnAfterEnableError => ({
    code: "NOT_ON_AFTER_ENABLE",
    message:
      `Datadog accepted every enable, and the read-back still finds Historical Metrics Ingestion OFF for: ` +
      `${stillOff.join(", ")}. Do not send backdated points to these; re-run the verb to retry`,
    stillOff,
  }),
  readFailed: ({ metric, cause }: { metric: string; cause: unknown }): HmiReadFailedError => ({
    code: "READ_FAILED",
    message:
      `could not read the Historical Metrics Ingestion setting for ${metric}: ${describeCause({ cause })} — ` +
      "the setting is unknown, which is not the same as off",
    metric,
  }),
} as const;

/**
 * A thrown SDK failure, in one line: the HTTP status and Datadog's own error text where there is one.
 *
 * @param cause what the SDK threw
 * @returns the description
 */
function describeCause({ cause }: { cause: unknown }): string {
  if (cause instanceof client.ApiException) {
    return `HTTP ${String(cause.code)} ${JSON.stringify(cause.body)}`;
  }
  return errorMessage({ error: cause });
}

/**
 * Check every requested name before anything is sent, and drop repeats while keeping the order given.
 *
 * @param names the names as the caller wrote them
 * @returns the distinct names, or every name that is not a metric name
 */
export function validateMetricNames({
  names,
}: {
  names: readonly string[];
}): Result<readonly string[], DatadogHmiError> {
  const invalid = names.filter((name) => !METRIC_NAME_PATTERN.test(name));
  if (invalid.length > 0) {
    return err(DatadogHmiErrors.metricNameInvalid({ names: invalid }));
  }
  return ok([...new Set(names)]);
}

/** Which metrics an enable must switch on, and which are already on and are left alone. */
export interface HmiEnablePlan {
  readonly alreadyOn: readonly string[];
  readonly toEnable: readonly string[];
}

/**
 * Split current states into what is already on and what an enable must switch on.
 *
 * An already-on metric is never POSTed again: the read-back is what proves the end state, and a repeat
 * create on an existing configuration is an answer nothing here has measured.
 *
 * @param states each metric's current setting
 * @returns the plan
 */
export function planHmiEnable({ states }: { states: readonly HmiState[] }): HmiEnablePlan {
  return {
    alreadyOn: states.filter((state) => state.enabled).map((state) => state.metric),
    toEnable: states.filter((state) => !state.enabled).map((state) => state.metric),
  };
}

/**
 * The metrics a read-back still finds off.
 *
 * @param states the read-back's states
 * @returns the names that are not on, in order
 */
export function metricsStillOff({ states }: { states: readonly HmiState[] }): readonly string[] {
  return states.filter((state) => !state.enabled).map((state) => state.metric);
}

/**
 * Read each metric's HMI setting, in order, stopping at the first lookup that answers neither on nor off.
 *
 * @param api the lookup seam
 * @param metrics the validated names
 * @returns every metric's state, or the one that could not be read
 */
export async function readHmiStates({
  api,
  metrics,
}: {
  api: HmiApi;
  metrics: readonly string[];
}): Promise<Result<readonly HmiState[], DatadogHmiError>> {
  const states: HmiState[] = [];
  for (const metric of metrics) {
    let lookup: HmiLookup;
    try {
      lookup = await api.get({ metric });
    } catch (cause: unknown) {
      return err(DatadogHmiErrors.readFailed({ cause, metric }));
    }
    states.push(lookup.found ? { createdIso: lookup.createdIso, enabled: true, metric } : { enabled: false, metric });
  }
  return ok(states);
}

/**
 * Switch HMI on for each planned metric, in order, stopping at the first refusal and naming what had
 * already been switched on — an enable is a change to Datadog even when a later one fails.
 *
 * @param api the create seam
 * @param metrics the metrics to switch on
 * @returns the metrics switched on, or the refusal
 */
export async function enableHmi({
  api,
  metrics,
}: {
  api: HmiApi;
  metrics: readonly string[];
}): Promise<Result<readonly string[], DatadogHmiError>> {
  const enabled: string[] = [];
  for (const metric of metrics) {
    try {
      await api.create({ metric });
    } catch (cause: unknown) {
      if (isAbsentConfiguration({ cause })) {
        return err(DatadogHmiErrors.metricUnknown({ enabledBefore: [...enabled], metric }));
      }
      return err(DatadogHmiErrors.enableRejected({ cause, enabledBefore: [...enabled], metric }));
    }
    enabled.push(metric);
  }
  return ok(enabled);
}

/**
 * The real seam: the SDK's two unstable HMI operations on the shared client.
 *
 * A 404 is the one failure that is an ANSWER — the configuration does not exist, so HMI is off — and is
 * mapped to `found: false`. Every other failure is rethrown for {@link readHmiStates} to name.
 *
 * @param datadog the shared client, whose configuration enables both operations
 * @returns the seam
 */
export function sdkHmiApi({ datadog }: { datadog: DatadogClient }): HmiApi {
  return {
    create: async ({ metric }) => {
      await datadog.metrics.createHistoricalMetricsConfiguration({
        body: { data: { id: metric, type: "historical_metrics_configurations" } },
      });
    },
    get: async ({ metric }) => {
      try {
        const response = await datadog.metrics.getHistoricalMetricsConfiguration({ metricName: metric });
        const created = response.data?.attributes?.createdAt;
        return { createdIso: created === undefined ? null : created.toISOString(), found: true };
      } catch (cause: unknown) {
        if (isAbsentConfiguration({ cause })) {
          return { found: false };
        }
        throw cause;
      }
    },
  };
}

/**
 * Whether an SDK failure is the one that ANSWERS a lookup: a 404, meaning no configuration exists, so HMI
 * is off. A 403 or a 5xx is not an answer, and reading one as "off" would invite a backdated point into a
 * metric whose setting nobody knows.
 *
 * @param cause what the SDK threw
 * @returns true only for an SDK 404
 */
export function isAbsentConfiguration({ cause }: { cause: unknown }): boolean {
  return cause instanceof client.ApiException && cause.code === 404;
}
