/**
 * The thinking model's lines for finding a card the owner names without its key, and for "is there already a card for
 * X" (`./sessionConfig.ts` carries them in the backend prompt).
 *
 * "Is there already a card for this" is one `talk find-card` call before a miss — a call where the voice
 * said it could not find a card for giving it more capability while a row had a
 * run open on it: `action_items` draws only the owner's Queue. The lookup ranks by topic, and the owner's words rarely
 * repeat a row's, so the call carries paraphrases; why, measured, is `./cardFind.ts`. It searches the held drafts on
 * the owner's Queue too, and neither the card open on the owner's screen nor a key written in a row's prose is taken
 * as the answer — asked for a Linear briefing or a queue card draft, find-card returned no
 * draft, the closed row that raised the draft named a `post:` key in its summary, and `read_card` on that
 * stale key returned an unrelated card, so the voice told the owner the draft row pointed to that card instead
 * while the draft sat on the owner's Queue under another key (`./queueDraftFind.ts`; tool args read back from
 * `~/.codex/logs_2.sqlite`).
 */

/** The two bullets: finding a card without its key, and the one find-card call that answers "is there a card". */
export const FIND_CARD_BACKEND_LINES: readonly string[] = [
  "- The owner asks you to find or bring up a card without its key ('the one about …', 'can you look this up'):",
  "  action_items, then read_card a key it lists only when its subject is about the owner's words, to check it is the",
  "  one (say nothing about it yet: a wrong guess never opens), then the one find-card call below; the card",
  "  that is it goes on screen as above before you speak about it. The card open on the screen is never the",
  "  answer for being open: one about something else is no guess at all, never proof the sought card is",
  "  missing, and never named in its place. A post: key written inside a row's summary or body is where that row",
  "  once pointed, never the card: open only a key action_items or find-card lists, and when one a row named",
  "  reads as about something else, that row's pointer is stale, never the sought card 'pointing elsewhere'. A",
  "  held draft find-card names is on the Queue: open_card its post: key. Only when neither a draft nor a row it",
  "  names is about the owner's words is it not found. If none has it,",
  "  say so in one sentence naming what you checked, and END the turn there: never search files, history or",
  "  other verbs for a CARD, and never keep working after saying you could not find it. The owner steers the",
  "  next step; a turn that keeps digging leaves the voice saying nothing but that it is still working. This",
  "  stop is for finding a card: a briefing, plan or draft the owner asked for is the four places above, files named",
  "  by a card or row included.",
  "- 'Is there already a card for X', 'did I already ask for X', 'have we got one for that': ONE call of verb",
  "  talk find-card, its words the topic plus two or three other ways a card might say it ('more tools for the",
  "  voice' → voice tools capability other agents verbs browser). It ranks every held draft on the Queue,",
  "  named first by its post: key, and the whole board, on the Queue or not. Read the top rows' summaries and",
  "  each top draft's purpose AND what it says (a purpose can be stale; its words are the draft), and judge",
  "  which, if any, is about the topic: name it in one sentence by",
  "  what it is about and where it stands ('yes — the one about the voice doing what other agents can; a",
  "  session is on it now'), never its slug. If no draft and no row is about it, say there is no card for that",
  "  yet and what you searched, and END the turn. Never call it twice for one question, and never read_card a",
  "  board slug:",
  "  it is not a Queue key; board_row reads one. A row it says is not on the Queue, or not known to be, has no",
  "  card to open: say where it stands, and never open_card it.",
];
