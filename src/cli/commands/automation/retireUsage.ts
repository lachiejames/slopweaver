/**
 * `automation retire`'s usage string and flag spec — a usage leaf, so `--help` and the manifest read these LITERALS
 * without loading the verb's run module.
 */

export const RECIPE_RETIRE_USAGE =
  "usage: slopweaver automation retire <recipeId> --anchor <their-words anchor> --words <their exact words> --why <why>\n" +
  "         [--home <dir>]\n" +
  "       slopweaver automation retire --undo <recipeId> [--home <dir>]\n" +
  "  Take ONE declared standing row off THIS install for good, on their word: the row's id is recorded in\n" +
  "  $SLOPWEAVER_HOME/live/recipe/retirements.json with the anchor, their words and why, then its definition\n" +
  "  file is removed. The declaration subtracts it, so `automation due` reports one RETIRED line instead of\n" +
  "  DECLARED … ABSENT, and `register-standing` never writes it back. Another home is untouched.\n" +
  "  Only a row `register-standing` declares may be retired, since that is what restores it. A firing already\n" +
  "  running is not cancelled; nothing selects the row again. History (run stamps, slot attempts) is kept.\n" +
  "  Its owed finding debt is cleared; a board finding it filed stays, for the seat to settle.\n" +
  "  --anchor  a talk:, call:, talk-call: or transcript: anchor (`slopweaver profile words` prints them)\n" +
  "  --words   their words, byte for byte as the record at --anchor holds them\n" +
  "  --why     why this row does not belong on this install, in a sentence they can react to\n" +
  "  --undo    remove the retirement; the definition stays absent until `register-standing` writes the\n" +
  "            build's current row back, so `automation due` reports it ABSENT in between\n" +
  "  --home    the state home to retire in, instead of $SLOPWEAVER_HOME\n" +
  "  Repeating a retirement converges: the first word stands and a left-over definition file is removed.";

export const RECIPE_RETIRE_FLAG_SPEC = {
  boolean: ["undo"],
  string: ["anchor", "home", "why", "words"],
} as const;

/** Every flag `automation retire` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_RETIRE_FLAG_NAMES: readonly string[] = [
  ...RECIPE_RETIRE_FLAG_SPEC.boolean,
  ...RECIPE_RETIRE_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();
