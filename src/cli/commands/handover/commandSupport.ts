/**
 * The four pieces both `handover list` and `handover check` need, and neither owns.
 *
 * Split out of `./run.ts` under the file-size ratchet: that file carried two whole verbs
 * and 559 code lines, and this is the piece a split has to extract FIRST, because both halves reach for it.
 * It imports neither command, so the dependency runs one way and a cycle cannot form.
 *
 * `flagNamesOf` is here rather than beside either flag spec because the help-truth ratchet compares a verb's
 * usage string against its parser, so both verbs export the same shape and neither should spell the fold
 * twice.
 */
import { slopweaverHome } from "../../../config.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type FlagSpec, type ParsedFlags } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/**
 * Every flag a spec declares, `--`-prefixed and sorted, for the help-truth ratchet to compare both ways.
 *
 * The defaults are destructured rather than written `spec.string ?? []`: `FlagSpec` declares both arrays
 * optional, and `no-silent-fallback` wants the absent case named at the binding instead of
 * folded into an operator.
 *
 * @param spec the verb's declared flags
 * @returns the flag names, `--`-prefixed and sorted
 */
export function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: booleans = [], string: strings = [] } = spec;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/**
 * One declared string flag, or `undefined` — `parseFlags` types every value as `string | boolean`.
 *
 * @param parsed what `parseFlags` returned
 * @returns the value when the caller passed this flag as a string
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * One declared boolean flag. Absent reads as `false`, never as a reason to guess.
 *
 * @param parsed what `parseFlags` returned
 * @returns whether the flag was passed
 */
export function boolFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): boolean {
  return parsed.values[name] === true;
}

/**
 * Resolve where the docs live.
 *
 * Defaults inside `$SLOPWEAVER_HOME` so a doc is reachable from any repository on the machine — these are
 * cross-repo by nature. `--dir` exists because `$SLOPWEAVER_HOME` is not backed up and, unlike the corpus,
 * these are hand-written and cannot be regenerated; pointing it at a git-backed path is the durable choice.
 *
 * @param dir an explicit directory, when given
 * @param home an explicit state home, when given
 * @returns the directory to scan
 */
export function resolveHandoverDir({
  dir,
  home = slopweaverHome(),
}: {
  dir: string | undefined;
  home?: string | undefined;
}): string {
  if (dir !== undefined) {
    return dir;
  }
  return stateHomePaths({ home }).handovers;
}
