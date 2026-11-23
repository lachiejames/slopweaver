/**
 * Whether one option word names a long option in any spelling `getopt_long` accepts. GNU tools take any
 * unambiguous PREFIX of a long option (`gsed --expr='1w out'` is `--expression`), so an exact-name check reads
 * a write or an evaluator as nothing.
 *
 * Ambiguity is deliberately NOT resolved: a prefix two options share still counts as this one, because the gate
 * only asks about options that refuse, and over-reading one refuses rather than passes.
 *
 * Pure: a word in, a match out.
 */

/** A long option word: its name after `--`, and its `=value` when attached. */
const LONG_WORD = /^--(?<name>[^=]+)(?:=(?<attached>.*))?$/s;

/**
 * Whether `word` names the long option `full` (written with its `--`), by its whole name or any prefix of it.
 *
 * @param word the argument as the shell hands it over
 * @param full the option's complete spelling, such as `--expression`
 * @returns `undefined` when the word is another option or none, else the value attached after `=` (absent when the
 *   value, if the option takes one, is the next word)
 */
export function longOption({ word, full }: { word: string; full: string }): { readonly attached?: string } | undefined {
  const match = LONG_WORD.exec(word);
  const name = match?.groups?.["name"];
  if (name === undefined || !full.slice(2).startsWith(name)) return undefined;
  const attached = match!.groups!["attached"];
  return attached === undefined ? {} : { attached };
}
