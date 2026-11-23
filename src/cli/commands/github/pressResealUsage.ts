/**
 * The usage line of `slopweaver github press-reseal`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/github.ts` reads this string on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not this verb runs. The command module imports
 * it from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** `slopweaver github press-reseal`'s usage line. */
export const GITHUB_PRESS_RESEAL_USAGE =
  "usage: slopweaver github press-reseal --repo <owner/name> [--repo <owner/name> ...] [--json] [--home <dir>]\n" +
  "       slopweaver github press-reseal --repo <owner/name> [--repo ...] --apply --source-sha256 <hex>\n" +
  '                                  --reason "<why>" [--json] [--home <dir>]\n' +
  "  Re-key press-register rows stored under a key their own fields do not hash to — what a home and store\n" +
  "  carried through a sanitiser that rewrote names leave behind, and why `github landing` then refuses with\n" +
  '  "is stored under a key its own fields do not hash to". Without --apply it is a PREVIEW and writes nothing:\n' +
  "  per-repository counts, sample old -> new keys, the register's sourceSha256 and the exact apply line.\n" +
  "  Refused, with nothing written, when a row does not decode, when a mismatched row's repository was not\n" +
  "  named, or when two rows would share a key. --apply re-checks the digest, re-keys in ONE transaction, reads\n" +
  "  the register back through the strict reader before committing, and appends one receipt to\n" +
  "  $home/ledgers/landing-press-reseals.jsonl.\n" +
  "  --repo <owner/name>     a repository whose mismatched rows may be re-keyed; repeat for several\n" +
  "  --apply                 perform the re-key the preview printed\n" +
  "  --source-sha256 <hex>   the sourceSha256 the preview printed; refused when the register has moved since\n" +
  "  --reason <why>          why, in your own words; recorded on the receipt\n" +
  "  --json                  machine-readable output\n" +
  "  --home <dir>            the state home whose store and journal are meant";
