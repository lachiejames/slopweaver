/**
 * The `turn ledger` verb's usage text and flag spec — a LEAF, importing nothing.
 *
 * Its own module for the reason `../../../.claude/rules/area-cli.md` names and `./satisfiedUsage.ts`
 * already follows: a manifest that reaches into `./core.ts` for a usage string drags `core.ts`'s whole
 * dependency tree onto every enumeration of the verb surface. `./core.ts` is also past the file-size cap
 * on its committed baseline, which only shrinks, so a new usage string cannot go there at all.
 */

/** What `slopweaver turn ledger --help` prints, and what the `--help`-truth ratchet reads. */
export const TURN_LEDGER_USAGE =
  "usage: slopweaver turn ledger [--since <iso>] [--channel <id>] [--limit <n>] [--json] [--home <dir>]\n" +
  "  ONE row per ask, newest first, joined from every record set a turn leaves behind — the ask lifecycle\n" +
  "  log, the completion ledger, and each ask's validated drafts and review rounds — with a mean/median\n" +
  "  footer. This is the verb that replaces the scratch script: a dispatch sweep reads only OPEN\n" +
  "  dispatches, `turn watch` reads one brief, and `ledgers/turn-completions.jsonl` had no reader at all.\n" +
  "  Read-only: no door, no write, no model, and no clock beyond comparing --since.\n" +
  "  --since    keep asks TAGGED at or after this ISO instant (falling back to the capture instant when a\n" +
  "             message ts will not convert). A malformed value is refused, never silently ignored.\n" +
  "  --channel  keep only this channel id.\n" +
  "  --limit    print at most this many rows. The FOOTER is still computed over every row in the window,\n" +
  "             so trimming the page never moves the averages.\n" +
  "  --json     the rows and the footer as one document, with every phase in exact SECONDS. The human\n" +
  "             lines round to a single unit, so quote the JSON when a number has to be exact.\n" +
  "  The five phases, and the two instants each one is measured between:\n" +
  "    notice   the tag's own Slack instant -> the listener's `captured` row\n" +
  "    spin-up  `captured` -> the FIRST dispatch\n" +
  "    invest   the LAST dispatch -> the first validated draft, else that dispatch's first review round\n" +
  "    review   that dispatch's first review round -> the ask's terminal event (the send is inside this)\n" +
  "    total    the tag's own Slack instant -> the ask's terminal event\n" +
  "  spin-up measures from the FIRST dispatch and the other two from the LAST, so a RE-DISPATCHED ask\n" +
  "  reports how fast the bot started AND how long the attempt that actually answered took. Such a row is\n" +
  "  marked `re-dispatched xN` and is left out of the invest/review averages — never out of the page.\n" +
  "  A phase reads `reversed`, never a negative number and never a zero, when its closing instant is EARLIER\n" +
  "  than its opening one — two of the five open on Slack's clock and close on this machine's. Such a phase\n" +
  "  is in no average, and the footer counts them; a dash is the different case of a record set that was\n" +
  "  silent.\n" +
  "  It reports NO REACTIONS on the answer, and that is an absence rather than an omission: no record set\n" +
  "  on this machine holds a human reaction to a bot answer yet. The footer says so rather than printing\n" +
  "  an empty column.";

/** The `ledger` verb's flag SPEC, exported for the `--help`-truth ratchet and read by the parser. */
export const TURN_LEDGER_FLAG_SPEC = {
  boolean: ["json"] as readonly string[],
  string: ["since", "channel", "limit", "home"],
} as const;
