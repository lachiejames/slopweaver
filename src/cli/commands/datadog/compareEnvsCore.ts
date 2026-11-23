/**
 * The PURE core of `slopweaver datadog compare-envs`: flag parsing and the human rendering. No fs, no
 * clock, no network — `./compareEnvsRun.ts` runs the two queries and resolves the window.
 *
 * The fold itself lives in `src/datadog/compareEnvs.ts`, which is where the reasoning about the outer join
 * and the one-sided groups is written down.
 */
import {
  type EnvComparison,
  type EnvComparisonRow,
  envScopedQueryIssue,
  sortedTagPairs,
} from "../../../datadog/compareEnvs.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors, datadogArgsErrorLines } from "./errors.js";

/** Exported so the manifest's copy can be asserted equal to this one. */
export const DATADOG_COMPARE_ENVS_USAGE =
  "usage: slopweaver datadog compare-envs --query Q --before ENV --after ENV [--by tag1,tag2] [--limit 50] [--from 1h] [--to now] [--json]";

/**
 * Every flag this verb accepts, as the parser itself reads them.
 *
 * Exported so the help/flag ratchet can compare the advertised set against the accepted one, rather than
 * taking the usage string's word for it.
 *
 * @internal the spec stays here; {@link DATADOG_COMPARE_ENVS_FLAG_NAMES} is what the ratchet reads.
 */
export const DATADOG_COMPARE_ENVS_FLAG_SPEC = {
  boolean: ["json"],
  value: ["query", "before", "after", "by", "limit", "from", "to"],
} as const;

/** {@link DATADOG_COMPARE_ENVS_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_COMPARE_ENVS_FLAG_NAMES: readonly string[] = [
  ...DATADOG_COMPARE_ENVS_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_COMPARE_ENVS_FLAG_SPEC.boolean.map((name) => `--${name}`),
].toSorted();

/** How many buckets each side asks for when the caller states none. */
export const COMPARE_ENVS_DEFAULT_LIMIT = 50;

/** The window start used when the caller states none. Printed in every result, never applied invisibly. */
export const COMPARE_ENVS_DEFAULT_FROM = "1h";

/** The window end used when the caller states none. */
const COMPARE_ENVS_DEFAULT_TO = "now";

/** The validated invocation for `datadog compare-envs`. */
export interface DatadogCompareEnvsOptions {
  /** The metrics query, with a brace filter for the env scope and no `env:` of its own. */
  readonly query: string;
  /** The baseline environment tag. */
  readonly before: string;
  /** The candidate environment tag. */
  readonly after: string;
  /** The tag names the query's `by {...}` clause names, so a bucket's group can be validated. */
  readonly by: readonly string[];
  readonly limit: number;
  readonly from: string;
  readonly to: string;
  readonly json: boolean;
}

/** The comma-separated `--by` value, as tag names. */
function splitByTags({ raw }: { raw: string | undefined }): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** A flag's value when it was given and is not blank, or `undefined` — a blank flag is an absent one here. */
function stated({ raw }: { raw: string | undefined }): string | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return raw;
}

/** Every reason the query itself is unusable, in reading order. */
function queryIssues({ query }: { query: string | undefined }): readonly string[] {
  if (query === undefined) {
    return ["--query is required, e.g. --query 'p90:trace.http.server.request{*} by {resource_name}'"];
  }
  const issue = envScopedQueryIssue({ query });
  return issue === null ? [] : [issue];
}

/** Every reason the two sides are unusable, in reading order. */
function sideIssues({ before, after }: { before: string | undefined; after: string | undefined }): readonly string[] {
  return [
    ...(before === undefined ? ["--before is required: the environment tag the baseline side runs under"] : []),
    ...(after === undefined ? ["--after is required: the environment tag the candidate side runs under"] : []),
    ...(before !== undefined && before === after
      ? [`--before and --after are both '${before}', so there is nothing to compare`]
      : []),
  ];
}

