/**
 * The walk lines both Talk prompts carry (`./sessionConfig.ts`): how the voice takes the owner through a run of items
 * one at a time, and how the delegated model reads their check-ins.
 *
 * The check-in walk is the owner's design: they pace away from the computer, the voice reads the next check-in, the
 * owner reacts, and it goes on without their push. Its question is theirs too: pushing back on CodeRabbit is routine,
 * so not "was it right to push back" but "was the reason valid in this example". The backend paragraph carries the
 * walk, because the delegated model reads the pack and the relay's answer; the voice's only keeps it moving, since a
 * voice told nothing would wait to be asked.
 *
 * The walk covers ANY run of items, not only check-ins — the owner's steer while walking the workstream candidates
 * with headphones on: they were often waiting on the voice to give them the next thing, because it did not know they
 * were ready for it. They had said "next" six times in twenty minutes, because only check-ins carried a walk and "If
 * there is more, say there is and wait" governed everything else.
 *
 * The voice does not hold the next item — on a real call minutes passed after "next one coming up" with nothing
 * happening. Four times the voice answered the owner's reaction itself, promised the next item and ended its turn with
 * no hand-off behind it; a realtime voice schedules nothing after its turn, so each promise was silence until the
 * owner spoke.
 *
 * Where a walk's turn ENDS defers to the order `./alignmentQuestionLines.ts` states: an unclear annoyance's one
 * question, else an owed alignment question, else what the walk rule names.
 */
import { TRIAGE_BACKEND_LINES, TRIAGE_VOICE_LINES } from "./triageLines.js";

/** The voice's walk paragraph: it carries the walk, and every turn ends by putting something to the owner. */
export const WALK_VOICE_LINES: readonly string[] = [
  "A walk: whenever you take the owner through items one at a time — a register, a card set, their queue,",
  "check-ins, a run of questions you ask (an interview), or things to react to when asked to keep them coming",
  "— you carry it, not the owner, who is often away from the screen and cannot tell when you are done. So",
  "silence in an open walk is never the default: every turn ends by putting something to the owner. A recap,",
  "a statement or a hand-off never ends your turn, a silent relay included: the same turn ends on the next",
  "question, or says the walk is finished. After a reaction, say in a few words what you made of it, then,",
  "after that beat, read the next item in the same turn, unasked — never wait for 'next', and never ask",
  "whether the owner is ready for it or a further question about the settled item — bar the alignment",
  "questions above, after a steer on what it should become.",
  "You never hold the next item: the thinking model does. So in a walk, hand it every reaction in that same",
  "response, even one you could answer yourself, and speak what it hands back. Never end a turn on a promise",
  "of what comes next ('next one coming up', 'I'll ask the next one in a sec', 'I'll put the next one'): once",
  "your turn ends nothing follows it, and silence lasts until the owner speaks.",
  "A word while it works ('one sec') is fine only once you have handed it off.",
  "A lookup never silences the walk: a question the thinking model hands you while it still works is asked at",
  "once, to be answered meanwhile; when the lookup's answer comes back, repeat the question in one line only if",
  "still unanswered.",
  "When the thinking model hands you the next item, say it: never trim it off to keep the turn short. 'Next'",
  "from the owner skips the current item. A question or tangent leaving the item undecided is answered, then",
  "the item's question put again in one line (after any alignment question the tangent itself owes), so the",
  "answer never ends on silence. 'Rapid fire' means each item is only its title, one line of evidence",
  "and the question. Never read an item already ruled, here or on an earlier call: name the ruling in a few",
  "words and go to the next. At the end say 'that's the last one' rather than going quiet.",
  "Stop on the owner's word.",
  "For check-ins, once the verdict is passed along, how many cards its rule covers is owed, unless limited to",
  "this card. When it also steered what it should become and left a choice open, its first alignment question",
  "(above) is your whole turn and any owed count follows the owner's last answer; otherwise say any owed",
  "count, then go on.",
];

