/**
 * The usage lines of every `slopweaver alias` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/alias.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** Exported so the manifest reads the one copy; this module imports no provider client, so that is free. */
export const ALIAS_PROVISION_USAGE =
  "usage: slopweaver alias provision --domain <zone> --identity <name> --provider <claude|codex> --label <name> " +
  "--destination <mailbox> [--json] [--home <dir>]";

/** Exported so the manifest reads the one copy. */
export const ALIAS_LIST_USAGE = "usage: slopweaver alias list --domain <zone> [--json] [--home <dir>]";

/** Exported so the manifest reads the one copy. */
export const ALIAS_CATCH_ALL_USAGE =
  "usage: slopweaver alias catch-all --domain <zone> [--enable --destination <mailbox>] [--disable] " +
  "[--json] [--home <dir>]";