/** The bucket limit, or the one reason the flag's value is not one. */
function parseLimit({ raw, name }: { raw: string | undefined; name: string }): Result<number, DatadogArgsError> {
  if (raw === undefined) {
    return ok(COMPARE_ENVS_DEFAULT_LIMIT);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return err(DatadogArgsErrors.notAWholeNumber({ flag: `--${name}`, got: raw }));
  }
  return ok(parsed);
}

/**
 * Parse `datadog compare-envs`'s flags.
 *
 * @param rest the argv tail (after `slopweaver datadog compare-envs`)
 * @returns the validated options, or every rejection
 */
export function parseDatadogCompareEnvsOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogCompareEnvsOptions, DatadogArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: [...DATADOG_COMPARE_ENVS_FLAG_SPEC.boolean],
      value: [...DATADOG_COMPARE_ENVS_FLAG_SPEC.value],
    },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const query = stated({ raw: values["query"] });
  const before = stated({ raw: values["before"] });
  const after = stated({ raw: values["after"] });
  const limit = parseLimit({ name: "limit", raw: values["limit"] });
  const errors = [
    ...queryIssues({ query }),
    ...sideIssues({ after, before }),
    ...(limit.isErr() ? datadogArgsErrorLines({ error: limit.error }) : []),
  ];
  if (errors.length > 0 || query === undefined || before === undefined || after === undefined || limit.isErr()) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: errors }));
  }
  const { from = COMPARE_ENVS_DEFAULT_FROM, to = COMPARE_ENVS_DEFAULT_TO } = {
    from: stated({ raw: values["from"] }),
    to: stated({ raw: values["to"] }),
  };
  return ok({
    after,
    before,
    by: splitByTags({ raw: values["by"] }),
    from,
    json: flags.has("json"),
    limit: limit.value,
    query,
    to,
  });
}

/** One group's label, as the table prints it: `tag=value` pairs in sorted key order. */
function rowLabel({ row }: { row: EnvComparisonRow }): string {
  const pairs = sortedTagPairs({ by: row.by });
  if (pairs.length === 0) {
    return "(all)";
  }
  return pairs.map(([tag, value]) => `${tag}=${value}`).join(" ");
}

/** One side's cell: the number, or a dash when that side never reported this group. */
function cell({ value }: { value: number | null }): string {
  return value === null ? "—" : value.toFixed(2);
}

/** The delta cell, signed, or a dash when one side is missing. */
function deltaCell({ row }: { row: EnvComparisonRow }): string {
  if (row.delta === null) {
    return "—";
  }
  const sign = row.delta > 0 ? "+" : "";
  const ratio = row.ratio === null ? "" : ` (${sign}${(row.ratio * 100).toFixed(0)}%)`;
  return `${sign}${row.delta.toFixed(2)}${ratio}`;
}

/**
 * The human view: what was compared, and every group, worst regression first.
 *
 * @param comparison the joined sides
 * @param query the caller's own query, before either env scope was added
 * @returns the lines to print, in order
 */
export function renderCompareEnvs({
  comparison,
  query,
}: {
  comparison: EnvComparison;
  query: string;
}): readonly string[] {
  const header = [
    `compare-envs: ${query}`,
    `  before: env:${comparison.beforeEnv}`,
    `  after:  env:${comparison.afterEnv}`,
  ];
  if (comparison.rows.length === 0) {
    return [
      ...header,
      "neither side reported a single bucket — nothing was measured, which is not the same as no change",
    ];
  }
  const rows = comparison.rows.map(
    (row) =>
      `  ${deltaCell({ row }).padEnd(18)} ${cell({ value: row.before }).padStart(10)} -> ${cell({ value: row.after }).padStart(10)}  ${rowLabel({ row })}`,
  );
  const asides = [
    ...(comparison.onlyAfter.length > 0
      ? [`${String(comparison.onlyAfter.length)} group(s) only the AFTER side reported — work this change added`]
      : []),
    ...(comparison.onlyBefore.length > 0
      ? [`${String(comparison.onlyBefore.length)} group(s) only the BEFORE side reported — work this change removed`]
      : []),
  ];
  return [...header, "  delta                   before ->      after  group", ...rows, ...asides];
}
