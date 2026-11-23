/**
 * What `slopweaver talk call-tools` ACCEPTS — its flag spec, its usage refusals and its pure parser. The page bound is
 * checked here, so a read asking for more than `CALL_TOOLS_LIMIT_MAX` rows is refused rather than quietly cut.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isCallId } from "../../../talk/callStore.js";
import { CALL_TOOLS_LIMIT_DEFAULT, CALL_TOOLS_LIMIT_MAX } from "../../../talk/callTools.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk call-tools` accepts. */
const CALL_TOOLS_FLAGS = { boolean: ["json"], string: ["call", "from", "limit", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CALL_TOOLS_FLAG_NAMES: readonly string[] = flagNames({ spec: CALL_TOOLS_FLAGS });

/** A flag the tokenizer refused, or a positional given; the messages are the tokenizer's own. */
interface CallToolsFlagsInvalidError {
  readonly code: "CALL_TOOLS_FLAGS_INVALID";
  readonly message: string;
}

/** `--call` absent, or not a call id. */
interface CallToolsArgCallError {
  readonly code: "CALL_TOOLS_ARG_CALL";
  readonly message: string;
}

/** `--from` or `--limit` not a whole number in its range. */
interface CallToolsArgBoundError {
  readonly code: "CALL_TOOLS_ARG_BOUND";
  readonly message: string;
}

/** Every way a `talk call-tools` invocation is refused before anything is read. */
export type CallToolsArgsError = CallToolsFlagsInvalidError | CallToolsArgCallError | CallToolsArgBoundError;

/** The factories every `talk call-tools` usage refusal is constructed through. */
const CallToolsArgsErrors = {
  bound: ({ problems }: { problems: readonly string[] }): CallToolsArgBoundError => ({
    code: "CALL_TOOLS_ARG_BOUND",
    message: `talk call-tools: ${problems.join("; ")}`,
  }),
  call: ({ given }: { given: string | undefined }): CallToolsArgCallError => {
    if (given === undefined) {
      return { code: "CALL_TOOLS_ARG_CALL", message: "talk call-tools needs --call <uuid>: the call to read" };
    }
    return {
      code: "CALL_TOOLS_ARG_CALL",
      message: `talk call-tools --call ${JSON.stringify(given)} is not a call id (a v4 UUID)`,
    };
  },
  flagsInvalid: ({ messages }: { messages: readonly string[] }): CallToolsFlagsInvalidError => ({
    code: "CALL_TOOLS_FLAGS_INVALID",
    message: messages.join("; "),
  }),
} as const;

/** A parsed `talk call-tools` invocation. */
export interface CallToolsArgs {
  readonly callId: string;
  /** The first row's zero-based index. */
  readonly from: number;
  /** How many rows at most, 1 to `CALL_TOOLS_LIMIT_MAX`. */
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk call-tools` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseCallToolsArgs({ rest }: { rest: readonly string[] }): Result<CallToolsArgs, CallToolsArgsError> {
  const parsed = parseFlags({ args: rest, spec: CALL_TOOLS_FLAGS });
  if (parsed.isErr()) {
    return err(CallToolsArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const callId = stringOf({ value: values["call"] });
  if (callId === undefined || !isCallId({ callId })) {
    return err(CallToolsArgsErrors.call({ given: callId }));
  }
  const problems: string[] = [];
  const from = numberOf({ fallback: 0, name: "--from", problems, value: values["from"] });
  const limit = numberOf({ fallback: CALL_TOOLS_LIMIT_DEFAULT, name: "--limit", problems, value: values["limit"] });
  if (limit < 1 || limit > CALL_TOOLS_LIMIT_MAX) {
    problems.push(`--limit must be 1 to ${String(CALL_TOOLS_LIMIT_MAX)}, got ${String(limit)}`);
  }
  if (problems.length > 0) {
    return err(CallToolsArgsErrors.bound({ problems }));
  }
  return ok({ callId, from, home: stringOf({ value: values["home"] }), json: values["json"] === true, limit });
}
