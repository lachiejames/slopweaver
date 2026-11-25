/** The usage strings the `outlook-calendar` manifest quotes — a leaf, so the manifest barrel stays metadata-only. */

/** `outlook-calendar connect`. */
export const OUTLOOK_CALENDAR_CONNECT_USAGE =
  "usage: slopweaver outlook-calendar connect [--status] [--disconnect] [--json] [--home <dir>]\n" +
  "  Opens Microsoft's consent screen for a personal account and stores the CALENDAR grant, owner-only.\n" +
  "  It asks for User.Read and Calendars.Read only — nothing of the mailbox\n" +
  "  --status      report the stored calendar grant's account and scopes and stop — no browser, no socket\n" +
  "  --disconnect  delete the local calendar grant; consent at Microsoft stays until withdrawn at\n" +
  "                https://account.live.com/consent/Manage\n" +
  "  --json        emit the token-free grant status as one machine-readable document";

/** `outlook-calendar calendars`. */
export const OUTLOOK_CALENDAR_CALENDARS_USAGE = "usage: slopweaver outlook-calendar calendars [--json] [--home <dir>]";

/** `outlook-calendar list`. */
export const OUTLOOK_CALENDAR_LIST_USAGE =
  "usage: slopweaver outlook-calendar list [--calendar <id>] [--from <YYYY-MM-DD|iso>] [--days <1-90>] [--limit <1-1000>] [--json] [--home <dir>]";

/** `outlook-calendar read`. */
export const OUTLOOK_CALENDAR_READ_USAGE = "usage: slopweaver outlook-calendar read <event-id> [--json] [--home <dir>]";
