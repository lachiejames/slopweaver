/**
 * `slopweaver secrets status`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/secrets.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The one usage line, printed on a parse error and compared against the parser by `helpTruth`. */
export const SECRETS_STATUS_USAGE = "usage: slopweaver secrets status [--home <dir>] [--all] [--json]";
