/**
 * `profile voice`'s usage, a leaf both its manifest entry and its runner read, so the barrel stays metadata-only.
 */

/** The full `--help` text. */
export const PROFILE_VOICE_USAGE =
  "usage: slopweaver profile voice [--json]\n" +
  "       slopweaver profile voice --file <cohorts.json> [--json]\n" +
  "       slopweaver profile voice measure [--dry-run] [--json] [--home <dir>]\n" +
  "\n" +
  "Read the measured length register, import cohorts into it from a file, or measure it from the Slack\n" +
  "messages they sent.\n" +
  "\n" +
  "  measure    read their sent Slack out of the local corpus (`slackBot.ownerUserId` in profile.json says whose),\n" +
  "             leave out what an app posted under their name, and write slack/all-sent and slack-dm/aggregate,\n" +
  "             then refresh the context cache the send door reads. A Slack refresh runs this by itself.\n" +
  "  --dry-run  measure and print, selecting no store and writing nothing\n" +
  "  --file     import cohorts from a JSON file (one cohort or an array of them)\n" +
  "  --json     one JSON document instead of lines\n" +
  "\n" +
  "measure exits 0 when it measured, 3 when there was nothing to measure or keep (no owner id, no Slack corpus,\n" +
  "no message of their with words in it, no owner row in the store) and wrote nothing, 1 when it could not read or\n" +
  "write (a cache it could not rebuild rolls every cohort back), 2 on a usage mistake.\n" +
  "\n" +
  "example: slopweaver profile voice measure --dry-run";
