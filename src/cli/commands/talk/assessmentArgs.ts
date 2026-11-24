/**
 * What `slopweaver talk assessment-due` and `talk assessment-record` accept — their flag specs, the names the
 * help-truth ratchet reads, and the pure parsers. The usage lines are in `./assessmentUsage.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk assessment-due` accepts. */
const DUE_FLAGS = { boolean: ["check", "json"], string: ["now", "home"] } satisfies FlagSpec;

/** The flags `talk assessment-record` accepts. */
const RECORD_FLAGS = {
  boolean: ["json"],
  string: ["call", "request", "verdicts-file", "now", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_ASSESSMENT_DUE_FLAG_NAMES: readonly string[] = flagNames({ spec: DUE_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_ASSESSMENT_RECORD_FLAG_NAMES: readonly string[] = flagNames({ spec: RECORD_FLAGS });

/** A request digest as `talk assessment-due` prints it. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** A flag the tokenizer refused — unknown, or missing its value. */
interface AssessmentFlagsInvalidError {
  readonly code: "ASSESSMENT_FLAGS_INVALID";
  readonly message: string;
}

/** `--now` that is not an instant. */
interface AssessmentNowInvalidError {
  readonly code: "ASSESSMENT_NOW_INVALID";
  readonly message: string;
}

/** A required flag is absent, or holds a value of the wrong shape. */
interface AssessmentFlagMissingError {
  readonly code: "ASSESSMENT_FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** Every way either verb's invocation is refused before anything is read. */
export type AssessmentArgsError = AssessmentFlagsInvalidError | AssessmentNowInvalidError | AssessmentFlagMissingError;

/** The factories every refusal here is built through. */
const AssessmentArgsErrors = {
  flagMissing: ({ flag, shape }: { flag: string; shape: string }): AssessmentFlagMissingError => ({
    code: "ASSESSMENT_FLAG_MISSING",
    flag,
    message: `--${flag} is required: ${shape}`,
  }),
  flagsInvalid: ({ messages }: { messages: readonly string[] }): AssessmentFlagsInvalidError => ({
    code: "ASSESSMENT_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  nowInvalid: ({ now }: { now: string }): AssessmentNowInvalidError => ({
    code: "ASSESSMENT_NOW_INVALID",
    message: `--now ${now} is not an ISO instant, such as 2026-10-08T23:00:00Z`,
  }),
} as const;

/** A parsed `talk assessment-due` invocation. */
export interface AssessmentDueArgs {
  /** Settle mode: exit deferred while anything is due, so the automation's firing is not stamped. */
  readonly check: boolean;
  readonly nowMs: number | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk assessment-record` invocation. */
export interface AssessmentRecordArgs {
  readonly callId: string;
  readonly requestSha256: string;
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
function nowOf({ now }: { now: string | undefined }): Result<number | undefined, AssessmentArgsError> {
  if (now === undefined) {
    return ok(undefined);
  }
  const nowMs = parseStrictIsoInstantMs({ text: now });
  if (nowMs === undefined) {
    return err(AssessmentArgsErrors.nowInvalid({ now }));
  }
  return ok(nowMs);
}

/**
 * Parse a `talk assessment-due` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the refusal
 */
export function parseAssessmentDueArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AssessmentDueArgs, AssessmentArgsError> {
  const parsed = parseFlags({ args: rest, spec: DUE_FLAGS });
  if (parsed.isErr()) {
    return err(AssessmentArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  return nowOf({ now: stringOf({ value: values["now"] }) }).map((nowMs) => ({
    check: values["check"] === true,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    nowMs,
  }));
}

/**
 * Parse a `talk assessment-record` invocation; `--call`, `--request` and `--verdicts-file` are required.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the refusal
 */
export function parseAssessmentRecordArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AssessmentRecordArgs, AssessmentArgsError> {
  const parsed = parseFlags({ args: rest, spec: RECORD_FLAGS });
  if (parsed.isErr()) {
    return err(AssessmentArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const callId = stringOf({ value: values["call"] });
  if (callId === undefined) {
    return err(AssessmentArgsErrors.flagMissing({ flag: "call", shape: "the call id `talk assessment-due` printed" }));
  }
  const requestSha256 = stringOf({ value: values["request"] });
  if (requestSha256 === undefined || !SHA256_HEX.test(requestSha256)) {
    return err(
      AssessmentArgsErrors.flagMissing({
        flag: "request",
        shape: "the 64-hex request digest `talk assessment-due` printed",
      }),
    );
  }
  const verdictsFile = stringOf({ value: values["verdicts-file"] });
  if (verdictsFile === undefined) {
    return err(
      AssessmentArgsErrors.flagMissing({ flag: "verdicts-file", shape: "a JSON file of one verdict per passage" }),
    );
  }
  return nowOf({ now: stringOf({ value: values["now"] }) }).map((nowMs) => ({
    callId,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    nowMs,
    requestSha256,
    verdictsFile,
  }));
}
