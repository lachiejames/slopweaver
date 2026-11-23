/**
 * `automation repoint`'s usage string and flag spec — a usage leaf, so `--help` and the manifest read these LITERALS
 * without loading the verb's run module.
 */

export const RECIPE_REPOINT_USAGE =
  "usage: slopweaver automation repoint <recipeId> [--dry-run] [--json] [--home <dir>]\n" +
  "  Correct ONE own-repository row `automation due` reports as REPOSITORY DRIFT: its one repository flag moves\n" +
  "  to the repository this install's checkout resolves to, and every other field — `enabled`, a hold, the\n" +
  "  cadence, every other flag — is kept. Never a removal: `register-standing` would write the declared row\n" +
  "  back with `enabled: true`. The new address is recorded first, so a later origin move reads the row as\n" +
  "  SUPERSEDED. Refused for a row that is not drift, stands in more than one file, or names its repository twice.\n" +
  "  --dry-run  print the move and write nothing, the lock included\n" +
  "  --json     one object: recipeId, file, beforeRepository, afterRepository, dryRun\n" +
  "  --home     the state home to repoint in, instead of $SLOPWEAVER_HOME";

export const RECIPE_REPOINT_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  string: ["home"],
} as const;

/** Every flag `automation repoint` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_REPOINT_FLAG_NAMES: readonly string[] = [
  ...RECIPE_REPOINT_FLAG_SPEC.boolean,
  ...RECIPE_REPOINT_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();