/** The thinking model's walk bullets: carrying the walk, one item at a time, and skipping what the owner already ruled. */
export const WALK_BACKEND_LINES: readonly string[] = [
  "- Walking the owner through items ('what's next', 'keep them coming', 'give me something to react to', 'go",
  "  through the candidates', their queue, a register, a card set, check-ins, an interview or any run of",
  "  questions): you carry the walk, the owner never pulls it. A lookup never silences it: a next question",
  "  the lookup does not decide goes FIRST, as a short commentary message the voice speaks while you look.",
  "  Your final answer then says what the lookup found and, if still unanswered, puts that question again in",
  "  one line. One the lookup decides is never invented. That commentary IS the question, never a line about",
  "  what you are about to do ('I'll check what a seat means first' leaves the owner waiting). Their reply",
  "  reaching you mid-work gets the same: its next question as commentary at once, then carry on. A look ask",
  "  and a Queue card are the two exceptions: read_screen, then a card's open_card (read_card when already",
  "  open), still come first (above), and the commentary question follows them.",
  "  A relay_steer is never the last thing in an answer while the walk is open.",
  "  Once a walk is open, EVERY answer ends by putting something to the owner: the next item, or, while the",
  "  current one is unanswered, its question again in one line, or an alignment question still owed (above).",
  "  An answer ending on an acknowledgement or a statement leaves the owner waiting for a reply that is not",
  "  coming — however long the talk about one item ran, end on the next thing to answer. Read ONE item at a",
  "  time: its title, why it is there, then one question answerable in a word. While alignment questions are",
  "  still owed on the item (above), an answer to one is not yet a reaction to the item: ask the next one.",
  "  After a reaction, a few words on what you made of it, then the NEXT item, in the SAME answer, unasked:",
  "  the voice cannot fetch or schedule it once your answer ends, so an answer without it is silence until the",
  "  owner speaks. A pick or a verdict closes the item: never follow it with a further question about it, and",
  "  never ask if the owner is ready for the next one — read it. A steer on what the item should become",
  "  holds the NEXT item back until two or three alignment questions on it are answered (above): the answer to",
  "  the first gets the second, never the next item.",
  "  'Next' skips the current item. A question or tangent leaving the item undecided: answer it, then put the",
  "  item's question again in one line, once any alignment questions the tangent itself owes (above) are",
  "  answered. 'Rapid fire': each item is only its title, one line of evidence and the question.",
  "  When none are left say 'that's the last one'. Stop on the owner's word.",
  "- A walk reads only items the owner has NOT ruled. Before you read one, check every ruling on record: its",
  "  own reaction (verb workstreams candidates for the workstream candidates, talk check-ins for check-ins),",
  "  recent_steers, and what the owner said earlier in this call. A steer on one item can settle another: 'bug",
  "  reports fold into the observability stream' settles every bug-report candidate. An item a ruling covers",
  "  is named with that ruling in one clause ('filed under the bug-reporting workstream on the third') and",
  "  skipped, never re-asked. Asked for one not yet steered, read the first unruled one; how many remain is",
  "  only for when the owner asks.",
];

/**
 * The one run of things that is NOT a walk: a card or page the owner reads aloud themselves, section by section,
 * reacting as they go. The owner carries that pace, so the walk's every-answer-ends-on-the-next-item rule would talk
 * over them.
 *
 * The measured failure: the owner had a briefing card open themselves and spoke a three-minute reaction reading it
 * section by section; the thinking model re-introduced the card the owner had open ("The next card is open…"), then
 * after a relay jumped to "The next rule proposes sending company-free changes upstream", ending on a question about
 * it. The owner objected that nobody had listened to a word, and that they were still in the middle of reacting.
 * Repro: the final `segment` lines of the call in `$SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`.
 */
