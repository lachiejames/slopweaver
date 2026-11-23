/** `slopweaver handover quote`'s help — a leaf, so `./quoteRun.ts` holds only the run. */

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const QUOTE_USAGE =
  "usage: slopweaver handover quote [<slug> ...] [--apply | --check] [--json] [--dir <path>] [--home <dir>]\n" +
  "       slopweaver handover quote <slug> --anchor <anchor> [--apply] [--json] [--dir <path>] [--home <dir>]\n" +
  "       slopweaver handover quote <slug> --add-steer <anchor> [--apply] [--json] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Writes the owner's own words onto every board row whose anchor names them (talk:, call:, talk-call:, transcript:),\n" +
  "so its queue card leads with them. Every such row is read — settled ones too, since an act's card quotes\n" +
  "the row it names — and a stored quote that no longer equals its record is refreshed, and so is every\n" +
  "further steer the row holds.\n" +
  "\n" +
  "  <slug>               only these rows\n" +
  "  --apply              write; without it, print what each row needs and write nothing\n" +
  "  --check              write nothing, and exit 1 unless every row reads current or still-unread\n" +
  "  --json               one JSON document instead of lines\n" +
  "  --anchor <anchor>    tie one row with no anchor to the owner's turn it came from (find it: slopweaver\n" +
  "                       profile words), writing the anchor and the quote together; a transcript: turn\n" +
  "                       re-dates askedIso. Refused for an anchored or archived row, words that would not\n" +
  "                       read, or a relay or chair-wake line the console typed\n" +
  "  --add-steer <anchor> relate one more of the owner's steers to ONE row: the owner's words at that anchor are read off\n" +
  "                       its record and quoted beside the row's own, so the card shows each in time order;\n" +
  "                       the row is the file at <slug>.md, live then archive/, else the one board file\n" +
  "                       declaring that slug — the row supervisor intake-mark carries a turn to\n" +
  "\n" +
  "A row whose words would not read is stored as unread with the reason, so its card says why rather than\n" +
  "refusing, and every run retries it. Exits 1 when a write or its mirror failed, when a row in scope is\n" +
  "malformed or a board file would not read at all, so it could not be quoted, when a steer is defective,\n" +
  "and under --check when a row still needs a write.\n" +
  "\n" +
  "example: slopweaver handover quote --apply\n" +
  "example: slopweaver handover quote my-ask --add-steer talk:<turn-id> --apply";
