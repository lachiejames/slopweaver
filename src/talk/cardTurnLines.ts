/**
 * The thinking model's lines for the call turning to ONE Queue or Alignment card: it goes in front of the owner before any answer about
 * it, its briefings arrive already read, and every other link it carries is read through its own door
 * (`./sessionConfig.ts` carries them in the backend prompt).
 *
 * The voice must be able to read cards and the briefings associated with them. The runner reads each linked briefing
 * before the voice speaks (`site/lib/cardBriefings.ts`), so these lines tell the model to speak from what it was
 * handed and to say, word for word, the sentence a briefing it was NOT handed carries — never to agree around it. A
 * briefing cut to fit is read on to its end from its `rest` first, even when that takes multiple reads.
 */

/** The one bullet: turning to a card, reading it and its briefings, and stopping the tabs when the owner says so. */
export const CARD_TURN_BACKEND_LINES: readonly string[] = [
  "- The call turns to ONE Queue or Alignment card — the owner asks about one ('tell me about this one'),",
  "  you raise one while none is open, or the owner rules the open one, asks for next or is done: it goes on screen BEFORE ANY answer about",
  "  it or any question for a steer. read_page (once a turn): when the card open on it is that one,",
  "  read_card it — never reopen an open card. Otherwise open_card with its key, then speak. read_card,",
  "  which opens nothing, is also for a card read ahead in a walk until the walk reaches it, one the owner said not",
  "  to open, and one that left the Queue. A card only named in passing or a list is not",
  "  turned to. Its `briefings` arrive read: speak from each, paging a 'partial' one on per read_card.",
  "  A `say` is said only as read_card says; never agree with or describe what you were not handed.",
  "  Then, until the owner says the tabs stop (below), read every other page, screenshot, pull request and row it links,",
  "  a pull request or issue by verb github read <url>, a row by board_row,",
  "  the whole thread by slack_open, any other page by browser — but not the links inside those.",
  "  Your first sentence on the card carries a detail from a linked page, never 'I'll take a look' or 'let me check'.",
  "  A link that will not open: read the rest, then say which and why in a few words, never that the whole card was read.",
  "  When none would open, the first sentence says so and why, and the card's own words carry the rest.",
  "  In a walk, the answer that reads an item has also read the NEXT card and its links; say only",
  "  the current one. When the owner says the browser or tabs keep opening",
  "  while you read ('stop that, I've already got it') and you have been reading the card's links by browser,",
  "  those are the tabs: stop reading that card's links, say which you did not read, and never flip",
  "  openCards for it. Only when the tabs meant are the card's own page and thread is it open_card.",
];
