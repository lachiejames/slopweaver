/**
 * The PURE core shared by `slopweaver datadog verify|probe|metrics|submit`: flag parsing and small
 * rendering helpers (`raw`'s are in `rawCore.ts`). No fs, no clock, no network — the shells (`verifyRun`,
 * `probeRun`, `metricsRun`, `submitRun`) do every read, write, clock read and credential resolution.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** What a parser here returns: the options, or the one {@link DatadogArgsError} that refused them. */
type Parsed<T> = Result<T, DatadogArgsError>;

/** The validated invocation shared by `verify` and `probe` — both take only `--json`. */
export interface DatadogJsonOnlyOptions {
  readonly json: boolean;
}

/**
 * Parse a verb tail that accepts only `--json`.
 *
 * @param rest the argv tail (after `slopweaver datadog <verb>`)
 * @returns the validated options, or every rejection
 */
export function parseDatadogJsonOnlyOptions({ rest }: { rest: readonly string[] }): Result<DatadogJsonOnlyOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: [] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.flags.has("json") });
}

/** The validated invocation for `datadog probe`. */
export interface DatadogProbeOptions {
  readonly query: string;
  readonly from: string;
  readonly to: string;
  readonly prodEnv: boolean;
  /** `--sum-metric ATTR`: sum a log attribute (via `logsSum`) instead of counting matched logs. */
  readonly sumMetric: string | null;
  /** `--verify-env`: re-check the matched events' real `env` facet via `verifyEnvScope` before reporting. */
  readonly verifyEnv: boolean;
  readonly json: boolean;
}

/** The window start used when the caller states none. Printed in every result, never applied invisibly. */
export const PROBE_DEFAULT_FROM = "15m";

/**
 * Parse `datadog probe`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogProbeOptions({ rest }: { rest: readonly string[] }): Parsed<DatadogProbeOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["prod-env", "verify-env", "json"], value: ["query", "from", "to", "sum-metric"] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { flags } = parsed.value;
  return ok({
    query: flagValueOr({ fallback: "*", name: "query", parsed: parsed.value }),
    from: flagValueOr({ fallback: PROBE_DEFAULT_FROM, name: "from", parsed: parsed.value }),
    to: flagValueOr({ fallback: "now", name: "to", parsed: parsed.value }),
    prodEnv: flags.has("prod-env"),
    sumMetric: flagValue({ name: "sum-metric", parsed: parsed.value }),
    verifyEnv: flags.has("verify-env"),
    json: flags.has("json"),
  });
}

/**
 * Build the probe query, applying the prod-env filter only when it was asked for.
 *
 * The filter is opt-in because a meaningful share of an estate's telemetry can carry no `env` tag at all —
 * folding it in by default would narrow every result invisibly. See `datadog/prodEnvFilter.ts`.
 *
 * @param query the `--query` value, already defaulted to `*`
 * @param prodEnv whether `--prod-env` was passed
 * @param prodEnvFilterFragment the query fragment to append, from `prodEnvFilter()`
 * @returns the query to send
 */
export function buildProbeQuery({
  query,
  prodEnv,
  prodEnvFilterFragment,
}: {
  query: string;
  prodEnv: boolean;
  prodEnvFilterFragment: string;
}): string {
  return prodEnv ? `(${query}) ${prodEnvFilterFragment}` : query;
}

/** The validated invocation for `datadog metrics`. */
export interface DatadogMetricsOptions {
  readonly query: string;
  /** The exact tag names the query's `by {...}` clause names, in any order. */
  readonly by: readonly string[];
  readonly limit: number;
  readonly from: string;
  readonly to: string;
  readonly json: boolean;
}

/** The window start used when the caller states none. */
export const METRICS_DEFAULT_FROM = "15m";

/** The bucket limit used when the caller states none. */
export const METRICS_DEFAULT_LIMIT = 100;

/**
 * Split a comma-separated `--by` value into its tag names, dropping empty entries.
 *
 * @param raw the raw `--by` flag value, or `undefined` when absent
 * @returns the tag names, in the order given
 */
