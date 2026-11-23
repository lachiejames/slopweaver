/**
 * The usage lines of the four verbs that block a turn on the owner and lift it — `block`, `reach`, `unblock` and
 * `blocked` — and nothing else. A LEAF for the reason `./usage.ts` states: `cli/manifests/turnBlock.ts` reads these on
 * every invocation. Import nothing: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything but
 * another leaf.
 */

/** `slopweaver turn block`'s usage line. */
export const TURN_BLOCK_USAGE =
  "usage: slopweaver turn block --brief <file> --need sign-in|risky-approval|ruling|other --what <sentence>\n" +
  "                      [--sign-in-url <url>] [--model <id>] [--session-url <url>] [--home <dir>] [--dry-run]\n" +
  "  Puts this turn into BLOCKED ON THE OWNER: records the ask as not done, puts an hourglass on the\n" +
  "  last step of the live card, and tags the owner in the thread saying what they have to do. It is not a failure\n" +
  "  and never renders as one — the answer is still coming, and the turn resumes from exactly this step.\n" +
  "  There is NO time bound: it stays open for a minute or a week, whatever the owner needs.\n" +
  "  --brief   the file `slopweaver turn brief` wrote — its `started` ref names the card to put the\n" +
  "            hourglass on, and its question is what the thread tag quotes.\n" +
  "  --need    `sign-in` (only the owner can sign in to the thing this step needs), `risky-approval` (this is\n" +
  "            risky enough that the owner approves it before the bot does it), `ruling` (the tag decision\n" +
  "            tree's step (d): no general ruling of the owner's covers this kind of ask and the asker is not on\n" +
  "            the trusted tier, so the owner approves this one) or `other`.\n" +
  "  --what    ONE colleague-safe sentence saying what the owner has to do — it goes on the card and in the tag,\n" +
  "            so no gate names, no file paths and no environment variables.\n" +
  "  --sign-in-url  with `--need sign-in`, the HTTPS page the owner signs in to in their work Chrome. Only its\n" +
  "            origin is kept, and the `turn-signed-out` monitor fires at once: a floating note and a\n" +
  "            top-of-queue card saying to log into that origin, opened in the owner's work Chrome. Refused beside\n" +
  "            any other need. A sign-in with no page (a local CLI login) omits it and raises neither.\n" +
  "  --dry-run print the exact card frame this would write and exit 0, recording nothing and sending nothing.\n" +
  "  With no Slack bot token the block is still RECORDED, and both Slack halves are reported as not\n" +
  "  attempted: declining to write down that a turn is not done, because Slack is unreachable, is the\n" +
  "  silent stall this whole state exists to prevent.\n" +
  "  Ends the dispatch, so the worker session finishes and gives back its lease, its burst slot and the\n" +
  "  listener token. Resume with `slopweaver turn unblock` once the owner has done it — never by re-tagging.";

/** `slopweaver turn reach`'s usage line. */
export const TURN_REACH_USAGE =
  "usage: slopweaver turn reach --brief <file> --url <url> [--url <url> ...]\n" +
  "                      [--model <id>] [--session-url <url>] [--home <dir>] [--dry-run]\n" +
  "  Before the answer leans on a page in the owner's work Chrome, checks that page's sign-in. Visits each origin\n" +
  "  in turn through the owner's work Chrome profile and judges where it lands:\n" +
  "    every origin signed in   writes a reach receipt on the turn and exits 0 — `turn answer` refuses browser\n" +
  "                             evidence from a probed origin no receipt names (REACHABILITY_UNCHECKED).\n" +
  "    one signed out           enters the sign-in block (`turn block`) on the FIRST, which floats the note and puts\n" +
  "                             the top-of-queue card up saying to log into it, then exits 3.\n" +
  "    no probe reads one       names it and exits 3 — never called reachable because another origin passed.\n" +
  "    a visit could not read   names why and exits 1 — never called signed out.\n" +
  "  --url  a page the answer will lean on; repeat it, once per page. Only its origin is checked.\n" +
  "  --dry-run  visits and judges, but writes no receipt and enters no block.\n" +
  "  A receipt proves the page was REACHABLE, not that it holds the fact: cite every browser read the answer\n" +
  "  relies on in its evidence with its URL, which is what the answer refusal reads.";

/** `slopweaver turn unblock`'s usage line. */
export const TURN_UNBLOCK_USAGE =
  "usage: slopweaver turn unblock --channel <id> --message-ts <ts> --note <what the owner did>\n" +
  "                        [--brief <file>] [--model <id>] [--session-url <url>] [--home <dir>] [--dry-run]\n" +
  "  The owner did the thing. Lifts the block, puts the card's step back to running with what the owner did under it, and\n" +
  "  prints the exact `turn dispatch` line that resumes the turn from where it stopped. Run by a VISIBLE\n" +
  "  session — nothing here polls for a credential coming back, because 'the block cleared itself' is not a\n" +
  "  claim any file on this machine can honestly make about a person.\n" +
  "  --message-ts  the addressing message's OWN ts — the same identity every other turn verb keys on.\n" +
  "  --note        what the owner actually did, in a few words: it goes on the card under the resumed step.\n" +
  "  --brief       the turn's brief, so the card can be edited. Without it the block is still lifted and the\n" +
  "                card is left as it stands, which is reported rather than assumed away.\n" +
  "  Refuses an ask that is not waiting on the owner: lifting a block that was never entered would record a\n" +
  "  resume nothing can act on.";

/** `slopweaver turn blocked`'s usage line. */
export const TURN_BLOCKED_USAGE =
  "usage: slopweaver turn blocked [--json] [--home <dir>]\n" +
  "  Every ask standing against the owner right now, oldest block first — what the fleet briefing cards\n" +
  "  on react-now and what a visible session reads to know which turns are owed a resume.\n" +
  "  Two standings: `waiting` (the owner has not done it yet) and `ready-to-resume` (they have, and the turn is owed\n" +
  "  one `turn dispatch` over its existing brief). A row leaves this list on its own once the resumed turn\n" +
  "  is dispatched — nothing has to remember to clear it.\n" +
  "  --json    one object per row: channel, messageTs, threadTs, standing, need, what, blockedIso, permalink\n" +
  "            token, and the resume command.\n" +
  "  Exits 4 when nothing is blocked, so a sweep can branch on the code rather than parse the output.";
