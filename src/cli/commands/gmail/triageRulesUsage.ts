/**
 * The usage of `slopweaver gmail triage-rules`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/gmailTriage.ts` reads this on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. The command module imports it
 * from here, never the reverse. Import only other leaves: `manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help`, the manifest and the parser's refusals so the three cannot drift. */
export const GMAIL_TRIAGE_RULES_USAGE =
  "usage: slopweaver gmail triage-rules [--set <path>] [--json] [--home <dir>]\n" +
  "  Prints this install's own `gmail triage` policy and the store revision it stands at: the sender rows\n" +
  "  archived unasked, the structural rules (last-reply, passed-invite), the delegates (fathom-clear-inbox,\n" +
  "  gmail-clear-meeting-notes, spend-tasks) and the gated rules a seat checks first. The code ships none of\n" +
  "  them; they live in the store, never in the home or in git. With none, every group is carded.\n" +
  "  --set   replace the whole policy with the document at <path>:\n" +
  '          { "schemaVersion": 2, "rules": [], "structuralRules": [], "delegates": [], "gatedRules": [] },\n' +
  "          every entry carrying a non-empty anchor and why. Validated whole, then written pinned to the\n" +
  "          revision just read; a concurrent change refuses and nothing is written\n" +
  "  --json  emit { document, revision }: document is exactly the shape --set takes\n" +
  "  Exits 3 when the install declares nothing";
