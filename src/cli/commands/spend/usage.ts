/**
 * The `spend` noun's usage lines — a LEAF importing nothing, so the manifest can quote them without loading
 * the parser (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy").
 */

/** The usage line for `spend import`, shared by `--help` and the manifest so the two cannot drift. */
export const SPEND_IMPORT_USAGE =
  "usage: slopweaver spend import <path> --as-of <YYYY-MM-DD> [--home <dir>] [--json]\n" +
  "  <path>          a company-card page they pasted and saved as markdown (Airwallex's cardholder page)\n" +
  "  --as-of <day>   the day the page was captured — never guessed from the file's date\n" +
  "  --home <dir>    the Slopweaver home to write under (default: this install's)\n" +
  "  --json          emit the stored snapshot as one JSON document on stdout\n" +
  "  Local only: it reads a file on disk and writes $SLOPWEAVER_HOME/spend/cards/. It never reaches Airwallex.\n" +
  "  Re-importing the same card and day replaces that snapshot; a new day adds one.";

/** The usage line for `spend read`. */
export const SPEND_READ_USAGE =
  "usage: slopweaver spend read [--card <last4>] [--by merchant|month] [--home <dir>] [--json]\n" +
  "  --card <last4>  one card (default: every imported card, its newest snapshot)\n" +
  "  --by <axis>     charged totals per merchant (default) or per month and merchant\n" +
  "  --home <dir>    the Slopweaver home to read (default: this install's)\n" +
  "  --json          emit one machine-readable document on stdout\n" +
  "  Monthly headroom, the reset day, the latest declines and what the page proves about them, and what\n" +
  "  each merchant was charged — grouped by the install's `spend merchants` register, else by the merchant\n" +
  "  string itself. As fresh as the newest snapshot: a pasted export, or a live `spend capture` read, which\n" +
  "  also carries Airwallex's own reason for each decline. Exits 3 when nothing is imported.";

/** The usage line for `spend capture`. */
export const SPEND_CAPTURE_USAGE =
  "usage: slopweaver spend capture --url <card page> (--discover | --store --last4 <nnnn>) [--home <dir>] [--json]\n" +
  "  --url <page>    their Airwallex cardholder page for the card (https://www.airwallex.com only)\n" +
  "  --discover      report what the page's backend answered, as shape: method, path, status and each\n" +
  "                  body's field paths with their types — never a value. Writes nothing\n" +
  "  --store         store the card's limits and transactions as its newest snapshot, for `spend read`.\n" +
  "                  Calibrated against the snapshot already stored for --last4: the nickname and the monthly\n" +
  "                  limit must match it, so `spend import` a pasted page of the card once first\n" +
  "  --last4 <nnnn>  the card's last four digits, as they read them — the card number is never read off the page\n" +
  "  --home <dir>    the Slopweaver home the browser relay resolves under (default: this install's)\n" +
  "  --json          emit one machine-readable document on stdout\n" +
  "  Read-only, in their own signed-in Chrome through the browser relay: it navigates and observes, and never\n" +
  "  clicks, types, replays a request or lifts a credential. A sign-in redirect is a refusal, not an empty report.";

/** The usage line for `spend tasks`. */
export const SPEND_TASKS_USAGE =
  "usage: slopweaver spend tasks [--home <dir>] [--json]\n" +
  "  --home <dir>    the Slopweaver home whose Gmail grant and attachments root it uses (default: this install's)\n" +
  "  --json          emit the whole reading as one JSON document on stdout\n" +
  "  The newest Airwallex task reminder in their inbox, one line per card expense it lists: upload this into\n" +
  "  Airwallex now, beside the invoice PDF pulled out of the receipt mail that names the amount — searched on the\n" +
  "  receipt domains the `spend merchants` register gives the charge's merchant — or why there is none. Reads mail only, through the Gmail door; a pulled PDF lands owner-only under\n" +
  "  live/gmail/attachments/. It never reaches Airwallex; `spend forward` drafts the forwards. Exits 3 when no\n" +
  "  reminder is in the inbox.";

/** The usage line for `spend forward`. */
export const SPEND_FORWARD_USAGE =
  "usage: slopweaver spend forward [--dry-run] [--home <dir>] [--json]\n" +
  "  --dry-run       read and plan every forward, store no draft\n" +
  "  --home <dir>    the Slopweaver home whose Gmail grant, attachments and claims it uses (default: this install's)\n" +
  "  --json          emit one machine-readable document on stdout\n" +
  "  Reads the newest Airwallex task reminder as `spend tasks` does, and for each card expense whose receipt it\n" +
  "  matched, writes a forward of that receipt to receipts@expenses.airwallex.com into their own Gmail Drafts — PDF\n" +
  "  kept, subject unchanged. It NEVER sends: they press Send. One draft per receipt, ever: a later run names the\n" +
  "  draft an earlier one stored. Needs the Gmail compose scope. Exits 3 when there is nothing to forward.";

/** The usage line for `spend merchants`. */
export const SPEND_MERCHANTS_USAGE =
  "usage: slopweaver spend merchants show [--home <dir>] [--json]\n" +
  "       slopweaver spend merchants set --form <path|-> [--home <dir>] [--json]\n" +
  "  show            print the install's card-merchant register (--json: the exact stored document)\n" +
  "  set             replace the WHOLE register with one document, in one transaction; the last writer wins\n" +
  "  --form <path>   the document, or - for stdin: " +
  '{"schemaVersion":1,"merchants":[{"slug":"acme","prefixes":["acme"],"receiptDomains":["acme.example"]}]}\n' +
  "  --home <dir>    the Slopweaver home whose store it uses (default: this install's)\n" +
  "  --json          emit the register as one JSON document on stdout\n" +
  "  A charge whose merchant opens with a registered prefix (at a word boundary) groups under that slug, and\n" +
  "  its receipts are searched on the merchant's receipt domains; every other charge stays under its own\n" +
  "  merchant string. Two prefixes that overlap are refused. Exits 2 on a document that does not read.";

/** The `spend` noun's verbs, in the order `--help` lists them. */
const SPEND_VERBS: readonly string[] = ["capture", "forward", "import", "merchants", "read", "tasks"];

/** The noun's own usage, printed when no verb is named. */
export const SPEND_USAGE = `usage: slopweaver spend <${SPEND_VERBS.join(" | ")}>`;
