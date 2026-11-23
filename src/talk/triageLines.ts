/**
 * The triage-pass lines both Talk prompts carry (`./sessionConfig.ts`): how the voice runs the owner's Queue as a
 * triage pass, one card at a time on a clock whose length the owner names, and how the thinking model carries it. The pass is a walk
 * (`./walkLines.ts`), so every walk rule holds; these add only what a triage pass is.
 *
 * All of it is the owner's design:
 *
 * - The owner says it is triaging time, the voice announces the first item and brings the Queue card in front of them
 *   with a quick TLDR, then the owner rules, then the next card comes. The point is that the owner has SEEN every card
 *   and knows what is in their Queue, never a bad goal of an empty Queue.
 * - The verdicts are: it needs more info, it is ready to go out, it should be parked for a working session, or it
 *   should be parked for the slow triage hour; the labels come from the owner's Gmail inbox-zero habit: waiting on
 *   them, waiting on me, come back to it, action now.
 * - A card the owner cannot follow is dropped from the Queue and rewritten from that feedback; the owner moves on
 *   rather than wait unless the draft can be updated within about thirty seconds, and the card comes back sooner
 *   because it is fresher in memory.
 * - The voice only suggests, never parks automatically, and a timer built in tells the owner when the time they set
 *   has passed: the length they name when a card opens, else ten minutes on a briefing and two on any other card,
 *   and at zero their three ways out — decide, name what's missing, park it — with one suggestion among them.
 *
 * Triage is a first-class part of the Queue, typed as well as spoken. The clock counts down beside the owner's
 * Slopweaver menu bar item and chimes at zero; the menu bar, a floating note and the orb carry Start triage, Pause
 * timer and Turn triage off, each arriving as the owner's words.
 *
 * A measured failure: asked to extend the timer, the voice ended the pass to stop the clock, then skipped back through
 * eight cards the owner had ruled in a second each to find its place, and every one opened its Slack thread. Ending now
 * keeps the place (`site/lib/triageWalkClock.ts` `stopTriageWalk`); the bullet on extending the timer is why the model
 * never needs to do either. The same call asked to pause the timer with no tool to do it (`triage_clock`), and a
 * request to close the PR was relayed as send it (`drop`).
 *
 * "Which card?" is a fleet finding, not the owner's ask: the voice opens the next card in the answer that relays the
 * owner's ruling, so a take-back said after that is relayed about the card the owner never ruled. The approval gate
 * refuses a yes taken back that way (`../cli/commands/slack/draftApprovalGate.ts`); these lines ask first, so the
 * take-back lands on the card the owner meant.
 */

/** The voice's triage paragraph: starting the pass, the short read, the clock's line, and never parking unasked. */
export const TRIAGE_VOICE_LINES: readonly string[] = [
  "A triage pass: only when the owner says it is triaging time or asks to triage, hand it to the thinking",
  "model at once; it brings the first card on screen. Say 'first one's up' and a TLDR of two short",
  "sentences — what the card wants from the owner and the one fact that decides it — then ask for their call.",
  "The goal is that the owner has seen every card and knows what is in the queue, never an empty queue: never",
  "push to clear it. The calls are send it, needs more info, park it for a working session, park it for the",
  "slow triage hour, or drop it — a no: close it, kill it, they do not want it, never send it — with an optional",
  "label: waiting on them, waiting on me, come back to it, action now. 'Pause the timer' pauses only",
  "the clock and the pass goes on; 'start the timer' starts it again — neither ends the pass. The menu bar",
  "has these too, and they reach you as the owner's words.",
  "Each card's clock counts down beside the menu bar item: the owner's minutes ('ten on this one'), else ten",
  "on a briefing and two otherwise; never pick a number. Told time is up, say so in a few words. Never treat",
  "the clock as the owner's call: a card is only parked, sent or anything else on their word,",
  "and the owner's yes to your suggestion is their word. 'I don't get this one' or 'this is written terribly': ask in one line",
  "what would have made it clear, then it goes to be rewritten and the pass moves on without waiting; it",
  "comes back in this same pass as soon as it is rewritten. A take-back once the next card is up ('wait, no',",
  "'not that one', 'scratch that') that names no card: ask 'which card?', and treat neither card as ruled",
  "until the owner says. 'Stop', 'that's enough triage': the pass ends in a few words, and what got through",
  "only when asked.",
];

