/**
 * `slopweaver datadog produce --producer NAME --day YYYY-MM-DD --out FILE [--home DIR] [--json]` — run one metrics
 * producer the selected home declares (`profile.json` `datadog.metricsProducers.<name>`, `datadog/metricsProducer.ts`
 * carries the contract) for one UTC day, and write what it printed as the payload `datadog submit` takes.
 *
 * This is the PRODUCE half of a metrics push; `datadog submit` is the WRITE half and the only one. Nothing reaches
 * Datadog from here, which is what lets a reader check the payload before `--allow-late` stamps it. What the
 * producer itself reads is its own business: it runs with the declared secrets and nothing else of the parent's
 * (`datadog/metricsProducerRun.ts`).
 *
 * ## The exit-code contract
 *
 * | situation                                                                   | code |
 * | --------------------------------------------------------------------------- | ---- |
 * | a bad flag, a day that is not a calendar day or is after today              | `2`  |
 * | no producer by that name is declared, or a secret it declares is not stored | `3`  |
 * | the profile is there but corrupt, or maps a secret the register does not name | `1`  |
 * | the producer could not launch, was killed, or exited non-zero               | `1`  |
 * | it ran, but its last stdout line is not a series document                   | `1`  |
 * | the payload could not be written                                            | `1`  |
 * | the payload was written                                                     | `0`  |
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  type MetricsProducerError,
  MetricsProducerErrors,
  metricsProducerFromProfile,
  parseMetricsProducerOutput,
} from "../../../datadog/metricsProducer.js";
import {
  type ProducerCommand,
  type ProducerSecretReader,
  producerEnvironment,
  runMetricsProducer,
} from "../../../datadog/metricsProducerRun.js";
import type { SubmittedSeries } from "../../../datadog/seriesPayload.js";
import { writeSeriesPayload } from "../../../datadog/seriesPayloadFile.js";
import type { Profile } from "../../../profile.js";
import { readProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import {
  type DatadogProduceError,
  DatadogProduceErrors,
  datadogArgsErrorLines,
  datadogProduceErrorLines,
} from "./errors.js";
import { type DatadogProduceReport, parseDatadogProduceOptions, produceReportLines } from "./produceCore.js";
import { DATADOG_PRODUCE_USAGE } from "./usage.js";

/**
 * The exit code one refusal earns: absent configuration is a legitimate non-success status a scheduler stamps, and
 * everything else is a fault.
 *
 * @param error how producing failed
 * @returns `3` for an undeclared producer or an unstored secret, else `1`
 */
export function produceExitCode({ error }: { readonly error: MetricsProducerError }): number {
  switch (error.code) {
    case "PRODUCER_NOT_DECLARED":
    case "PRODUCER_SECRET_ABSENT":
      return EXIT_EXPECTED_EMPTY;
    case "PRODUCER_PROFILE_UNREADABLE":
    case "PRODUCER_SECRET_UNREGISTERED":
    case "PRODUCER_SECRET_RESERVED_NAME":
    case "PRODUCER_RUN_FAILED":
    case "PRODUCER_OUTPUT_INVALID":
      return EXIT_ERROR;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * Everything a run decides between reading the profile and writing the file: the declaration, the environment,
 * the launch and the parse. The two seams default to the real store and `execFileSync`.
 *
 * @param profile the selected home's profile, `null` when it has none
 * @param producer the name asked for
 * @param day the UTC day handed to the producer
 * @param home the selected home, handed to the child and read for its secrets
 * @param parentEnv the environment the child's baseline is copied from
 * @param runCommand stands in for `execFileSync` in a test
 * @param readSecret stands in for the secrets store in a test
 * @returns the series the producer printed, or the first refusal
 */
export function produceDay({
  profile,
  producer,
  day,
  home,
  parentEnv,
  runCommand,
  readSecret,
}: {
  readonly profile: Profile | null;
  readonly producer: string;
  readonly day: string;
  readonly home: string;
  readonly parentEnv: NodeJS.ProcessEnv;
  readonly runCommand?: ProducerCommand;
  readonly readSecret?: ProducerSecretReader;
}): Result<readonly SubmittedSeries[], MetricsProducerError> {
  const config = metricsProducerFromProfile({ producer, profile });
  if (config.isErr()) {
    return err(config.error);
  }
  const env = producerEnvironment({
    config: config.value,
    home,
    parentEnv,
    producer,
    ...(readSecret === undefined ? {} : { readSecret }),
  });
  if (env.isErr()) {
    return err(env.error);
  }
  const stdout = runMetricsProducer({
    config: config.value,
    day,
    env: env.value,
    producer,
    ...(runCommand === undefined ? {} : { runCommand }),
  });
  if (stdout.isErr()) {
    return err(stdout.error);
  }
  return parseMetricsProducerOutput({ day, producer, stdout: stdout.value });
}

/** Print a refusal and, for a failed run, the stderr tail it kept. */
function printRefusal({ error }: { readonly error: MetricsProducerError }): void {
  logger.error({ msg: `datadog produce: ${error.message}` });
  if (error.code === "PRODUCER_RUN_FAILED") {
    error.stderrTail.forEach((line) => {
      logger.error({ msg: `  stderr: ${line}` });
    });
  }
}

/** Write the payload, or say why it could not be. */
function writePayload({
  out,
  series,
}: {
  readonly out: string;
  readonly series: readonly SubmittedSeries[];
}): Result<undefined, DatadogProduceError> {
  try {
    writeSeriesPayload({ out, series });
    return ok(undefined);
  } catch (error: unknown) {
    return err(DatadogProduceErrors.payloadWriteFailed({ cause: error, out }));
  }
}

/**
 * Run the `datadog produce` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runDatadogProduce(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["produce"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_PRODUCE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogProduceOptions({ rest, todayUtc: new Date().toISOString().slice(0, 10) });
  if (parsed.isErr()) {
    datadogArgsErrorLines({ error: parsed.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: DATADOG_PRODUCE_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const profile = readProfile({ home });
  if (profile.isErr()) {
    const error = MetricsProducerErrors.profileUnreadable({ error: profile.error });
    printRefusal({ error });
    return produceExitCode({ error });
  }
  logger.error({ msg: `datadog produce: running producer '${options.producer}' for ${options.day}` });
  const series = produceDay({
    day: options.day,
    home,
    parentEnv: process.env,
    producer: options.producer,
    profile: profile.value,
  });
  if (series.isErr()) {
    printRefusal({ error: series.error });
    return produceExitCode({ error: series.error });
  }
  const written = writePayload({ out: options.out, series: series.value });
  if (written.isErr()) {
    for (const line of datadogProduceErrorLines({ error: written.error })) {
      logger.error({ msg: `datadog produce: ${line}` });
    }
    return EXIT_ERROR;
  }
  const report: DatadogProduceReport = {
    day: options.day,
    out: options.out,
    pointCount: series.value.reduce((n, one) => n + one.points.length, 0),
    producer: options.producer,
    seriesCount: series.value.length,
  };
  const lines = options.json ? [JSON.stringify(report, null, 2)] : produceReportLines({ report });
  lines.forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const datadogProduceCommand = defineCommand({ run: runDatadogProduce });
