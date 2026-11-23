/** The usage leaf for `slopweaver automation status` — metadata only, so the manifest barrel can quote it. */

export const RECIPE_STATUS_USAGE =
  "usage: slopweaver automation status [--json] [--home <dir>]\n" +
  "  Every automation and every corpus sync, each with what it is doing now, its health and why,\n" +
  "  who it waits on, the firings the slot ledger records and how each ended, and — for a corpus sync —\n" +
  "  what its newest runs wrote per channel, repository or project, read off the sync-run ledger.\n" +
  "  READ-ONLY: no network, no model, no lock, nothing written. An unreadable store is printed as an\n" +
  "  issue, never read as empty. Exit 0 always — this is a report. The console's Automations page reads\n" +
  "  the --json document.\n" +
  "  --json      emit one machine-readable document instead of the lines\n" +
  "  --home      the state home to read, instead of $SLOPWEAVER_HOME";

export const RECIPE_STATUS_FLAG_SPEC = {
  boolean: ["json"],
  string: ["home"],
} as const;
