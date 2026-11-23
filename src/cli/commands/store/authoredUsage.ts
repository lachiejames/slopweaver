/**
 * `store authored-list`, `authored-show` and `authored-restore`'s help text — a leaf, so the manifest can
 * quote it without loading the commands (`src/__tests__/unit/cli/manifestBarrelClosure.test.ts`).
 */

/** The command that puts files into the store — every "the store holds nothing" line names it. */
export const AUTHORED_IMPORT_COMMAND = "slopweaver store import-fleet --only authored";

/** `store authored-list`'s usage. */
export const AUTHORED_LIST_USAGE =
  "usage: slopweaver store authored-list [--directory <d>] [--home <dir>] [--json]\n" +
  "  Every authored working-state file the store holds, one line per path at its newest version:\n" +
  "  path, bytes, when that version was written, and how many versions the store keeps. Reads the store only.";

/** `store authored-show`'s usage. */
export const AUTHORED_SHOW_USAGE =
  "usage: slopweaver store authored-show --ref <anchor|path> [--out <file>] [--home <dir>]\n" +
  "  One authored file's newest stored bytes, FROM THE STORE — never from disk, so a file the home lost still\n" +
  "  reads. --ref takes `~/.slopweaver/…`, `$SLOPWEAVER_HOME/…`, `file://…`, an absolute path or a path under\n" +
  "  the home. A text body prints to stdout; a binary one needs --out, which writes the exact bytes.";

/** `store slack-asks`'s usage. */
export const SLACK_ASKS_USAGE =
  "usage: slopweaver store slack-asks [--stranded] [--home <dir>] [--json]\n" +
  "  Every Slack ask the bot was tagged on, from the newest STORED ask-lifecycle ledger (live/slack/asks.jsonl)\n" +
  "  and never the disk copy: key, state, whether it was stranded, when it was captured and last moved.\n" +
  "  --stranded prints only the asks worked and left with no answer; the counts always cover every ask.";

/** `store authored-restore`'s usage. */
export const AUTHORED_RESTORE_USAGE =
  "usage: slopweaver store authored-restore [--directory <d>] [--dry-run] [--home <dir>] [--json]\n" +
  "  Writes the newest stored version of every authored file that is ABSENT from the home, with its recorded\n" +
  "  mtime, and checks each write's hash. A present file is never overwritten; one whose bytes differ from\n" +
  "  the store's is named. After `store restore` on a fresh machine, this is what brings the files back.\n" +
  "  For the default home it then writes the mirrored Claude auto-memory back into ~/.claude/projects, the same way.";
