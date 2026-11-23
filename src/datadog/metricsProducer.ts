/**
 * A METRICS PRODUCER — the pure half: which command the install declared under a name, and what its run printed.
 *
 * Submitting metrics to Datadog is a case lots of companies share, while submitting one install's specific
 * SDLC metrics is specific to that install. What is generic is pushing custom metrics and backfilling them,
 * useful regardless of what the metrics are. So this repository computes no metric of its own. An install declares a
 * producer in `profile.json` `datadog.metricsProducers.<name>` (`../profileProviders.ts`), and the plumbing here,
 * `datadog produce` and the `metrics-push` kind, runs it for one UTC day and submits what it printed through the door.
 *
 * ## The contract a producer keeps
 *
 * It is launched as its declared `command` with `--day YYYY-MM-DD` appended, in its declared `checkout`, and its
 * LAST non-empty stdout line is one `{ "series": [...] }` document in the shape `datadog submit` reads
 * (`./seriesPayload.ts`: gauges, and counts with their interval). Progress may precede it on stdout; a document
 * pretty-printed across lines is outside the contract and refused, and so is any point stamped outside the UTC day
 * it was asked for. The `now`-stamped registration point Datadog needs before it accepts backdated ones
 * (`./historicalIngestion.ts`) is a one-off `datadog submit`, not part of a daily run.
 */
import { yyyyMmDdToEpochSeconds } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import type { Profile } from "../profile.js";
import type { MetricsProducerConfig } from "../profileProviders.js";
import type { ProfileReadError } from "../profileStore.js";
import { parseSeriesPayload, type SubmittedSeries } from "./seriesPayload.js";

/** The install declares no producer by the name asked for — nothing was launched. */
export interface ProducerNotDeclaredError {
  readonly code: "PRODUCER_NOT_DECLARED";
  readonly message: string;
  readonly producer: string;
}