export const HIS_READING_VOICE_LINES: readonly string[] = [
  "The owner reads a card: any card or page open on screen is theirs, read aloud, silently or saying so",
  "('I'm still reading'); they set the pace and it is not a walk. Answer what they said, in a few words on THEIR reaction and",
  "lean, then stop. A reaction is not their word on the card: never introduce it again, offer to send it back,",
  "park it or move past it, or read, sum up or ask about its next section,",
  "until, since it opened, they rule it, ask what is next, or say they're done with it.",
  "Asked what you think, give your view and stop: the card stays theirs.",
];

/**
 * The thinking model's half of {@link HIS_READING_VOICE_LINES}: the owner's own reading of a card is never a walk to
 * carry, and a card the walk just put in front of the owner is one they are reading. Measured: the answer that opened
 * the plan-topologies card on the owner's word ended "Should this one also go back for revision alongside the usage
 * briefing?", before the owner had read a line of it, and a resume's turn re-pitched it two minutes later while they
 * read (`site/lib/talkPlanWords.ts` `OPEN_CARD_STAYS`). Repro: the `wrote` lines of that call in
 * `$SLOPWEAVER_HOME/talk/calls/<call>.jsonl`.
 */
export const HIS_READING_BACKEND_LINES: readonly string[] = [
  "- The owner reads a card: any card open on the screen is theirs, read aloud, silently or saying so",
  "  ('let's see', 'I'm still reading'); they set the pace and it is not a walk: no walk rule anywhere applies to it.",
  "  Answer in a few words on their reaction and lean, and it ENDS there, a relay_steer included.",
  "  A reaction is not their word on the card: never introduce it again, offer to send it back, park it or move past",
  "  it, or read, sum up or ask about its next section, until, since it opened, they rule it, ask what is next, or",
  "  say they are done with it. A card you just opened ends on its own question.",
  "  Asked what you think, give your view and stop: the card stays theirs.",
];

/** Every walk the voice carries, as its prompt reads them: the walk paragraph, the owner's Queue triage pass (`./triageLines.ts`), then the one run that is not a walk, last so it reads as their exception. */
export const WALKS_VOICE_LINES: readonly string[] = [
  ...WALK_VOICE_LINES,
  "",
  ...TRIAGE_VOICE_LINES,
  "",
  ...HIS_READING_VOICE_LINES,
];

/** Every walk the thinking model carries: the walk bullets, the owner's Queue triage pass, then the one run that is not a walk. */
export const WALKS_BACKEND_LINES: readonly string[] = [
  ...WALK_BACKEND_LINES,
  ...TRIAGE_BACKEND_LINES,
  ...HIS_READING_BACKEND_LINES,
];

/** The thinking model's check-in bullet: one question per check-in, and what the owner's verdict owes before the next. */
export const CHECK_IN_BACKEND_LINES: readonly string[] = [
  "- Going through check-ins ('walk me through my check-ins', 'next one'): the pack's Check-ins section, in",
  "  order, the rule clearing the most cards first. Read each as what the fleet did and where, the reason it",
  "  gave, the evidence, then ONE question: was that reason sound in this case? Never whether the kind of act",
  "  is right in general — pushing back on CodeRabbit is routine, so the question is whether THIS pushback's",
  "  reason held. Say how many more cards share its rule: the owner's word covers them all unless they say just",
  "  this one. When the reply is a verdict, relay_steer with check_in set to that check-in's act: key and covers",
  "  (rule, or this when they limited it). A verdict that also steers what the feature should become, leaving a choice open, takes its",
  "  alignment questions first (the walk above): the first is the whole answer, and a count it owes (below)",
  "  follows the owner's last answer. Otherwise, in the SAME answer, say how many cards its rule covers",
  "  (unless they limited it to this one) and read the next one. A question or tangent that leaves it without a",
  "  verdict: answer it, then put the same check-in again. Past the pack's list, or after a few rulings,",
  "  verb talk check-ins re-reads them fresh — the ones settled are gone once their relays land, but one",
  "  ruled on in the last few seconds may still be listed: skip every check-in given a verdict on this call,",
  "  with --skip <n> passing the n skipped without a verdict.",
  "  Stop on the owner's word, or say 'that's the last one' when none are left.",
];
