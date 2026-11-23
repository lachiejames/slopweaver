/**
 * `hand line-retire`'s flag spec and parse. Pure: no I/O, no clock. Apart from the verb module so the help-truth
 * ratchet can read the flag list without importing the command.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

const BOOLEAN_FLAGS = ["json", "apply"];
const STRING_FLAGS = ["source-sha256", "reason", "home"];
const LINE_RETIRE_FLAGS: FlagSpec = { boolean: BOOLEAN_FLAGS, string: STRING_FLAGS };

/** `--`-prefixed line-retire flags. */
export const HAND_LINE_RETIRE_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `hand line-retire`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandLineRetireArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LINE_RETIRE_FLAGS });
}
