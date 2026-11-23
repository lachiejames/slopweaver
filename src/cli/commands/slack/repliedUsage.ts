/** The usage line for `slopweaver slack replied` — a leaf, so the manifest barrel can quote it. */

/** `slopweaver slack replied`'s usage. */
export const SLACK_REPLIED_USAGE =
  "usage: slopweaver slack replied --url <slack-message-link> [--json] [--home <dir>]\n" +
  "  --url <link>    the message to count from — an ask's own anchor; a reply link reads its whole thread\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --home <dir>    the state home the Slack tokens and your Slack user id are read from\n" +
  "  Reads the thread LIVE and answers whether YOU have posted in it after the message the link names (in a\n" +
  "  one-to-one DM, anywhere in the conversation after it). Prints `replied at <iso>: <reply link>` and exits 0;\n" +
  "  `not yet: …` and exits 3; `could not check: <why>` on stderr and exits 1 — an unreadable thread is never\n" +
  "  'not yet'. It is the done-check `handover register` writes onto an ask anchored to a Slack message.";
