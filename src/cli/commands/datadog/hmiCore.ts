/**
 * The PURE core of `slopweaver datadog hmi`: flag parsing and the lines it prints. No fs, no clock, no
 * network — `hmiRun.ts` does every credential resolution and every call.
 */
import type { HmiEnablePlan, HmiState } from "../../../datadog/historicalIngestion.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { collectRepeated, parseFlagTail, withoutRepeated } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** The validated invocation for `datadog hmi`. */
export interface DatadogHmiOptions {
  /** Every metric named, split on commas across every `--metric`, in the order written. */
  readonly metrics: readonly string[];
  /** `--enable`: switch HMI on for every metric that is off, then read every one back. */
  readonly enable: boolean;
  /** `--dry-run`: with `--enable`, read and plan, switch nothing on. */
  readonly dryRun: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Every flag `datadog hmi` accepts, as the parser itself reads them. `metric` is repeatable, so it is
 * collected before the single-value tokeniser sees the tail.
 *
 * @internal the spec itself stays in this file; {@link DATADOG_HMI_FLAG_NAMES} is what the help ratchet reads.
 */
export const DATADOG_HMI_FLAG_SPEC = {
  boolean: ["dry-run", "enable", "json"],
  repeatable: ["metric"],
  value: ["home"],
} as const;

/** {@link DATADOG_HMI_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_HMI_FLAG_NAMES: readonly string[] = [
  ...DATADOG_HMI_FLAG_SPEC.repeatable.map((name) => `--${name}`),
  ...DATADOG_HMI_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_HMI_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse `datadog hmi`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or the rejection
 */
export function parseDatadogHmiOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogHmiOptions, DatadogArgsError> {
  const metrics = collectRepeated({ name: "--metric", rest })
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--metric", rest }),
    spec: { boolean: [...DATADOG_HMI_FLAG_SPEC.boolean], value: [...DATADOG_HMI_FLAG_SPEC.value] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  if (metrics.length === 0) {
    return err(DatadogArgsErrors.metricMissing());
  }
  const { values, flags } = parsed.value;
  if (flags.has("dry-run") && !flags.has("enable")) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: ["--dry-run only means something with --enable"] }));
  }
  return ok({
    dryRun: flags.has("dry-run"),
    enable: flags.has("enable"),
    home: values["home"],
    json: flags.has("json"),
    metrics,
  });
}

/**
 * One line per metric: on (with when Datadog says the setting was created) or off.
 *
 * @param states each metric's setting
 * @returns the lines, in the order the metrics were named
 */
export function hmiStateLines({ states }: { states: readonly HmiState[] }): readonly string[] {
  return states.map((state) => {
    if (!state.enabled) {
      return `off  ${state.metric}`;
    }
    const since = state.createdIso === null ? "" : `  (since ${state.createdIso})`;
    return `on   ${state.metric}${since}`;
  });
}

/**
 * The lines an enable plan prints before anything is switched on.
 *
 * @param plan which metrics are already on and which this run switches on
 * @param verb `would enable` for a dry run, `enabling` otherwise
 * @returns the lines
 */
export function hmiPlanLines({ plan, verb }: { plan: HmiEnablePlan; verb: string }): readonly string[] {
  return [
    `${verb} ${String(plan.toEnable.length)} metric(s); ${String(plan.alreadyOn.length)} already on`,
    ...plan.toEnable.map((metric) => `  + ${metric}`),
  ];
}

/**
 * What an "on" read-back does not prove, printed after every successful enable so "on" never reads as
 * "safe to backfill this second".
 */
export const HMI_EFFECTIVE_CAVEAT =
  "read back: the configuration exists for every metric. How soon Datadog's intake honours a newly created " +
  "one is unmeasured — leave a gap before the first backdated point, and read the backfill back afterwards";
