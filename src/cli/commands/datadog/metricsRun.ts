/**
 * `slopweaver datadog metrics --query Q [--by tag1,tag2] [--limit 100] [--from 15m] [--to now] [--json]` —
 * run one grouped `sum` scalar query against Datadog's v2 metrics endpoint and print the buckets.
 *
 * The sibling of `datadog probe` for metrics rather than logs: `metricsScalarCount` reads the columnar
 * scalar-query wire shape (see `datadog/metricsScalar.ts`'s own header) and validates every shape
 * assumption before a bucket is ever printed.
 *
 * ## The exit-code contract
 *
 * | situation                                              | code |
 * | -------------------------------------------------------- | ---- |
 * | a bad flag, or an unparseable window                    | `2`  |
 * | credentials unset, malformed, or rejected by Datadog     | `3`  |
 * | Datadog answered, and the honest answer is zero buckets  | `3`  |
 * | Datadog answered with at least one bucket                | `0`  |
 * | Datadog was never reached, or answered unreadably        | `1`  |
 */
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { type MetricsScalarBucket, metricsScalarCount } from "../../../datadog/metricsScalar.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseDatadogMetricsOptions } from "./core.js";
import { resolveDatadogPreflight } from "./shell.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation, not
 * just this verb's.
 */
export const DATADOG_METRICS_USAGE =
  "usage: slopweaver datadog metrics --query Q [--by tag1,tag2] [--limit 100] [--from 15m] [--to now] [--json]";

/** What the metrics query established. */
export interface MetricsReport {
  readonly outcome: "matched" | "empty";
  readonly site: string;
  readonly query: string;
  readonly by: readonly string[];
  readonly buckets: readonly MetricsScalarBucket[];
  readonly truncated: boolean;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * The exit code a bucket set earns.
 *
 * @param bucketCount how many buckets Datadog returned
 * @returns `0` for at least one bucket, `3` for an honest zero
 */
export function exitCodeForMetricsBucketCount({ bucketCount }: { bucketCount: number }): number {
  return bucketCount > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * The human view: what was asked, and every bucket that came back.
 *
 * @param report what the metrics query established
 * @returns the rendered report
 */
export function renderMetricsText({ report }: { report: MetricsReport }): string {
  const lines = [
    `datadog metrics: ${String(report.buckets.length)} bucket(s)${report.truncated ? " (truncated — raise --limit)" : ""}`,
    "",
    `site    ${report.site}`,
    `query   ${report.query}`,
    `by      ${report.by.length > 0 ? report.by.join(", ") : "(ungrouped)"}`,
    `window  ${new Date(report.fromMs).toISOString()} → ${new Date(report.toMs).toISOString()}`,
  ];
  for (const bucket of report.buckets) {
    const tags = Object.entries(bucket.by)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    lines.push(`  ${String(bucket.count)}  ${tags}`);
  }
  return lines.join("\n");
}

/**
 * The machine view.
 *
 * @param report what the metrics query established
 * @returns the pretty-printed JSON object
 */
export function renderMetricsJson({ report }: { report: MetricsReport }): string {
  return JSON.stringify(report, null, 2);
}

/** Log every reason in a rejection, one line each. */
function reportErrors({ errors }: { errors: readonly string[] }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
}

/**
 * Run the `datadog metrics` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogMetrics(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["metrics"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_METRICS_USAGE });
    return EXIT_OK;
  }
  const preflight = resolveDatadogPreflight({
    parseFlags: parseDatadogMetricsOptions,
    rest,
    usage: DATADOG_METRICS_USAGE,
  });
  if (preflight.isErr()) {
    reportErrors({ errors: preflight.error.errors });
    return preflight.error.code;
  }
  const { flags, config, window } = preflight.value;

  const client = createDatadogClient({ config, logger });
  const verified = await verifyCredentials({ client });
  if (verified.isErr()) {
    reportErrors({ errors: datadogConfigErrorLines({ error: verified.error }) });
    return EXIT_EXPECTED_EMPTY;
  }

  const counted = await metricsScalarCount({
    client,
    query: flags.query,
    expectedGroupTags: flags.by,
    limit: flags.limit,
    window,
  });
  if (counted.isErr()) {
    reportErrors({ errors: [counted.error.message] });
    return EXIT_ERROR;
  }

  const report: MetricsReport = {
    outcome: counted.value.buckets.length > 0 ? "matched" : "empty",
    site: config.site,
    query: flags.query,
    by: flags.by,
    buckets: counted.value.buckets,
    truncated: counted.value.truncated,
    fromMs: window.fromMs,
    toMs: window.toMs,
  };
  logger.out({ line: flags.json ? renderMetricsJson({ report }) : renderMetricsText({ report }) });
  return exitCodeForMetricsBucketCount({ bucketCount: report.buckets.length });
}

export const datadogMetricsCommand = defineCommand({ run: runDatadogMetrics });
