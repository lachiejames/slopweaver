/**
 * What `slopweaver talk call-thread` and `talk call-thread-append` ACCEPT — their flag specs, usage refusals and pure
 * parsers. The read's page bound is checked here, so a read asking past `CALL_THREAD_LIMIT_MAX` is refused rather than
 * quietly cut.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isCallId } from "../../../talk/callId.js";
import { CALL_THREAD_LIMIT_DEFAULT, CALL_THREAD_LIMIT_MAX } from "../../../talk/callThreadPage.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import {
  CONSOLE_INSTANCE_FLAG,
  CONSOLE_ORIGIN_FLAGS,
  type ConsoleOriginArgs,
  consoleOriginWithInstanceOf,
} from "./consoleOriginArgs.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk call-thread` accepts. */
const CALL_THREAD_FLAGS = { boolean: ["json"], string: ["call", "from", "limit", "home"] } satisfies FlagSpec;

/** The flags `talk call-thread-append` accepts. */
const CALL_THREAD_APPEND_FLAGS = {
  boolean: ["json"],
  string: ["call", "entries-file", "home", ...CONSOLE_ORIGIN_FLAGS, CONSOLE_INSTANCE_FLAG],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CALL_THREAD_FLAG_NAMES: readonly string[] = flagNames({ spec: CALL_THREAD_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CALL_THREAD_APPEND_FLAG_NAMES: readonly string[] = flagNames({ spec: CALL_THREAD_APPEND_FLAGS });

/** A flag the tokenizer refused, or a positional given; the messages are the tokenizer's own. */
interface CallThreadFlagsInvalidError {
  readonly code: "CALL_THREAD_FLAGS_INVALID";
  readonly message: string;
}

/** `--call` absent, or not a call id. */
interface CallThreadArgCallError {
  readonly code: "CALL_THREAD_ARG_CALL";
  readonly message: string;
}

/** A bound out of range, a missing `--entries-file`, or a bad console-origin group. */
interface CallThreadArgProblemsError {
  readonly code: "CALL_THREAD_ARG_PROBLEMS";
  readonly message: string;
}

/** Every way a `talk call-thread` or `talk call-thread-append` invocation is refused before anything is read. */
export type CallThreadArgsError = CallThreadFlagsInvalidError | CallThreadArgCallError | CallThreadArgProblemsError;

/** The factories every usage refusal of the two verbs is constructed through. */
const CallThreadArgsErrors = {
  call: ({ verb, given }: { verb: string; given: string | undefined }): CallThreadArgCallError => {
    if (given === undefined) {
      return { code: "CALL_THREAD_ARG_CALL", message: `talk ${verb} needs --call <uuid>: the call whose thread it is` };
    }
    return {
      code: "CALL_THREAD_ARG_CALL",
      message: `talk ${verb} --call ${JSON.stringify(given)} is not a call id (a v4 UUID)`,
    };
  },
  flagsInvalid: ({ messages }: { messages: readonly string[] }): CallThreadFlagsInvalidError => ({
    code: "CALL_THREAD_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  problems: ({ verb, problems }: { verb: string; problems: readonly string[] }): CallThreadArgProblemsError => ({
    code: "CALL_THREAD_ARG_PROBLEMS",
    message: `talk ${verb}: ${problems.join("; ")}`,
  }),
} as const;

/** A parsed `talk call-thread` invocation. */
export interface CallThreadArgs {
  readonly callId: string;
  /** The first entry's zero-based index. */
  readonly from: number;
  /** How many entries at most, 1 to `CALL_THREAD_LIMIT_MAX`. */
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk call-thread-append` invocation. */
export interface CallThreadAppendArgs {
  readonly callId: string;
  /** The batch's path, or `-` for stdin — how the console sends it, so its raw entries never touch disk. */
  readonly entriesFile: string;
  /**
   * Where the console server that ran it is serving from, marked `instance: "e2e"` when the desktop test instance's call
   * wrote the batch (`--console-instance e2e`); `undefined` for a hand run (`./consoleOrigin.ts`).
   */
  readonly consoleOrigin: ConsoleOriginArgs | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk call-thread` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseCallThreadArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CallThreadArgs, CallThreadArgsError> {
  const parsed = parseFlags({ args: rest, spec: CALL_THREAD_FLAGS });
  if (parsed.isErr()) {
    return err(CallThreadArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const callId = stringOf({ value: values["call"] });
  if (callId === undefined || !isCallId({ callId })) {
    return err(CallThreadArgsErrors.call({ given: callId, verb: "call-thread" }));
  }
  const problems: string[] = [];
  const from = numberOf({ fallback: 0, name: "--from", problems, value: values["from"] });
  const limit = numberOf({ fallback: CALL_THREAD_LIMIT_DEFAULT, name: "--limit", problems, value: values["limit"] });
  if (limit < 1 || limit > CALL_THREAD_LIMIT_MAX) {
    problems.push(`--limit must be 1 to ${String(CALL_THREAD_LIMIT_MAX)}, got ${String(limit)}`);
  }
  if (problems.length > 0) {
    return err(CallThreadArgsErrors.problems({ problems, verb: "call-thread" }));
  }
  return ok({ callId, from, home: stringOf({ value: values["home"] }), json: values["json"] === true, limit });
}

/**
 * Parse a `talk call-thread-append` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseCallThreadAppendArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CallThreadAppendArgs, CallThreadArgsError> {
  const parsed = parseFlags({ args: rest, spec: CALL_THREAD_APPEND_FLAGS });
  if (parsed.isErr()) {
    return err(CallThreadArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const callId = stringOf({ value: values["call"] });
  if (callId === undefined || !isCallId({ callId })) {
    return err(CallThreadArgsErrors.call({ given: callId, verb: "call-thread-append" }));
  }
  const problems: string[] = [];
  const entriesFile = stringOf({ value: values["entries-file"] });
  if (entriesFile === undefined) {
    problems.push("--entries-file <jsonl|-> is required: the batch of entries to append, or - to read it from stdin");
  }
  const consoleOrigin = consoleOriginWithInstanceOf({ problems, values });
  if (entriesFile === undefined || problems.length > 0) {
    return err(CallThreadArgsErrors.problems({ problems, verb: "call-thread-append" }));
  }
  return ok({
    callId,
    consoleOrigin,
    entriesFile,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
  });
}
