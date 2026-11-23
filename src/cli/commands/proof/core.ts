/**
 * The `proof` noun's flag spec and usage string.
 *
 * The spec is exported so the help-truth ratchet compares the manifest's literal usage line against the
 * REAL parser, not against a copy of it — see `cmux/core.ts` for the sibling this mirrors.
 */
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

const YARN_WHY_SPEC: FlagSpec = {
  string: ["dep", "before", "after", "before-label", "after-label", "out"],
};

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const PROOF_YARN_WHY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: YARN_WHY_SPEC }),
  ...booleanFlagsOf({ spec: YARN_WHY_SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The `yarn-why` verb's usage line. */
export const PROOF_YARN_WHY_USAGE =
  "usage: slopweaver proof yarn-why --dep <name> --before <path> --after <path> --out <path> " +
  "[--before-label <text>] [--after-label <text>]";

const CASSETTE_SPEC: FlagSpec = {
  string: ["tape", "out", "cwd"],
};

/** `--`-prefixed flag names of the `cassette` verb, for the help-truth ratchet. */
export const PROOF_CASSETTE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: CASSETTE_SPEC }),
  ...booleanFlagsOf({ spec: CASSETTE_SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The `cassette` verb's usage line. */
export const PROOF_CASSETTE_USAGE = "usage: slopweaver proof cassette --tape <path> --out <path.mp4> [--cwd <dir>]";

/**
 * Parse `cassette`'s flags.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseProofCassetteArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CASSETTE_SPEC });
}

/**
 * Parse `yarn-why`'s flags.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseProofYarnWhyArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: YARN_WHY_SPEC });
}

/**
 * One declared string flag, or `undefined`.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the value, or `undefined` when the flag was not passed
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}