/** The selected home's profile is there but cannot be trusted. */
export interface ProducerProfileUnreadableError {
  readonly code: "PRODUCER_PROFILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A secret the producer declares is not in the store, so it was not launched without it. */
export interface ProducerSecretAbsentError {
  readonly code: "PRODUCER_SECRET_ABSENT";
  readonly message: string;
  readonly secretName: string;
}

/**
 * A secret the producer declares is not a name the credential register (`secrets/registry.ts`) lets the store hold,
 * so `secrets set` could never write it — a typo, or a credential nobody has registered.
 */
export interface ProducerSecretUnregisteredError {
  readonly code: "PRODUCER_SECRET_UNREGISTERED";
  readonly message: string;
  readonly secretName: string;
}

/**
 * A secret is mapped onto a variable the launcher itself sets — the home the producer must resolve, or the gate homes
 * its slopweaver calls are judged against — so the mapping would silently move the child to another home.
 */
export interface ProducerSecretReservedNameError {
  readonly code: "PRODUCER_SECRET_RESERVED_NAME";
  readonly envName: string;
  readonly message: string;
}

/** The producer could not launch, was killed, or exited non-zero. */
export interface ProducerRunFailedError {
  readonly code: "PRODUCER_RUN_FAILED";
  readonly message: string;
  readonly stderrTail: readonly string[];
}

/** The producer ran, but its last stdout line is not a submittable series document. */
export interface ProducerOutputInvalidError {
  readonly code: "PRODUCER_OUTPUT_INVALID";
  readonly message: string;
}

/** Every way producing one day's payload fails. `code` is what a caller branches on. */
export type MetricsProducerError =
  | ProducerNotDeclaredError
  | ProducerProfileUnreadableError
  | ProducerSecretAbsentError
  | ProducerSecretUnregisteredError
  | ProducerSecretReservedNameError
  | ProducerRunFailedError
  | ProducerOutputInvalidError;

/** The factories the real code calls, so a test fixture is built the same way. */
export const MetricsProducerErrors = {
  notDeclared: ({ producer }: { readonly producer: string }): ProducerNotDeclaredError => ({
    code: "PRODUCER_NOT_DECLARED",
    message:
      `no metrics producer '${producer}' is declared: add it under profile.json datadog.metricsProducers ` +
      "with the checkout it runs in and the command that prints its series. Nothing was launched",
    producer,
  }),
  outputInvalid: ({
    producer,
    why,
  }: {
    readonly producer: string;
    readonly why: string;
  }): ProducerOutputInvalidError => ({
    code: "PRODUCER_OUTPUT_INVALID",
    message: `producer '${producer}' printed no usable series document as its last stdout line — ${why}`,
  }),
  profileUnreadable: ({ error }: { readonly error: ProfileReadError }): ProducerProfileUnreadableError => ({
    code: "PRODUCER_PROFILE_UNREADABLE",
    message: error.message,
    path: error.path,
  }),
  runFailed: ({
    producer,
    ending,
    stderrTail,
  }: {
    readonly producer: string;
    readonly ending: string;
    readonly stderrTail: readonly string[];
  }): ProducerRunFailedError => ({
    code: "PRODUCER_RUN_FAILED",
    message: `producer '${producer}' ${ending}; nothing was written`,
    stderrTail,
  }),
  secretAbsent: ({
    producer,
    secretName,
  }: {
    readonly producer: string;
    readonly secretName: string;
  }): ProducerSecretAbsentError => ({
    code: "PRODUCER_SECRET_ABSENT",
    message:
      `producer '${producer}' declares the secret '${secretName}', and the store holds none: ` +
      `set it with \`slopweaver secrets set ${secretName}\`. Nothing was launched`,
    secretName,
  }),
  secretReservedName: ({
    envName,
    producer,
  }: {
    readonly envName: string;
    readonly producer: string;
  }): ProducerSecretReservedNameError => ({
    code: "PRODUCER_SECRET_RESERVED_NAME",
    envName,
    message:
      `producer '${producer}' maps a secret onto ${envName}, which the launcher sets itself so the producer runs ` +
      "against the selected home: map the secret onto another variable. Nothing was launched",
  }),
  secretUnregistered: ({
    producer,
    secretName,
  }: {
    readonly producer: string;
    readonly secretName: string;
  }): ProducerSecretUnregisteredError => ({
    code: "PRODUCER_SECRET_UNREGISTERED",
    message:
      `producer '${producer}' declares the secret '${secretName}', which the credential register does not name, ` +
      "so the store can never hold it: map a registered name (`slopweaver secrets status` lists them). Nothing was launched",
    secretName,
  }),
} as const;

/**
 * The producer an already-read profile declares under one name.
 *
 * @param profile the selected home's profile, `null` when that home has none
 * @param producer the name a row or `--producer` gave
 * @returns the declaration, or the refusal naming where to declare it
 */
export function metricsProducerFromProfile({
  profile,
  producer,
}: {
  readonly profile: Profile | null;
  readonly producer: string;
}): Result<MetricsProducerConfig, ProducerNotDeclaredError> {
  if (profile === null) {
    return err(MetricsProducerErrors.notDeclared({ producer }));
  }
  const declared = Object.hasOwn(profile.datadog.metricsProducers, producer)
    ? profile.datadog.metricsProducers[producer]
    : undefined;
  if (declared === undefined) {
    return err(MetricsProducerErrors.notDeclared({ producer }));
  }
  return ok(declared);
}

/**
 * The argv tail a producer is launched with: its declared command after the executable, then `--day`.
 *
 * @param config the declaration
 * @param day the UTC day, `YYYY-MM-DD`, the run computes
 * @returns the arguments handed to the executable, never through a shell
 */
export function producerArgs({
  config,
  day,
}: {
  readonly config: MetricsProducerConfig;
  readonly day: string;
}): readonly string[] {
  return [...config.command.slice(1), "--day", day];
}

/** Seconds in one UTC day: a producer's points must fall in `[midnight, midnight + this)` of the day it was asked for. */
const SECONDS_PER_DAY = 86_400;

/**
 * Read the series document off a producer's stdout: its last non-empty line, parsed alone, every point inside `day`.
 *
 * The day bound is what makes a firing honest: the `metrics-push` kind stamps the slot's UTC day as pushed, so a
 * producer that ignored `--day` and printed another day's points would otherwise stamp a day nobody computed.
 * Review found that hole. A registration point stamped `now` belongs to a one-off `datadog submit`,
 * never to a daily run.
 *
 * @param stdout everything the producer wrote to stdout
 * @param producer its name, for the refusal
 * @param day the UTC calendar day the producer was asked for, `YYYY-MM-DD`
 * @returns the series exactly as printed, or why there are none to submit
 */
export function parseMetricsProducerOutput({
  stdout,
  producer,
  day,
}: {
  readonly stdout: string;
  readonly producer: string;
  readonly day: string;
}): Result<readonly SubmittedSeries[], ProducerOutputInvalidError> {
  const dayStart = yyyyMmDdToEpochSeconds({ date: day });
  if (dayStart === undefined) {
    return err(MetricsProducerErrors.outputInvalid({ producer, why: `'${day}' is not a calendar day` }));
  }
  const last = stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
  if (last === undefined) {
    return err(MetricsProducerErrors.outputInvalid({ producer, why: "it printed nothing" }));
  }
  const parsed = parseSeriesPayload({ label: `producer '${producer}' stdout`, text: last });
  if (parsed.isErr()) {
    return err(MetricsProducerErrors.outputInvalid({ producer, why: parsed.error.message }));
  }
  const dayEnd = dayStart + SECONDS_PER_DAY;
  for (const series of parsed.value) {
    const outside = series.points.find(([stamp]) => stamp < dayStart || stamp >= dayEnd);
    if (outside !== undefined) {
      return err(
        MetricsProducerErrors.outputInvalid({
          producer,
          why: `${series.metric} has a point at epoch ${String(outside[0])}, outside ${day} UTC — it was asked for that day only`,
        }),
      );
    }
  }
  return ok(parsed.value);
}
