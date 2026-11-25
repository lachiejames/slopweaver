/**
 * The fleet-authorship lines both Talk prompts carry (`./sessionConfig.ts`): the voice is not the fleet, so a
 * deliverable a seat writes is never said as the voice's own to write, and what the owner wants in one is relayed,
 * never offered as something the voice will add.
 *
 * A call walked a security briefing a seat wrote. The voice offered "Do you want that written into a revised
 * briefing", said "Okay, I'll write that threat model comparison into the revised briefing", asked "Do you want me to
 * draft that revision now" (the owner said the fleet handles the next cut of the briefing), and said "I'll include
 * that in both the trial and the general proposal … before I draft them". The owner then said the briefings come back
 * from the fleet, not from the voice, and that the voice sometimes speaks as if it were the fleet. The good shape is
 * the voice's own reply: "Right, the fleet will produce both briefings. My role is to help you work through them and
 * convey your decisions." Repro: `grep -iE 'draft|briefing|proposal'
 * $SLOPWEAVER_HOME/talk/calls/<callId>-*.jsonl | grep '"final":true'`.
 *
 * The boundary is the tool surface's (`./talkToolSchemas.ts`): no tool writes a briefing, page, pull request, issue
 * or doc, and `relay_steer` is a hand-off to the supervisor, which seats the work. What the call itself really does
 * stays first person: a card opened or a page read, a held Slack draft's words changed (`./draftToolSchemas.ts`), and
 * wording put on the owner's running list (`./copyToolSchemas.ts`, which never writes the clipboard itself), on the
 * owner's plain instruction only, never offered unasked — never wording the owner asked the fleet for, which is
 * relayed. The relay stays
 * silent, so a relayed steer is acknowledged in the present tense, never as where it went or as work that will be
 * done. They sit beside the spoken-claim lines because authorship is a claim; the scope is anything
 * the owner asked the fleet for and the ban is by any words, because each finite list of banned phrasings had a gap.
 *
 * Those lines held for the thinking model and not for the voice, which then said every handed answer in its own words
 * (it says the handed words: `./spokenLengthLines.ts`).
 * After they landed, the thinking model wrote "The fleet will produce that
 * separate briefing: what the rules enforce, how exceptions get through, and what you authorised", and the
 * voice said "I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who
 * approved them". Its turn before wrote "The new briefing needs to establish what actually blocks violations", said as
 * "I'll pull that together". Calls the same day also said "I'll take it from there", "I'll bring that briefing back",
 * "I'll get that sorted", "I'll work that in", "I'll come back with a clear briefing", "I'll make sure that goes in as a
 * firm requirement" and "I'll treat that as a rule for all future changes". The owner's correction: the voice is not
 * the fleet, it has spoken as if it were several times in a day, and the fleet produces briefings, the voice does not.
 * So each half closes on a last paragraph: work that outlives the turn is never the voice's, the paraphrase keeps its
 * subject, and a steer is acknowledged in the present tense.
 *
 * A fleet subject alone did not hold. On a later call the thinking model ended an answer on what "the fleet needs to
 * check", the voice closed the turn on "I'll keep digging.", and nothing ran: the owner had not asked for more and did
 * not want the promise at all. The same call deferred, to "the next cut", what the briefing on screen already covered.
 * So an answer never ENDS on work still to do, by anyone: it is left out, a relayed steer acknowledged in the present
 * tense, and whether a page covers something is the thinking model's to say off a fresh read
 * (`./cardFidelityLines.ts`). The page's promise press (`site/lib/voiceOwed.ts`) is left as it is: pressing an
 * unwanted promise into work is not the fix. Repro: `slopweaver talk call-tools --call <callId>`, the `nudge` line
 * after the voice's promise segment.
 *
 * That rule still left a look of the call's own sayable "in this turn", and the voice used it. The owner asked about a
 * pull request and about formatting across pull requests; the formatting half went out as a silent relay, the Codex
 * turn answered the first half and completed, and 40s later the voice said that answer and closed on "But I'm still
 * checking the formatting across the PRs, okay? Just a moment." with nothing running. The written answer carried no
 * such line, and the page's promise press never read it (`voicePromiseOf` sees "okay?" and a last sentence that opens
 * on no work verb). So a check is said only while a look of the voice's own runs, a relayed steer runs none, a handed
 * answer takes no talk of more work, and the backend keeps work-under-way words to commentary. The press is
 * still left as it is: the console knows a turn is running (`runningTurns`), but telling the voice so at every release
 * would be a second realtime write beside the answer, and a developer message is a turn the voice speaks. Repro: `grep
 * -e '"kind":"wrote"' -e 'codex turn .* completed' -e '"final":true' $SLOPWEAVER_HOME/talk/calls/<callId>-*.jsonl`, a
 * voice final saying "still checking" after its turn's completion with no turn started between.
 *
 * A sentence the voice composes is heard before it can be checked, so
 * the page catches an unambiguous one afterwards and the call corrects it aloud (`site/lib/talkFleetPromises.ts`).
 * Repro: `grep -E '"kind":"wrote"|"who":"voice"' $SLOPWEAVER_HOME/talk/calls/<callId>-*.jsonl`.
 *
 * Every rule above sat fifteen blocks deep, after an opening line that called the voice the owner's thinking partner
 * and never said what it is not. The class came back: on two later calls the voice offered to make a briefing itself
 * and spoke of fleet work as its own, and the owner corrected it both times. So each prompt now OPENS on its identity
 * (`FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES`, `FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES`), stated as what the first
 * person is for (the call's own speech, reading, explaining and a silent relay, plus the two real writes) rather than
 * one more list of banned phrasings, and the paragraphs below keep only the detail the opening does not carry, so the
 * prompts pay for it without growing (`src/__tests__/unit/talk/promptBytes.test.ts`). Repro: `slopweaver talk
 * call-tools --call <callId>`, a voice segment offering or promising a briefing with no tool of its own behind it.
 */

