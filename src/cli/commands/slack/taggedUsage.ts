/** The usage line for `slopweaver slack tagged` — a leaf, so the manifest barrel can quote it. */

/** `slopweaver slack tagged`'s usage. */
export const SLACK_TAGGED_USAGE =
  "usage: slopweaver slack tagged [--days 7] [--corpus-only] [--json] [--now <iso>] [--home <dir>]\n" +
  "  --days <n>      how far back to look, 1 to 30 (default 7)\n" +
  "  --corpus-only   read the local corpus only, skipping the live search of the tail it has not ingested\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --now <iso>     freeze the instant the window ends at (default: the clock)\n" +
  "  --home <dir>    the state home to read the corpus, profile and Slack user token from\n" +
  "  Lists every recent Slack message where a PERSON tagged you, newest first: who, where, when, whether\n" +
  "  you have spoken in that thread since, and the permalink. The local corpus first, then a live search\n" +
  "  on your user token for what the corpus has not ingested yet. Unread state is NOT exposed: nothing\n" +
  "  here knows whether you have seen a message. Reads only; it never drafts, posts or sends. Exit 1 when\n" +
  "  the corpus could not be read or a leg stopped short — never an empty all-clear.";
