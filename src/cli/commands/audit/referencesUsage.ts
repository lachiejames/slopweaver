/**
 * `slopweaver audit references`'s usage line, and nothing else.
 *
 * A LEAF on purpose, for the reason `./hygieneUsage.ts` gives: the manifest barrel reads it on every invocation.
 * Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The command's complete help text. */
export const AUDIT_REFERENCES_USAGE =
  "usage: slopweaver audit references [--ref <commit-ish>] [--map <path>] [--list] [--no-page] [--json] [--home <dir>]\n" +
  "       slopweaver audit references --indirect [--ref <commit-ish>] [--no-page] [--home <dir>]\n" +
  "  Exports the commit as a zip with no .git (nothing but the tree), extracts it, and scans every file and file\n" +
  "  name for a reference to the installation's organisation, counted by class. Names are never printed.\n" +
  "  --ref       what to export (default main, as this checkout holds it; nothing is fetched)\n" +
  "  --map       the off-repo reference map (default $SLOPWEAVER_HOME/hygiene/reference-map.tsv;\n" +
  "              class<TAB>flags<TAB>pattern, flags i or -)\n" +
  "  --list      print every file still carrying a reference, with its classes\n" +
  "  --no-page   do not re-render the zero-references-proof page\n" +
  "  --json      emit the proof as one machine-readable document\n" +
  "  --indirect  scan the same zip for INDIRECT candidates instead: the home's candidate map\n" +
  "              ($SLOPWEAVER_HOME/hygiene/indirect-reference-map.tsv; class<TAB>flags<TAB>disposition<TAB>\n" +
  "              pattern<TAB>replacement) plus a dictionary harvest of names nobody listed. The full report,\n" +
  "              terms included, goes to the home; stderr prints counts only; the indirect-reference-scan page\n" +
  "              is published unless --no-page. Exits 0 when no `remove` candidate remains\n" +
  "  Exits 0 only when the organisation's count is zero; 1 when one remains or a step failed. The map's\n" +
  "  `owner` class, the owner's personal name and handle, is counted apart and never fails the run";
