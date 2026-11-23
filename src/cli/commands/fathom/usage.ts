/**
 * The `fathom` noun's usage lines — a LEAF, so the manifest can quote them without loading the browser relay
 * or the store driver on every `slopweaver` invocation.
 */

/** The usage line for `fathom share`, shared by `--help` and the manifest so the two cannot drift. */
export const FATHOM_SHARE_USAGE =
  "usage: slopweaver fathom share <url> [--dry-run] [--no-store] [--json] [--home <dir>]\n" +
  "  <url>       a Fathom share link, https://fathom.video/share/<token> — any call anybody shared with you\n" +
  "  --dry-run   read the page and print what would be stored; write nothing\n" +
  "  --no-store  write bronze only; skip retiring and replaying the fathom rows in the local store\n" +
  "  --json      emit one machine-readable document on stdout\n" +
  "  Reads the page in your own signed-in Chrome, clicking nothing, and stores the RAW transcript by\n" +
  "  speaker as one fathom row keyed on the recording id. Never the summary, never Fathom's action items.";

/** The usage line for `fathom discover`. */
export const FATHOM_DISCOVER_USAGE =
  "usage: slopweaver fathom discover [--ingest] [--limit <1..100>] [--json] [--home <dir>]\n" +
  "  Reads Fathom's own mail (from:no-reply@fathom.video) through the Gmail door for share links and\n" +
  "  reports which calls the fathom source does not hold a transcript of yet\n" +
  "  --ingest   read each new share link with `fathom share`, in the order the mail carried them\n" +
  "  --limit    how many Fathom mails to read (default 25, maximum 100)\n" +
  "  --json     emit one machine-readable document on stdout";

/** The usage line for `fathom clear-inbox`. */
export const FATHOM_CLEAR_INBOX_USAGE =
  "usage: slopweaver fathom clear-inbox [--dry-run] [--limit <1..100>] [--home <dir>]\n" +
  "  Fathom's recap and share mail never reaches the inbox triage; this is what clears it. Ingests every\n" +
  "  share link Fathom's mail carries that the fathom source lacks, exactly as discover's ingest pass does,\n" +
  "  then archives each INBOX mail whose every share link is now held, through `gmail archive`. Archives\n" +
  "  nothing when the ingest failed, and keeps a mail carrying no share link, saying why\n" +
  "  --dry-run  ingest nothing and archive nothing; say what would be archived on what is held now\n" +
  "  --limit    how many Fathom mails to read (default 25, maximum 100)";

/** The `fathom` noun's own usage, printed for a bare `slopweaver fathom`. */
export const FATHOM_USAGE = `${FATHOM_SHARE_USAGE}\n${FATHOM_DISCOVER_USAGE}\n${FATHOM_CLEAR_INBOX_USAGE}`;

/** Every flag `fathom share` accepts, for the help-truth sweep. */
export const FATHOM_SHARE_FLAG_NAMES: readonly string[] = ["--dry-run", "--home", "--json", "--no-store"];

/** Every flag `fathom discover` accepts, for the help-truth sweep. */
export const FATHOM_DISCOVER_FLAG_NAMES: readonly string[] = ["--home", "--ingest", "--json", "--limit"];

/** Every flag `fathom clear-inbox` accepts, for the help-truth sweep. */
export const FATHOM_CLEAR_INBOX_FLAG_NAMES: readonly string[] = ["--dry-run", "--home", "--limit"];
