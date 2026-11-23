/**
 * `slopweaver linear label`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `attachUsage.ts`: `cli/manifests/linear.ts` reads it on every invocation, so it
 * imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver linear label`'s usage line. */
export const LINEAR_LABEL_USAGE =
  "usage: slopweaver linear label create --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create      add ONE issue label or project label (`kind`), to one team (`fields.teamId`) or to the\n" +
  "              workspace; the label id is DERIVED from the form, so a retry after a lost response reuses\n" +
  "              it instead of creating a second label of the same name\n" +
  "  --dry-run   print the exact label that would be created and its id, and perform no effect\n" +
  "  --json      emit the outcome as one machine-readable document\n" +
  "  --home      resolve the credential and the ledger from this Slopweaver state home";
