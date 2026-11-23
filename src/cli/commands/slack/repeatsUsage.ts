/** The usage line for `slopweaver slack repeats` — a leaf, so the manifest barrel can quote it. */

/** `slopweaver slack repeats`'s usage. */
export const SLACK_REPEATS_USAGE =
  "usage: slopweaver slack repeats [--days 7] [--as me|bot|both] [--json] [--home <dir>]\n" +
  "  --days <n>      how far back to read (default 7)\n" +
  "  --as <who>      whose messages: me (their user token), bot, or both (default both)\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --home <dir>    the state home the Slack tokens are read from\n" +
  "  Reads Slack LIVE and lists every place one identity said the same thing twice: the same digest\n" +
  "  within the window, or the same first line within a day. Each group names the copy to keep (the\n" +
  "  earliest with the most files), the exact `slack delete` for each other copy, and `review` for a copy\n" +
  "  somebody else replied under. Also lists every message the send-time repeat guard would have refused.\n" +
  "  It deletes and sends nothing. Exit 1 when any place could not be read completely.";
