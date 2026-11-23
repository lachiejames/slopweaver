/**
 * Flag specs, usage text and the shared parse for the `value` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the two verb modules so the help-truth ratchet can read a flag list without importing a command,
 * exactly as `../reading/core.ts` does.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `value`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const SAMPLE_FLAGS: FlagSpec = {
  boolean: [],
  string: ["home", "projects-dir"],
};

const ANSWER_FLAGS: FlagSpec = {
  boolean: [],
  string: ["week", "slug", "answer", "home"],
};

/** `--`-prefixed flags, for the help-truth ratchet. */
function names({ spec: { string: strings = [], boolean: booleans = [] } }: { spec: FlagSpec }): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

export const VALUE_SAMPLE_FLAG_NAMES: readonly string[] = names({ spec: SAMPLE_FLAGS });
export const VALUE_ANSWER_FLAG_NAMES: readonly string[] = names({ spec: ANSWER_FLAGS });

export const SAMPLE_USAGE =
  "usage: slopweaver value sample [--projects-dir <dir>] [--home <dir>]\n" +
  "  Draw this week's value sample: five asks that ended filed or answered in the last seven days, picked at\n" +
  "  random seeded by the ISO week, each with its model-weighted cost and its outcome. Keeps the sample under\n" +
  "  ledgers/value-samples/<week>.json, publishes its page and places ONE Queue card asking whether each ask\n" +
  "  was used. A re-run in the same week shows the kept sample again and places no second card. Exits 3 when\n" +
  "  no ask ended in the window.\n" +
  "  --projects-dir <dir>  the transcript corpus costs are read from (default ~/.claude/projects)\n" +
  "\n" +
  "example: slopweaver value sample";

export const ANSWER_USAGE =
  "usage: slopweaver value answer --slug <ask slug> --answer <used|not-used|not-yet> [--week <YYYY-Www>]\n" +
  "                               [--home <dir>]\n" +
  "  Record the owner's answer for one sampled ask. The same answer again is a no-op; a different one is\n" +
  "  refused, never replacing the first. Once every ask in the week carries an answer, the week's card is\n" +
  "  withdrawn. --week defaults to the current one.\n" +
  "\n" +
  "example: slopweaver value answer --slug acme-export-row --answer used";

/**
 * Parse `value sample`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseValueSampleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: SAMPLE_FLAGS });
}

/**
 * Parse `value answer`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseValueAnswerArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: ANSWER_FLAGS });
}

/**
 * A flag's value, or undefined when it was not supplied.
 *
 * @param values the parsed flag values
 * @param name the flag, without its `--`
 * @returns the string, or `undefined`
 */
export function flag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}
