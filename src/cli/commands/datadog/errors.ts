/**
 * The typed failures of parsing one `datadog` verb's argv tail, before any credential, clock or network is
 * touched.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The flag
 * tokeniser's refusals and a verb's own collected problems are not re-authored here: each arrives as the
 * string list it already was and rides as `reasons`, and its `message` puts one reason per line — so a
 * caller printing `message` writes exactly the lines the list used to print.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface DatadogFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The verb's own checks found one or more problems at once; `reasons` names each, in the order found. */
export interface DatadogOptionsRefusedError {
  readonly code: "OPTIONS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface DatadogInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A required flag was not given, or was given blank. */
export interface DatadogFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A verb that dispatches on a sub-verb was given none. */
export interface DatadogSubVerbMissingError {
  readonly code: "SUB_VERB_MISSING";
  readonly message: string;
  /** The verb whose sub-verb is missing. */
  readonly verb: string;
}

/** A verb that dispatches on a sub-verb was given one it does not have. */
export interface DatadogSubVerbUnknownError {
  readonly code: "SUB_VERB_UNKNOWN";
  readonly message: string;
  readonly verb: string;
  readonly got: string;
}

/** A check the parser already made came out the other way — a defect in the parser, never the caller's input. */
export interface DatadogInvariantBrokenError {
  readonly code: "INVARIANT_BROKEN";
  readonly message: string;
  /** Which invariant broke, in the words of the check that should have held it. */
  readonly detail: string;
}

/** Every way parsing one `datadog` verb's argv tail can fail. */
export type DatadogArgsError =
  | DatadogFlagsInvalidError
  | DatadogOptionsRefusedError
  | DatadogInvalidFlagValueError
  | DatadogFlagMissingError
  | DatadogSubVerbMissingError
  | DatadogSubVerbUnknownError
  | DatadogInvariantBrokenError;

/** `datadog produce` ran the producer but could not write its payload file; `out` is the path and `cause` the throw. */
export interface DatadogProducePayloadWriteError {
  readonly code: "PAYLOAD_WRITE_FAILED";
  readonly message: string;
  readonly out: string;
  readonly cause: unknown;
}

/** Every way the effectful half of `datadog produce` can fail on its own account. */
export type DatadogProduceError = DatadogProducePayloadWriteError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogArgsErrors = {
  alertDigestLabelMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--label",
    message: "--label is required: the card's subject, which prefixes its TL;DR",
  }),
  alertDigestLabelTooLong: ({ label, max }: { label: string; max: number }): DatadogInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--label",
    got: label,
    message:
      `--label is ${String(label.length)} characters and the card's subject is capped at ` +
      `${String(max)} — it prefixes the TL;DR, which has its own width to fit`,
  }),
  alertDigestOutputModesConflict: (): DatadogOptionsRefusedError => {
    const reasons = [
      "pass --form or --json, not both: --form emits the digest form ALONE for piping, --json contains it",
    ];
    return { code: "OPTIONS_REFUSED", message: reasons.join("\n"), reasons };
  },
  alertDigestProbesMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--probes",
    message: "--probes is required: the declared probe set, as a JSON document, a path to one, or - for stdin",
  }),
  alertDigestWindowTooLong: ({ window, max }: { window: string; max: number }): DatadogInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--window",
    got: window,
    message:
      `--window is ${String(window.length)} characters and the card's window label is capped at ` +
      `${String(max)} — write it as a duration (90m, 24h, 7d, 2w)`,
  }),
  catalogueModeMissing: (): DatadogSubVerbMissingError => ({
    code: "SUB_VERB_MISSING",
    message: 'datadog catalogue: expected "build" or "show", got nothing',
    verb: "catalogue",
  }),
  catalogueModeUnknown: ({ got }: { got: string }): DatadogSubVerbUnknownError => ({
    code: "SUB_VERB_UNKNOWN",
    got,
    message: `datadog catalogue: expected "build" or "show", got "${got}"`,
    verb: "catalogue",
  }),
  dayAfterToday: ({ day, todayUtc }: { day: string; todayUtc: string }): DatadogInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--day",
    got: day,
    message: `--day ${day} is after today (${todayUtc} UTC)`,
  }),
  dayMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--day",
    message: "--day is required: the UTC day, YYYY-MM-DD, the producer computes",
  }),
  dayNotACalendarDay: ({ day }: { day: string }): DatadogInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--day",
    got: day,
    message: `--day must be a UTC day as YYYY-MM-DD, got ${day}`,
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): DatadogFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("\n"),
    reasons,
  }),
  invariantBroken: ({ detail }: { detail: string }): DatadogInvariantBrokenError => ({
    code: "INVARIANT_BROKEN",
    detail,
    message: `unreachable: ${detail}`,
  }),
  metricMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--metric",
    message: "--metric is required: one or more metric names, comma-separated or repeated",
  }),
  monitorSubVerbMissing: (): DatadogSubVerbMissingError => ({
    code: "SUB_VERB_MISSING",
    message: 'datadog monitor: expected "show", "update" or "delete", got nothing',
    verb: "monitor",
  }),
  monitorSubVerbUnknown: ({ got }: { got: string }): DatadogSubVerbUnknownError => ({
    code: "SUB_VERB_UNKNOWN",
    got,
    message: `datadog monitor: expected "show", "update" or "delete", got "${got}"`,
    verb: "monitor",
  }),
  notAWholeNumber: ({ flag, got }: { flag: string; got: string }): DatadogInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got,
    message: `${flag} must be a whole number of at least 1, not "${got}"`,
  }),
  optionsRefused: ({ reasons }: { reasons: readonly string[] }): DatadogOptionsRefusedError => ({
    code: "OPTIONS_REFUSED",
    message: reasons.join("\n"),
    reasons,
  }),
  outMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--out",
    message: '--out is required: where the { "series": [...] } payload is written',
  }),
  producerMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--producer",
    message: "--producer is required: a name declared under profile.json datadog.metricsProducers",
  }),
  seriesMissing: (): DatadogFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--series",
    message: '--series is required: the path to a { "series": [...] } payload file, or - for stdin',
  }),
  shotSubVerbMissing: (): DatadogSubVerbMissingError => ({
    code: "SUB_VERB_MISSING",
    message: "a sub-verb is required: monitor, explorer or file",
    verb: "shot",
  }),
  shotSubVerbUnknown: ({
    got,
    expected,
  }: {
    got: string;
    expected: readonly string[];
  }): DatadogSubVerbUnknownError => ({
    code: "SUB_VERB_UNKNOWN",
    got,
    message: `'${got}' is not a shot sub-verb — expected one of: ${expected.join(", ")}`,
    verb: "shot",
  }),
} as const;

/** How to raise a `datadog produce` effect failure. */
export const DatadogProduceErrors = {
  payloadWriteFailed: ({ out, cause }: { out: string; cause: unknown }): DatadogProducePayloadWriteError => ({
    cause,
    code: "PAYLOAD_WRITE_FAILED",
    message: `could not write ${out} — ${errorMessage({ error: cause })}`,
    out,
  }),
} as const;

/**
 * The line a `datadog produce` effect failure prints: its one message.
 *
 * @returns the lines, in order
 */
export function datadogProduceErrorLines({ error }: { error: DatadogProduceError }): readonly string[] {
  return [error.message];
}

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * the tokeniser's or the verb's own list as that list, and every other failure as its one message.
 * `message` stays the joined form, for a caller that displays one.
 *
 * @returns the lines, in order
 */
export function datadogArgsErrorLines({ error }: { error: DatadogArgsError }): readonly string[] {
  if (error.code === "FLAGS_INVALID" || error.code === "OPTIONS_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
