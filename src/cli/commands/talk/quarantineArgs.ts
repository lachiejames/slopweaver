/**
 * What `slopweaver talk quarantine` ACCEPTS — its flag spec, its usage refusals and its pure parser. The call id and
 * the reason are checked again by the store (`src/talk/callQuarantine.ts`); refusing them here keeps a typo off the
 * locks entirely.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isCallId } from "../../../talk/callStore.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk quarantine` accepts. */
const QUARANTINE_FLAGS = { boolean: ["json"], string: ["reason", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_QUARANTINE_FLAG_NAMES: readonly string[] = flagNames({ spec: QUARANTINE_FLAGS });

/** A flag the tokenizer refused — unknown, or missing its value; the messages are the tokenizer's own. */
export interface QuarantineFlagsInvalidError {
  readonly code: "QUARANTINE_FLAGS_INVALID";
  readonly message: string;
}

/** Not exactly one call id: a quarantine accepts one loss, named. */
export interface QuarantineCallCountError {
  readonly code: "QUARANTINE_CALL_COUNT";
  readonly message: string;
  readonly given: number;
}

/** The one positional is not a call id. */
export interface QuarantineArgCallIdError {
  readonly code: "QUARANTINE_ARG_CALL_ID";
  readonly message: string;
  readonly callId: string;
}

/** `--reason` absent or blank. */
export interface QuarantineArgReasonError {
  readonly code: "QUARANTINE_ARG_REASON";
  readonly message: string;
}

/** Every way a `talk quarantine` invocation is refused before anything is read. */
export type QuarantineArgsError =
  QuarantineFlagsInvalidError | QuarantineCallCountError | QuarantineArgCallIdError | QuarantineArgReasonError;

/** The factories every `talk quarantine` usage refusal is constructed through. */
export const QuarantineArgsErrors = {
  callCount: ({ given }: { given: number }): QuarantineCallCountError => ({
    code: "QUARANTINE_CALL_COUNT",
    given,
    message: `talk quarantine takes exactly one call id, and was given ${String(given)}`,
  }),
  callId: ({ callId }: { callId: string }): QuarantineArgCallIdError => ({
    callId,
    code: "QUARANTINE_ARG_CALL_ID",
    message: `talk quarantine ${JSON.stringify(callId)} is not a call id (a v4 UUID)`,
  }),
  flagsInvalid: ({ messages }: { messages: readonly string[] }): QuarantineFlagsInvalidError => ({
    code: "QUARANTINE_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  reason: (): QuarantineArgReasonError => ({
    code: "QUARANTINE_ARG_REASON",
    message: "talk quarantine needs --reason: what removed the file, and whose words they were",
  }),
} as const;

/** A parsed `talk quarantine` invocation. */
export interface QuarantineArgs {
  /** The call whose file is gone. */
  readonly callId: string;
  /** What removed it, and whose words they were. */
  readonly reason: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk quarantine` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseQuarantineArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<QuarantineArgs, QuarantineArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: QUARANTINE_FLAGS });
  if (parsed.isErr()) {
    return err(QuarantineArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  const [callId] = positionals;
  if (positionals.length !== 1 || callId === undefined) {
    return err(QuarantineArgsErrors.callCount({ given: positionals.length }));
  }
  if (!isCallId({ callId })) {
    return err(QuarantineArgsErrors.callId({ callId }));
  }
  const reason = stringOf({ value: values["reason"] });
  if (reason === undefined || reason.trim() === "") {
    return err(QuarantineArgsErrors.reason());
  }
  return ok({ callId, home: stringOf({ value: values["home"] }), json: values["json"] === true, reason });
}
