/**
 * `automation enable` and `automation disable`'s usage strings and flag spec — a usage leaf, so `--help` and the
 * manifest read these LITERALS without loading the verb's run module.
 */

/** The lines both directions share, after their own head line. */
const SWITCH_USAGE_BODY =
  "  The ONE key written is the row's `enabled`, under the definition hold lock, in its canonical\n" +
  "  $SLOPWEAVER_HOME/live/recipe/definitions/<recipeId>.json; every other key is written back as the file\n" +
  "  parsed, never re-derived, though the file is re-indented. The change is printed before it is written, and each switch appends one line, with the anchor,\n" +
  "  their words and why, to $SLOPWEAVER_HOME/live/recipe/switches.jsonl. A row already in that state\n" +
  "  changes nothing and journals nothing. Another home is untouched.\n" +
  "  --anchor   a talk:, call:, talk-call: or transcript: anchor (`slopweaver profile words` prints them)\n" +
  "  --words    their words, byte for byte as the record at --anchor holds them\n" +
  "  --why      why the row is switched, in a sentence they can react to\n" +
  "  --dry-run  print the change and write nothing\n" +
  "  --home     the state home to switch in, instead of $SLOPWEAVER_HOME\n" +
  "  Refused for a row with no definition, a definition this build will not read, a row standing in another\n" +
  "  file, a file holding a value JSON cannot write back as it parsed (`-0`, a number past double range),\n" +
  "  and a RETIRED row, which only undoing its retirement gives back.";

export const RECIPE_ENABLE_USAGE =
  "usage: slopweaver automation enable <recipeId> --anchor <their-words anchor> --words <their exact words>\n" +
  "         --why <why> [--dry-run] [--home <dir>]\n" +
  "  Turn ONE automation on, on their word: `automation due` then reads it on its cadence instead of\n" +
  "  OFF · disabled. Refused on a row carrying a standing hold, which outranks `enabled` — enabling it would\n" +
  "  leave it OFF · HELD.\n" +
  SWITCH_USAGE_BODY;

export const RECIPE_DISABLE_USAGE =
  "usage: slopweaver automation disable <recipeId> --anchor <their-words anchor> --words <their exact words>\n" +
  "         --why <why> [--dry-run] [--home <dir>]\n" +
  "  Turn ONE automation off, on their word: `automation due` then reads it OFF · disabled and nothing fires\n" +
  "  it. A held row may be disabled too, so it stays off once its hold lifts. A firing already running is\n" +
  "  not cancelled.\n" +
  SWITCH_USAGE_BODY;

export const RECIPE_SWITCH_FLAG_SPEC = {
  boolean: ["dry-run"],
  string: ["anchor", "home", "why", "words"],
} as const;

/** Every flag `automation enable` and `automation disable` accept, as the `--`-prefixed tokens a caller types. */
export const RECIPE_SWITCH_FLAG_NAMES: readonly string[] = [
  ...RECIPE_SWITCH_FLAG_SPEC.boolean,
  ...RECIPE_SWITCH_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();
