/**
 * What `slopweaver store assessment-due` and `store assessment-record` accept — their flag specs, the names the
 * help-truth ratchet reads, and the pure parsers. The usage lines are in `./assessmentUsage.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { STORED_ROW_ASSESSMENT_DAILY_LIMIT } from "../../../store/storedRowAssessment.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "../talk/flagValues.js";

/** The flags `store assessment-due` accepts. */
const DUE_FLAGS = { boolean: ["check", "json", "with-calls"], string: ["home", "limit", "now"] } satisfies FlagSpec;

/** The flags `store assessment-record` accepts. */
const RECORD_FLAGS = { boolean: ["json"], string: ["home", "now", "verdicts-file"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const STORE_ASSESSMENT_DUE_FLAG_NAMES: readonly string[] = flagNames({ spec: DUE_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const STORE_ASSESSMENT_RECORD_FLAG_NAMES: readonly string[] = flagNames({ spec: RECORD_FLAGS });

/**
 * The largest day's slice a caller may ask for: the daily limit itself. `--limit` only ever NARROWS the slice, so no
 * argv can let `--check` keep deferring once the day's verdicts reach the limit.
 */
const MAX_LIMIT = STORED_ROW_ASSESSMENT_DAILY_LIMIT;

/** A flag the tokenizer refused, or a value of the wrong shape. */
export interface StoreAssessmentArgsError {
  readonly code: "STORE_ASSESSMENT_ARGS_INVALID";
  readonly message: string;
}

/**
 * The one refusal factory.
 *
 * @param message what was wrong
 * @returns the refusal
 */
function invalid({ message }: { message: string }): StoreAssessmentArgsError {
  return { code: "STORE_ASSESSMENT_ARGS_INVALID", message };
}

/** A parsed `store assessment-due` invocation. */
export interface StoreAssessmentDueArgs {
  /** Settle mode: counts only, and exit deferred while the day's slice still has a row due. */
  readonly check: boolean;
  /** Also defer while a call is due, so one daily row settles both halves. */
  readonly withCalls: boolean;
  readonly limit: number;
  readonly nowMs: number | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `store assessment-record` invocation. */
export interface StoreAssessmentRecordArgs {
  readonly verdictsFile: string;
  readonly nowMs: number | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * `--now` judged, when given.
 *
 * @param now the flag's value, when passed
 * @returns the instant in ms, `undefined` when not passed, or the refusal
 */
function nowOf({ now }: { now: string | undefined }): Result<number | undefined, StoreAssessmentArgsError> {
  if (now === undefined) {
    return ok(undefined);
  }
  const nowMs = parseStrictIsoInstantMs({ text: now });
  if (nowMs === undefined) {
    return err(invalid({ message: `--now ${now} is not an ISO instant, such as 2026-10-08T23:00:00Z` }));
  }
  return ok(nowMs);
}

/**
 * `--limit` judged: the day's capacity, {@link STORED_ROW_ASSESSMENT_DAILY_LIMIT} when absent.
 *
 * @param raw the flag's value, when passed
 * @returns the capacity, or the refusal
 */
function limitOf({ raw }: { raw: string | undefined }): Result<number, StoreAssessmentArgsError> {
  if (raw === undefined) {
    return ok(STORED_ROW_ASSESSMENT_DAILY_LIMIT);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return err(invalid({ message: `--limit is a whole number from 1 to ${String(MAX_LIMIT)}, not ${raw}` }));
  }
  return ok(value);
}

/**
 * Parse a `store assessment-due` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the refusal
 */
export function parseStoreAssessmentDueArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreAssessmentDueArgs, StoreAssessmentArgsError> {
  const parsed = parseFlags({ args: rest, spec: DUE_FLAGS });
  if (parsed.isErr()) {
    return err(invalid({ message: parsed.error.join("; ") }));
  }
  const { values } = parsed.value;
  const limit = limitOf({ raw: stringOf({ value: values["limit"] }) });
  if (limit.isErr()) {
    return err(limit.error);
  }
  return nowOf({ now: stringOf({ value: values["now"] }) }).map((nowMs) => ({
    check: values["check"] === true,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    limit: limit.value,
    nowMs,
    withCalls: values["with-calls"] === true,
  }));
}

/**
 * Parse a `store assessment-record` invocation; `--verdicts-file` is required.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the refusal
 */
export function parseStoreAssessmentRecordArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreAssessmentRecordArgs, StoreAssessmentArgsError> {
  const parsed = parseFlags({ args: rest, spec: RECORD_FLAGS });
  if (parsed.isErr()) {
    return err(invalid({ message: parsed.error.join("; ") }));
  }
  const { values } = parsed.value;
  const verdictsFile = stringOf({ value: values["verdicts-file"] });
  if (verdictsFile === undefined) {
    return err(invalid({ message: "--verdicts-file is required: a JSON file of one verdict per row" }));
  }
  return nowOf({ now: stringOf({ value: values["now"] }) }).map((nowMs) => ({
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    nowMs,
    verdictsFile,
  }));
}
