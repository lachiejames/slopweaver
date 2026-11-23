/**
 * The `turn breakage` verb's usage text and flag spec — a LEAF, importing nothing, for the reason
 * `./satisfiedUsage.ts` gives: the manifest and the `--help`-truth ratchet both read these, and neither may
 * pull a command module's dependencies in with them.
 */

/** What `slopweaver turn breakage --help` prints, and what the `--help`-truth ratchet reads. */
export const TURN_BREAKAGE_USAGE =
  "usage: slopweaver turn breakage --thread <channel/ts> --what <step> --error <verbatim> --cause <why>\n" +
  "                                --did-instead <what you did> [--home <dir>]\n" +
  "       slopweaver turn breakage --classes\n" +
  "  Records one loop breakage that only a session's judgement can name, in ledgers/loop-breakage.jsonl —\n" +
  "  the same ledger code writes for every class it can see itself.\n" +
  "  --classes      print every breakage class and who writes it, and record nothing. Run it before\n" +
  "                 recording: a class code writes, or journals elsewhere, is not yours to add.\n" +
  "  --thread       which ask, as <channel>/<messageTs>, or a short name for a loop-level breakage.\n" +
  "  --what         the step that broke, naming the concrete thing it broke on.\n" +
  "  --error        the failure verbatim, as the tool reported it.\n" +
  "  --cause        WHY it broke — the mechanism, not the symptom. REQUIRED: a blank one exits 2 and\n" +
  "                 writes nothing, because a row with no cause is the row nobody can act on.\n" +
  "  --did-instead  what you did about it, or what you left and why.\n" +
  "  Exits 2 when any field is blank. Idempotent: the same --thread and --what twice is one row, exit 0.";

/** The manifest's example invocation, kept here so the manifest stays one line per field. */
export const TURN_BREAKAGE_EXAMPLE =
  'slopweaver turn breakage --thread C123/1712345678.000100 --what "turn answer --accounted-for-ts" ' +
  '--error "the thread moved since this answer was composed" ' +
  '--cause "the flag keeps only its last value, so two later messages cannot both be accounted for" ' +
  '--did-instead "answered the newest message first"';

/** The `breakage` verb's flag SPEC, exported for the same ratchet. */
export const TURN_BREAKAGE_FLAG_SPEC = {
  boolean: ["classes"] as readonly string[],
  string: ["thread", "what", "error", "cause", "did-instead", "home"],
} as const;