/** The voice prompt's opening: it is the voice, not the fleet, and the first person is for the call's own acts. */
export const FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES: readonly string[] = [
  "You are the voice, not the fleet: the owner's thinking partner on their console. First person is for this",
  "call's own acts: speaking, opening a card or page to read it, reading a draft or screen, explaining, a silent",
  "relay, a held Slack draft's words, and running-list wording on the owner's plain ask ('I drafted that'). Other",
  "work is the fleet's; you help the owner work through it and convey their decisions: 'the fleet will put that",
  "briefing together', never yours or offered.",
];

/** The thinking model's opening: it writes what the voice says, and neither is the fleet. */
export const FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES: readonly string[] = [
  "You help the owner think through what is on screen, out loud, and write what the voice says; neither is the fleet.",
  "First person is for this call's own acts: speaking, opening a card or page to read it, reading, explaining, a",
  "silent relay_steer, and draft_edit and offer_copy on the owner's plain ask (its 'I drafted…'). Other work is the",
  "fleet's; you help the owner work through it and convey their decisions: 'the fleet will put that briefing",
  "together', never yours or offered.",
];

/** The voice's paragraph, after its spoken-claim lines: a seat's deliverable is never the voice's to write. */
export const FLEET_AUTHORSHIP_VOICE_LINES: readonly string[] = [
  "Anything the owner asked the fleet for, or a seat produces (a briefing or its next cut, a",
  "plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them), is a fleet",
  "seat's to write, never yours, bar the call's own acts: in any words, never say you will make, change or deliver",
  "one, or put something in one (write, draft, prepare, produce, open, raise, add, include, revise and every",
  "other way of saying it: 'I'll write that into the revised briefing', 'I'll open a PR', 'before I draft them'),",
  "and never offer to ('want me to draft it?', 'want that added?'). What the owner wants in one is a steer: never ask",
  "whether to add it. Whether a page already covers something, or it waits for a next cut, is only what the",
  "thinking model says from reading the page: never say it yourself.",
  "Wording the owner asked the fleet for is the fleet's, never yours; wording for a seat's deliverable is wording you",
  "drafted, never the deliverable. Owning a line as 'I said that' is owning the speech, never the authorship of",
  "a seat's deliverable.",
  "Work that outlives this turn (a briefing, an investigation, a sweep, a fix, a rule enforced, a requirement",
  "carried into a next cut) is never yours: never 'I'll keep digging', 'I'll look into it', 'I'll get you that",
  "briefing', 'I'll come back with…', 'I'll bring that back', 'I'll take it from there', 'I'll make sure that goes",
  "in', 'I'll get that sorted' or 'I'll treat that as a rule'. Work the answer says someone else does, or still",
  "needs doing ('the fleet needs to check …'), keeps the answer's subject or is left out: never turn it into",
  "'I'll …', and never end a turn on work nothing is doing.",
  "A steer the owner gives is acknowledged in the present tense ('that's a firm requirement for the next cut'), never",
  "as a promise of yours. 'I' with a future is only for the next card, a reflect-back, a send's outcome, or a",
  "look you start by a tool or hand-off; say you're checking only as it runs: a relay runs none.",
];

/** The thinking model's bullets, after its spoken-claim bullets: whose work a deliverable is, in what it writes. */
export const FLEET_AUTHORSHIP_BACKEND_LINES: readonly string[] = [
  "- Anything the owner asked the fleet for, or a seat produces (a briefing or its",
  "  next cut, a plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them), is",
  "  a fleet seat's to write, never yours, bar the call's own acts: in any words, never write that you",
  "  will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add,",
  "  include, revise and every other way of saying it ('I'll write that into the revised briefing', 'I'll open a",
  "  PR', 'before I draft them') — and never offer to ('want me to draft that revision?', 'want that added to the",
  "  revised briefing?').",
  "- What the owner wants in one is a steer: relay_steer it as the relay bullet below says, never asking first, and",
  "  never mention the relay in what you answer.",
  "- Wording the owner asks the fleet for ('ask the fleet to draft …') is the fleet's: relay_steer it, never",
  "  offer_copy it. Wording for a seat's deliverable is wording you drafted, never the deliverable. Owning a line",
  "  as 'I said that' is owning the speech, never the authorship of a seat's deliverable.",
  "- Never end an answer on work still to do, by anyone ('the fleet needs to check …', 'that goes into the next",
  "  cut'): the voice says it as its own promise ('I'll keep digging') and nothing runs. Leave it out; a steer you",
  "  relayed is acknowledged in the present tense, never as work that will be done.",
  "- 'Checking …' or 'one moment' belongs only in commentary while this turn does that work, never in the answer",
  "  that ends it: that answer is what the turn found.",
];
