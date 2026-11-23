/**
 * The PURE core of `slopweaver datadog produce`: its flags, and the lines a run prints. No fs, no clock, no
 * launch — `./produceRun.ts` reads the profile, runs the producer and writes the payload, and hands today in.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** `datadog produce`'s resolved options. */
export interface DatadogProduceOptions {
  /** The declared producer's name, a key of `profile.json` `datadog.metricsProducers`. */
  readonly producer: string;
  /** The UTC day the producer computes, `YYYY-MM-DD`, handed to it as `--day`. */
  readonly day: string;
  /** Where the `{ "series": [...] }` payload is written. */
  readonly out: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * `datadog produce`'s flag spec.
 *
 * @internal the spec itself stays in this file; {@link DATADOG_PRODUCE_FLAG_NAMES} is what the ratchet reads.
 */
export const DATADOG_PRODUCE_FLAG_SPEC = {
  boolean: ["json"],
  value: ["producer", "day", "out", "home"],
} as const;

/** {@link DATADOG_PRODUCE_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_PRODUCE_FLAG_NAMES: readonly string[] = [
  ...DATADOG_PRODUCE_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_PRODUCE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `day` is a `YYYY-MM-DD` naming a real calendar day — `1999-02-30` is not one. */
function isCalendarDay({ day }: { readonly day: string }): boolean {
  return UTC_DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** A required value flag, trimmed, or the typed error saying it is missing. */
function requiredValue({
  value,
  missing,
}: {
  readonly value: string | undefined;
  readonly missing: DatadogArgsError;
}): Result<string, DatadogArgsError> {
  if (value === undefined || value.trim() === "") {
    return err(missing);
  }
  return ok(value.trim());
}

/** `--day`, checked against the calendar and against today: a producer is never asked for a day not yet over. */
function dayFrom({
  value,
  todayUtc,
}: {
  readonly value: string | undefined;
  readonly todayUtc: string;
}): Result<string, DatadogArgsError> {
  const day = requiredValue({ missing: DatadogArgsErrors.dayMissing(), value });
  if (day.isErr()) {
    return day;
  }
  if (!isCalendarDay({ day: day.value })) {
    return err(DatadogArgsErrors.dayNotACalendarDay({ day: day.value }));
  }
  if (day.value > todayUtc) {
    return err(DatadogArgsErrors.dayAfterToday({ day: day.value, todayUtc }));
  }
  return day;
}

/**
 * Parse `datadog produce`'s flags. Every rejection is collected, so three mistakes read as three lines once.
 *
 * @param rest the argv tail
 * @param todayUtc today's UTC day, `YYYY-MM-DD`, which `--day` may not be after
 * @returns the validated options, or every rejection
 */
export function parseDatadogProduceOptions({
  rest,
  todayUtc,
}: {
  readonly rest: readonly string[];
  readonly todayUtc: string;
}): Result<DatadogProduceOptions, DatadogArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: [...DATADOG_PRODUCE_FLAG_SPEC.boolean], value: [...DATADOG_PRODUCE_FLAG_SPEC.value] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const producer = requiredValue({ missing: DatadogArgsErrors.producerMissing(), value: values["producer"] });
  const day = dayFrom({ todayUtc, value: values["day"] });
  const out = requiredValue({ missing: DatadogArgsErrors.outMissing(), value: values["out"] });
  if (producer.isErr() || day.isErr() || out.isErr()) {
    const reasons: string[] = [];
    for (const checked of [producer, day, out]) {
      if (checked.isErr()) {
        reasons.push(checked.error.message);
      }
    }
    return err(DatadogArgsErrors.optionsRefused({ reasons }));
  }
  return ok({
    day: day.value,
    home: values["home"],
    json: flags.has("json"),
    out: out.value,
    producer: producer.value,
  });
}

/** What one run wrote. */
export interface DatadogProduceReport {
  readonly producer: string;
  readonly day: string;
  readonly out: string;
  readonly seriesCount: number;
  readonly pointCount: number;
}

/**
 * The human view of what a run wrote, ending on the command that checks it before anything is sent.
 *
 * @param report what the run wrote
 * @returns the lines to print
 */
export function produceReportLines({ report }: { readonly report: DatadogProduceReport }): readonly string[] {
  return [
    `datadog produce: producer '${report.producer}' for ${report.day} wrote ` +
      `${String(report.seriesCount)} series / ${String(report.pointCount)} point(s) to ${report.out}`,
    `  next: slopweaver datadog submit --series ${report.out} --allow-late --dry-run`,
  ];
}
