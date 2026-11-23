/**
 * `slopweaver session-start lock-in`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/sessionStart.ts` reads these strings on EVERY invocation, because `--help`,
 * `catalog` and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a
 * command module, a string would put that module and everything it imports on every invocation's load path. The command
 * modules import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const LOCK_IN_USAGE =
  "usage: slopweaver session-start lock-in --item <source:nativeId|url> --against <iso> --proposed <text> --reply <do|hand-off|defer|skip|note> --outcome <approved-as-proposed|edited|rejected|deferred|dropped|noted> [--reason <tag>] [--note <text>] [--until <iso>] [--json] [--now <iso>] [--home <dir>]";
