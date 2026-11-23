/**
 * What `slopweaver talk find-card` ACCEPTS — its flag spec, usage and pure parser. A file of its own for the reason
 * `./knowArgs.ts` gives: `./args.ts` already holds six verbs' worth.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";
import { type TalkPositionalArgsError, TalkPositionalArgsErrors } from "./positionalArgsErrors.js";

/** The flags `talk find-card` accepts; its words are positional. */
const FIND_CARD_FLAGS = { boolean: ["json"], string: ["home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_FIND_CARD_FLAG_NAMES: readonly string[] = flagNames({ spec: FIND_CARD_FLAGS });

/** A parsed `talk find-card` invocation. */
export interface FindCardArgs {
  /** What the card would be about, in the owner's words and any other ways of saying it. */
  readonly words: readonly string[];
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk find-card` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseFindCardArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<FindCardArgs, TalkPositionalArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: FIND_CARD_FLAGS });
  if (parsed.isErr()) {
    return err(TalkPositionalArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const words = parsed.value.positionals.map((word) => word.trim()).filter((word) => word.length > 0);
  if (words.length === 0) {
    return err(TalkPositionalArgsErrors.findCardWordsMissing());
  }
  return ok({
    home: stringOf({ value: parsed.value.values["home"] }),
    json: parsed.value.values["json"] === true,
    words,
  });
}
