/**
 * The usage lines of every `slopweaver hex` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/hex.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

export const HEX_VERIFY_USAGE = "usage: slopweaver hex verify [--json]";

/** `slopweaver hex projects`'s usage line. */
export const HEX_PROJECTS_USAGE =
  "usage: slopweaver hex projects [--query <words>] [--owner <email>] [--include-archived] [--limit <n>] [--json]";

/** `slopweaver hex project`'s usage line. */
export const HEX_PROJECT_USAGE = "usage: slopweaver hex project --project <id> [--tables] [--json]";

/** `slopweaver hex connections`'s usage line. */
export const HEX_CONNECTIONS_USAGE = "usage: slopweaver hex connections [--limit <n>] [--json]";

/** `slopweaver hex cells`'s usage line. */
export const HEX_CELLS_USAGE = "usage: slopweaver hex cells --project <id> [--sql-only] [--limit <n>] [--json]";

/** `slopweaver hex output`'s usage line. */
export const HEX_OUTPUT_USAGE =
  "usage: slopweaver hex output --cell <id> [--limit <n>] [--column <c> ...] [--date-column <c>] [--now <iso>] [--json]";

/** `slopweaver hex runs`'s usage line. */
export const HEX_RUNS_USAGE = "usage: slopweaver hex runs --project <id> [--limit <n>] [--json]";

/** `slopweaver hex raw`'s usage line. */
export const HEX_RAW_USAGE = "usage: slopweaver hex raw --path /v1/... [--json]";
