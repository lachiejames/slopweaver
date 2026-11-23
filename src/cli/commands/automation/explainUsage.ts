/**
 * `automation explain`'s usage string and flag spec — a usage leaf, so `--help` and the manifest read these LITERALS
 * without loading the verb's run module.
 */

export const RECIPE_EXPLAIN_USAGE =
  'usage: slopweaver automation explain <recipeId> --slot <iso> --attempt <n> --why "<one plain sentence>"\n' +
  "         [--home <dir>]\n" +
  "  Say, in one sentence the owner can read, what went wrong with ONE failed firing and what would fix it. The\n" +
  "  Automations page leads that row with it, above the raw record, which stays folded under Full message.\n" +
  "  Written by the visible session that ran the row and saw it fail, or, for a failure no session watched,\n" +
  "  by the next one to pick its card up; the console never guesses a cause. The firing is named exactly, by\n" +
  "  the slot and attempt `run-due` printed when it failed, or `automation repair` printed on the take; a slot\n" +
  "  since retried onto another attempt, or an attempt that succeeded, was deferred or is still open, is\n" +
  "  refused. Writing again for the same firing replaces the sentence.\n" +
  "  --slot     the firing's scheduled time, as `run-due` printed it (`recipe <id> · slot <iso> · …`)\n" +
  "  --attempt  the attempt number `run-due` printed for that failure (`attempt N of 3 failed`)\n" +
  "  --why      what went wrong and what would fix it: one sentence ending in a full stop, one line, at most\n" +
  "             200 characters, made of words and numbers with commas only — a quote, a bracket, a path, a\n" +
  "             colon outside a clock time or an underscore is refused, and so is a code said as words (an\n" +
  "             exception's class, an errno, a status number, an exit code)\n" +
  "  --home     the state home to write in, instead of $SLOPWEAVER_HOME";

export const RECIPE_EXPLAIN_FLAG_SPEC = {
  boolean: [],
  string: ["attempt", "home", "slot", "why"],
} as const;

/** Every flag `automation explain` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_EXPLAIN_FLAG_NAMES: readonly string[] = [
  ...RECIPE_EXPLAIN_FLAG_SPEC.boolean,
  ...RECIPE_EXPLAIN_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();
