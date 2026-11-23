/**
 * What `talk capabilities` ACCEPTS — an optional noun, an optional verb of it, and `--json` — and its pure parser.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames } from "./flagValues.js";
import { type TalkPositionalArgsError, TalkPositionalArgsErrors } from "./positionalArgsErrors.js";

/** The flags `talk capabilities` accepts. */
const CAPABILITIES_FLAGS = { boolean: ["json"], string: [] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CAPABILITIES_FLAG_NAMES: readonly string[] = flagNames({ spec: CAPABILITIES_FLAGS });

/** A parsed `talk capabilities` invocation. */
export interface CapabilitiesArgs {
  readonly noun: string | undefined;
  readonly verb: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk capabilities` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCapabilitiesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CapabilitiesArgs, TalkPositionalArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: CAPABILITIES_FLAGS });
  if (parsed.isErr()) {
    return err(TalkPositionalArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length > 2) {
    return err(TalkPositionalArgsErrors.tooManyCapabilityWords({ got: positionals.length }));
  }
  const [noun, verb] = positionals;
  return ok({ json: values["json"] === true, noun, verb });
}
