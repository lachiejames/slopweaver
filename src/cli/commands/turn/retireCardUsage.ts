/**
 * The `turn retire-card` verb's usage text and flag spec — a LEAF, importing nothing, for the reason
 * `./satisfiedUsage.ts` gives: the manifest reads this string, and must not drag the verb's dependencies in.
 */

/** What `slopweaver turn retire-card --help` prints, and what the `--help`-truth ratchet reads. */
export const TURN_RETIRE_CARD_USAGE =
  "usage: slopweaver turn retire-card --channel <id> --message-ts <ts> --working-ts <ts> [--home <dir>]\n" +
  "  Deletes ONE orphaned progress card: an earlier card an ask posted, which its lifecycle no longer names as\n" +
  "  its current card, so no sweep, ticker or terminal will ever advance or finalise it. Posts nothing.\n" +
  "  --message-ts  the addressing message's OWN ts — the ask the card was posted for.\n" +
  "  --working-ts  the card to retire, named EXACTLY. Never read off the ask's current card, which is the one\n" +
  "                card that is not orphaned.\n" +
  "  Refused, deleting nothing, unless every one holds: the ask posted that card (NOT_THIS_ASKS_CARD), it is\n" +
  "  not the ask's current card (CARD_IS_CURRENT), the ask has ended, a withheld answer the Queue may still\n" +
  "  release not counting (ASK_NOT_TERMINAL), nothing\n" +
  "  at all followed it, not even a redelivered capture (ASK_REOPENED), and no other unfinished ask recorded\n" +
  "  the card (CARD_HELD_BY_OPEN_ASK). A card Slack already reports gone exits 0 as already retired.";

/** The `retire-card` verb's flag SPEC, exported for the same ratchet. */
export const TURN_RETIRE_CARD_FLAG_SPEC = {
  boolean: [] as readonly string[],
  string: ["channel", "message-ts", "working-ts", "home"],
} as const;