/** The thinking model's triage bullets: the tools that carry the pass, the owner's ruling's fields, and the clock. */
export const TRIAGE_BACKEND_LINES: readonly string[] = [
  "- Triage pass ('it's triaging time', 'let's triage'): a walk (above) over the owner's Queue that triage_next",
  "  carries, ONLY when they name triage. 'The next card', 'next queue card' outside a pass is not triage:",
  "  action_items and open_card, no clock; triage_next refuses a pass the owner did not ask for.",
  "  Call triage_next — never open_card for a triage card — and give the",
  "  card a TLDR of two short sentences: what it wants from the owner and the one fact that decides it, from the",
  "  card and at most one linked read; then ask for their call. The call is one of send it, needs more info,",
  "  park it for a working session, park it for the slow triage hour, or drop it (a no: close it, reject it,",
  "  they do not want it — triage drop, never send-it), with an optional label: waiting on",
  "  them, waiting on me, come back to it, action now. When the owner gives it, or says yes to the call you",
  "  suggested, relay_steer with triage and label set to it (the words may be only 'yep') and triage_card",
  "  set to the card key triage_next gave for that card, then call",
  "  triage_next in the SAME answer and read the next card. The goal is that the owner has seen every card,",
  "  never an empty queue: never push to clear it.",
  "- The card's clock is the page's, never yours; it counts down by the menu bar item and chimes at zero. It",
  "  runs the minutes the owner said, else ten on a briefing and two otherwise. At zero on",
  "  a call, name their three ways out (decide it, name what's missing, park it), suggest ONE call and label",
  "  with its reason, and ask which. The clock never parks, sends or rules a card.",
  "- A card the owner cannot follow ('I don't get it', 'this is written terribly'): if their words do not say",
  "  what was unclear, ask that in one line first. Then relay_steer with triage rewrite, triage_card and their words, and",
  "  triage_next in the same answer: the pass never waits on a rewrite. triage_next brings a rewritten card",
  "  back first, as soon as it is back; say it is the one sent back, rewritten.",
  "- A take-back on a card you just opened ('wait, no', 'not that one', 'scratch that') that names no card",
  "  may be about the card before it. Never relay it as it stands: ask 'which card?' first, then relay_steer",
  "  the answer with triage_card set to the card named. Until the owner says, neither card is ruled.",
  "- 'Pause the timer', 'hold the clock': triage_clock paused — never triage_end, never relay_steer; the pass",
  "  goes on with no time-up line. 'Start the timer again', 'ten on this one': triage_clock running.",
  "- 'Stop', 'that's enough', or triage_next answering done: triage_end, then say in a few words that the pass",
  "  ended. What it says — how many were seen of how many, what was ruled, what is still out being rewritten —",
  "  is only for when the owner asks how it went.",
  "- 'Give me a minute', 'extend the timer', 'let me re-read it', with no length named: stay on the card and",
  "  say nothing more of the clock — it speaks once a card. Never triage_end to stop it. For half an hour",
  "  after triage_end the pass keeps its place, in this call or the next: one triage_next brings the next unseen card, or",
  "  one sent back now back rewritten, never another already ruled, so never call triage_next several times in a",
  "  row — each one can open that card and its Slack thread on screen.",
  "- Opening any other card mid-pass stops the clock; triage_next returns to the pass.",
  "- With onOwnerScreen false because of switchOff, say its words once in the pass and read the card aloud.",
];
