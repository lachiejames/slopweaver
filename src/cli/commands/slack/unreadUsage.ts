/** The usage line for `slopweaver slack unread` — a leaf, so the manifest barrel can quote it. */

/** `slopweaver slack unread`'s usage. */
export const SLACK_UNREAD_USAGE =
  "usage: slopweaver slack unread [--days 3] [--json] [--home <dir>]\n" +
  "  --days <n>      how far back activity is looked for, 1 to 7 (default 3); DMs always look back 7 days\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --home <dir>    the state home to read the profile, members index and Slack user token from\n" +
  "  Your unread Slack, DMs first and then activity, one line each, read LIVE on your user token. A DM is\n" +
  "  unread by Slack's own read marker, as your sidebar shows it. An activity row is a thread you spoke or\n" +
  "  were tagged in where a person has spoken since your last word there, and says whether it asks you,\n" +
  "  names you, or is for your information; Slack does not expose whether you have seen a thread. Each row\n" +
  "  carries the link `slopweaver talk slack-open` reads whole. Reads only; it never drafts, posts or\n" +
  "  sends. Exit 1 when it could not run, or a read stopped short and listed nothing — never an empty\n" +
  "  all-clear; a short read that lists rows exits 0 and says INCOMPLETE with what it missed.";