function splitByTags({ raw }: { raw: string | undefined }): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Parse `datadog metrics`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogMetricsOptions({ rest }: { rest: readonly string[] }): Parsed<DatadogMetricsOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["query", "by", "limit", "from", "to"] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];

  const query = values["query"];
  if (query === undefined || query.trim() === "") {
    errors.push("--query is required, e.g. --query 'sum:example.metric{*} by {delivery_status}.as_count()'");
  }

  let limit = METRICS_DEFAULT_LIMIT;
  if (values["limit"] !== undefined) {
    const parsedLimit = Number.parseInt(values["limit"], 10);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
      errors.push(`--limit must be a positive integer, got '${values["limit"]}'`);
    } else {
      limit = parsedLimit;
    }
  }

  if (errors.length > 0) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: errors }));
  }
  if (query === undefined) {
    // Unreachable: the check above already pushed an error and returned when this is true.
    return err(DatadogArgsErrors.invariantBroken({ detail: "--query was not provided" }));
  }
  return ok({
    query,
    by: splitByTags({ raw: values["by"] }),
    limit,
    from: flagValueOr({ fallback: METRICS_DEFAULT_FROM, name: "from", parsed: parsed.value }),
    to: flagValueOr({ fallback: "now", name: "to", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/** The validated invocation for `datadog submit`. */
export interface DatadogSubmitOptions {
  /** Path to the `{ "series": [...] }` payload file, or `-` for stdin. */
  readonly series: string;
  /** `--allow-late`: the caller states Historical Metrics Ingestion covers every metric in the payload. */
  readonly allowLate: boolean;
  /** `--dry-run`: plan and print, submit nothing. */
  readonly dryRun: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Every flag `datadog submit` accepts, as the parser itself reads them.
 *
 * Exported rather than inlined so the help/flag ratchet can compare the advertised set against the accepted
 * one instead of taking the usage string's word for it — the check that caught a shipped, documented flag
 * being silently unparsed elsewhere in this CLI.
 *
 * @internal the spec itself stays in this file; {@link DATADOG_SUBMIT_FLAG_NAMES} is what the ratchet reads.
 */
export const DATADOG_SUBMIT_FLAG_SPEC = {
  boolean: ["allow-late", "dry-run", "json"],
  value: ["series", "home"],
} as const;

/** {@link DATADOG_SUBMIT_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_SUBMIT_FLAG_NAMES: readonly string[] = [
  ...DATADOG_SUBMIT_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_SUBMIT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse `datadog submit`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogSubmitOptions({ rest }: { rest: readonly string[] }): Parsed<DatadogSubmitOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: [...DATADOG_SUBMIT_FLAG_SPEC.boolean],
      value: [...DATADOG_SUBMIT_FLAG_SPEC.value],
    },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const series = values["series"];
  if (series === undefined || series.trim() === "") {
    return err(DatadogArgsErrors.seriesMissing());
  }
  return ok({
    allowLate: flags.has("allow-late"),
    dryRun: flags.has("dry-run"),
    home: values["home"],
    json: flags.has("json"),
    series: series.trim(),
  });
}

/**
 * The human-readable lines describing a planned or completed gauge submission.
 *
 * The days are spelled out rather than summarised as a count: a backfill's whole claim is WHICH days it
 * filled, and "3 days" is the one rendering of that claim a reader cannot check against a chart.
 *
 * @param plan the plan from `planSubmission`
 * @param verb how to describe the action — `would submit` for a dry run, `submitted` afterwards
 * @returns the lines to print
 */
export function submitPlanLines({
  plan,
  verb,
}: {
  plan: {
    readonly seriesCount: number;
    readonly pointCount: number;
    readonly latePointCount: number;
    readonly utcDays: readonly string[];
    readonly earliestIso: string;
    readonly latestIso: string;
  };
  verb: string;
}): readonly string[] {
  return [
    `datadog submit: ${verb} ${String(plan.seriesCount)} series / ${String(plan.pointCount)} point(s)`,
    `  UTC days: ${plan.utcDays.join(", ")}`,
    `  span: ${plan.earliestIso} → ${plan.latestIso}`,
    `  backdated points: ${String(plan.latePointCount)}`,
  ];
}
