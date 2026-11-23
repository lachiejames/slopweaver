/**
 * `github rerun`'s usage text. A leaf, for the reason `.claude/rules/area-cli.md` § "Metadata is eager"
 * gives: the manifest reads it eagerly, so it imports nothing.
 */

/** The whole `github rerun` usage block. */
export const GITHUB_RERUN_USAGE =
  "usage: slopweaver github rerun --repo <owner/name> (--run-id <id> | --number <n>) [--dry-run] [--json] " +
  "[--home <dir>]\n" +
  "  Re-run the FAILED jobs of a workflow run through the door — the governed form of a raw failed-jobs\n" +
  "  `gh run rerun` — and confirm by reading the run back at its next attempt.\n" +
  "  Read the red leg first (`github run-log <run-id>`): a re-run answers a transient failure, never a real one.\n" +
  "  --repo <owner/name>  the repository the run belongs to\n" +
  "  --run-id <id>      the Actions run — the number in an /actions/runs/<id> URL\n" +
  "  --number <n>       a pull request: every completed run on its CURRENT head commit that ended failure,\n" +
  "                     cancelled or timed_out is re-run, unless a newer run of its workflow replaced it.\n" +
  "                     None failed is not an error; a startup_failure or action_required run exits 1\n" +
  "  --dry-run          read the runs and print what would be re-run, with no write and no door record\n" +
  "  --json             emit one machine-readable document instead of the text report\n" +
  "  --home <dir>       resolve the credential and the door's record from this Slopweaver state home";
