/**
 * Every `outlook` verb's usage text, in a leaf the manifest and the commands both import — so the barrel stays
 * metadata-only and `--help` prints exactly what a refusal prints.
 */

/** `outlook connect` usage. */
export const OUTLOOK_CONNECT_USAGE =
  "usage: slopweaver outlook connect [--grant <read|manage|full>] [--status] [--disconnect] [--json] [--home <dir>]\n" +
  "  Opens Microsoft's consent screen for a personal account and stores the MAIL grant, owner-only.\n" +
  "  It asks for mail permissions only; the calendar connects on its own with `outlook-calendar connect`\n" +
  "  --grant       which permissions to request (default manage: read + categories/read-state/archive/drafts)\n" +
  "  --status      report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --disconnect  delete the local grant; consent at Microsoft stays until withdrawn at\n" +
  "                https://account.live.com/consent/Manage\n" +
  "  --json        emit the token-free grant status as one machine-readable document";

/** `outlook list` usage. */
export const OUTLOOK_LIST_USAGE =
  "usage: slopweaver outlook list [--folder <name|id>] [--query <text>] [--unread] [--limit <1..100>] [--json]\n" +
  "       [--home <dir>]\n" +
  "  --folder  the folder to list (default inbox); a well-known name, a display name or an id\n" +
  "  --query   Microsoft search over the folder; newest sent first, at most 1,000 matches\n" +
  "  --unread  unread only (with --query this filters the fetched results, so it can underfill)\n" +
  "  --limit   how many messages (default 20, at most 100)";

/** `outlook read` usage. */
export const OUTLOOK_READ_USAGE =
  "usage: slopweaver outlook read <message-id> [--thread] [--json] [--home <dir>]\n" +
  "  --thread  read the whole conversation the message belongs to, oldest first";

/** `outlook attachment` usage. */
export const OUTLOOK_ATTACHMENT_USAGE =
  "usage: slopweaver outlook attachment <message-id> (--name <file> | --attachment-id <id>)\n" +
  "       [--max-file-mb <n>] [--json] [--home <dir>]\n" +
  "  Saves one file attachment owner-only under $SLOPWEAVER_HOME and prints READ THIS: <path>\n" +
  "  --name           the attachment's exact file name (refused when two share it)\n" +
  "  --attachment-id  the attachment's id\n" +
  "  --max-file-mb    refuse anything larger (default 25)";

/** `outlook folders` usage. */
export const OUTLOOK_FOLDERS_USAGE =
  "usage: slopweaver outlook folders [--json] [--home <dir>]\n" +
  "  Every visible mail folder with its id, parent and counts";

/** `outlook categories` usage. */
export const OUTLOOK_CATEGORIES_USAGE =
  "usage: slopweaver outlook categories [--json] [--home <dir>]\n" +
  "  The mailbox's category list — the names `outlook category` adds and removes";

/** `outlook category` usage. */
export const OUTLOOK_CATEGORY_USAGE =
  "usage: slopweaver outlook category <message-id> [--add <name|id>]... [--remove <name|id>]...\n" +
  "       [--thread] [--dry-run] [--json] [--home <dir>]\n" +
  "  Add or remove categories on a message (or every message in its conversation)";

/** `outlook mark` usage. */
export const OUTLOOK_MARK_USAGE =
  "usage: slopweaver outlook mark <message-id> (--read | --unread) [--thread] [--dry-run] [--json] [--home <dir>]";

/** `outlook archive` usage. */
export const OUTLOOK_ARCHIVE_USAGE =
  "usage: slopweaver outlook archive <message-id>... [--restore] [--thread] [--dry-run] [--json] [--home <dir>]\n" +
  "  Moves each message to the Archive folder; --restore moves it back to the Inbox. Up to 100 ids";

/** `outlook draft` usage. */
export const OUTLOOK_DRAFT_USAGE =
  "usage: slopweaver outlook draft --form <json|-> [--reply-to <message-id>] [--dry-run] [--json] [--home <dir>]\n" +
  '  --form      {"to":[…],"cc":[…],"bcc":[…],"subject":"…","body":"…"}; `-` reads it from stdin\n' +
  "  --reply-to  create the draft as a reply to this message, in its conversation\n" +
  "  Creates a DRAFT only. Sending is `outlook send <draft-id>`, which shows it and asks for approval";

/** `outlook send` usage. */
export const OUTLOOK_SEND_USAGE =
  "usage: slopweaver outlook send <draft-id> [--approve <digest>] [--json] [--home <dir>]\n" +
  "  Without --approve: prints the draft as Outlook holds it and the digest that approves it, sends nothing\n" +
  "  --approve  the digest printed for this exact content; any edit to the draft invalidates it";

/** `outlook measure` usage. */
export const OUTLOOK_MEASURE_USAGE =
  "usage: slopweaver outlook measure [--folder <name|id>] [--json] [--home <dir>]\n" +
  "  Microsoft's own per-folder message counts — not bytes, and not dates";

/** `outlook triage` usage. */
export const OUTLOOK_TRIAGE_USAGE =
  "usage: slopweaver outlook triage [--limit <1..100>] [--json] [--home <dir>]\n" +
  "  The inbox grouped by sender, newest group first; reads headers only";
