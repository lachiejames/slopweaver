/**
 * `slopweaver datadog compare-envs --query Q --before ENV --after ENV [--by tag1,tag2] [--limit 50]
 * [--from 1h] [--to now] [--json]` — run ONE query twice, once per environment tag, and print the per-group
 * movement between them, worst regression first.
 *
 * The bisect verb a release incident wanted and nobody had. Two worktrees, both posting to
 * Datadog under their own environment tag, and the question "which one is slower, and where" answered in a
 * table rather than by eyeballing two console tabs. The fold and its reasoning are in
 * `src/datadog/compareEnvs.ts`; the flags and the rendering in `./compareEnvsCore.ts`.
 *
 * ## It does not stand the environments up, and that is the point
 *
 * What runs the two sides is whatever already does: a Coder workspace pair, two local worktrees under
 * `deployment.environment.name=local-proof-<slug>`, two deploys. This verb takes the two tags as given.
 * MEASURED on this organisation, the SUP-2619 before/after proof ran under
 * `env:coder-octocat-sup2619-before` and `…-after`, and was compared by hand, in the console, one
 * trace at a time.
 *
 * ## The exit-code contract
 *
 * | situation                                                     | code |
 * | --------------------------------------------------------------- | ---- |
 * | a bad flag, an env-scoped query, or an unparseable window      | `2`  |
 * | credentials unset, malformed, or rejected by Datadog            | `3`  |
 * | both sides answered, and neither reported a single bucket       | `3`  |
 * | at least one side reported a bucket                             | `0`  |
 * | Datadog was never reached, or answered unreadably               | `1`  |
 */
import { createDatadogClient, type DatadogClient } from "../../../datadog/client.js";
import { compareEnvSides, type EnvBucket, type EnvComparison, envScopedQuery } from "../../../datadog/compareEnvs.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { type MetricsScalarBucket, metricsScalarCount } from "../../../datadog/metricsScalar.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  DATADOG_COMPARE_ENVS_USAGE,
  type DatadogCompareEnvsOptions,
  parseDatadogCompareEnvsOptions,
  renderCompareEnvs,
} from "./compareEnvsCore.js";
import { resolveDatadogPreflight } from "./shell.js";

/** What one comparison established, as `--json` reports it. */
export interface CompareEnvsReport {
  readonly outcome: "measured" | "empty";
  readonly site: string;
  readonly query: string;
  readonly by: readonly string[];
  readonly comparison: EnvComparison;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * The exit code a comparison earns.
 *
 * @param rowCount how many groups either side reported
 * @returns `0` for at least one group, `3` for an honest zero on both sides
 */
export function exitCodeForCompareEnvsRowCount({ rowCount }: { rowCount: number }): number {
  return rowCount > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** Print every reason, in order. */
function reportErrors({ errors }: { errors: readonly string[] }): void {
  for (const error of errors) {
    logger.error({ msg: error });
  }
}

/**
 * One side's scalar buckets as the comparison's own shape. A scalar bucket's number is called `count` because
 * the metrics endpoint aggregates with `sum`; what it holds is whatever the query asked for, which is a
 * latency as often as a count, so the comparison names it `value` and this is the one place they meet.
 *
 * @param buckets the buckets one side's query returned
 * @returns the same buckets, renamed
 */
function sideBuckets({ buckets }: { buckets: readonly MetricsScalarBucket[] }): readonly EnvBucket[] {
  return buckets.map((bucket) => ({ by: bucket.by, value: bucket.count }));
}

/**
 * Run the two scalar queries, one per side, and join them.
 *
 * @param flags the validated invocation
 * @param client the shared Datadog client
 * @param window the absolute window both sides are read over, so the two are comparable at all
 * @returns the joined comparison, or why a side could not be measured
 */
async function measure({
  flags,
  client,
  window,
}: {
  flags: DatadogCompareEnvsOptions;
  client: DatadogClient;
  window: AbsoluteWindow;
}): Promise<Result<EnvComparison>> {
  const before = await metricsScalarCount({
    client,
    expectedGroupTags: flags.by,
    limit: flags.limit,
    query: envScopedQuery({ env: flags.before, query: flags.query }),
    window,
  });
  if (before.isErr()) {
    return err([before.error.message].map((reason) => `before side (env:${flags.before}): ${reason}`));
  }
  const after = await metricsScalarCount({
    client,
    expectedGroupTags: flags.by,
    limit: flags.limit,
    query: envScopedQuery({ env: flags.after, query: flags.query }),
    window,
  });
  if (after.isErr()) {
    return err([after.error.message].map((reason) => `after side (env:${flags.after}): ${reason}`));
  }
  return ok(
    compareEnvSides({
      after: { buckets: sideBuckets({ buckets: after.value.buckets }), env: flags.after },
      before: { buckets: sideBuckets({ buckets: before.value.buckets }), env: flags.before },
    }),
  );
}

/**
 * Run the `datadog compare-envs` verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogCompareEnvs(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["compare-envs"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_COMPARE_ENVS_USAGE });
    return EXIT_OK;
  }
  const preflight = resolveDatadogPreflight({
    parseFlags: parseDatadogCompareEnvsOptions,
    rest,
    usage: DATADOG_COMPARE_ENVS_USAGE,
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

  const comparison = await measure({ client, flags, window });
  if (comparison.isErr()) {
    reportErrors({ errors: comparison.error });
    return EXIT_ERROR;
  }
  const rowCount = comparison.value.rows.length;
  if (flags.json) {
    const report: CompareEnvsReport = {
      by: flags.by,
      comparison: comparison.value,
      fromMs: window.fromMs,
      outcome: rowCount > 0 ? "measured" : "empty",
      query: flags.query,
      site: config.site,
      toMs: window.toMs,
    };
    logger.out({ line: safeJsonStringify({ label: "the compare-envs report", value: report }) });
    return exitCodeForCompareEnvsRowCount({ rowCount });
  }
  for (const line of renderCompareEnvs({ comparison: comparison.value, query: flags.query })) {
    logger.out({ line });
  }
  return exitCodeForCompareEnvsRowCount({ rowCount });
}

export const datadogCompareEnvsCommand = defineCommand({ run: runDatadogCompareEnvs });
