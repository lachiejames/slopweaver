/**
 * `slopweaver audit hygiene`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/audit.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** The command's complete help text. */
export const AUDIT_HYGIENE_USAGE =
  "usage: slopweaver audit hygiene [--source <source>] [--scrub] [--json] [--home <dir>]\n" +
  "  Runs the public leak-class patterns AND the private denylist over the bronze corpus on disk\n" +
  "  --source  scan one source's bronze only (default: every source)\n" +
  "  --scrub   REWRITE every flagged line, scrubbing the token shapes out of it with the shipped redactor\n" +
  "  --json    emit the scan as one machine-readable document\n" +
  "  Locations only: the matched text is never printed, because on a mail record the match IS the content.\n" +
  "  A CREDENTIAL shape (a token, a key) fails the run — that is a secret the redaction pass missed.\n" +
  "  An IDENTIFIER (a workspace id, a home path) and a private-denylist word do NOT: a world model of your\n" +
  "  own activity is supposed to contain its own ids and names, so those are reported with their locations\n" +
  "  and never gate. Unreadable bronze fails, like every gate here";
