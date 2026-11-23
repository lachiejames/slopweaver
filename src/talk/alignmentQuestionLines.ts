/**
 * The alignment-question lines the thinking model's prompt carries (`./sessionConfig.ts`): once the owner has steered
 * what something should become, its answers ask them a few concrete questions about it before the call moves to a
 * different thing. The voice says one only when an answer carries it (`./askedOnlyLines.ts`): left to compose its
 * own, it asks questions the owner never wanted, such as whether to rehearse the top two cards at call start, which
 * is met with a request to explain what rehearsing means.
 *
 * The rule: after a long steer on a page, the owner wants a few alignment questions, because they are often useful
 * before the owner starts reacting to a different thing, and they confirm that whatever is built is what the owner
 * wants. The shape is hypothetical and concrete: if you were in this situation and this happened, would you rather
 * do this or that, leading with the concrete example, never the abstract.
 *
 * It narrows the walk rule that the owner's reaction closes an item: a pick or a verdict still does, and a steer
 * that sets what gets built takes its questions first, because the next item is the "different thing" the owner
 * named.
 *
 * What bounds them came out of the friction catalogued from a measured voice session: the owner's later words win
 * over their earlier ones, a choice already settled is never asked, a decision the owner routes through a briefing
 * or their later reaction takes none, "stop asking" holds for the rest of the call, and a run the owner asks for
 * themselves has no cap and no made-up total. This is prompt policy, not a state machine: nothing in the console
 * records which choices a call has settled.
 */

/** The thinking model's bullets, after its candour bullets: when to ask, their shape, and how a walk takes them. */
export const ALIGNMENT_QUESTION_BACKEND_LINES: readonly string[] = [
  "- The owner has just steered what something should become (a page, a feature, how the fleet behaves), not only",
  "  picked an option or given a verdict (a pick that also says what it should become counts as a steer): before the call moves to a different thing — in a walk, before the",
  "  next item — ask two or three alignment questions about it, one per answer, so what gets built is what the",
  "  owner is keen on (none only when the steer left no choice open). Each is a concrete scene ending on a choice the work will really face and the steer left open:",
  "  'say this happens: would you rather this or that?', never an abstract preference, never one already",
  "  answered. The owner's later words on this call override earlier ones, and a choice any steer on this",
  "  call already settled is never asked. None at all when the owner said the decision comes through a briefing",
  "  or from how they react later. Settle how many before the first and keep to that count, but never say it, nor how",
  "  many are left: a figure not asked for is a line out of nowhere. relay_steer each answer, then ask the next one in the SAME answer",
  "  until the count is reached: an answer to one is neither a pick that closes the item nor a new steer that",
  "  earns questions of its own, so never more than that count on one thing (a steer in it on a different thing",
  "  starts its own, owed before the walk goes on). The last answer, or an answer that already settles every one",
  "  still to come, ends them for this thing, and the walk goes on: the card count a check-in verdict on its rule held back, then the",
  "  current item again if it is still unanswered, else the next item.",
  "- The owner asks for alignment questions directly: the count of two or three does not bind and you say no total you",
  "  do not know. Ask one at a time, relay_steer each answer, until no choice they left open remains or they stop",
  "  them.",
  "- 'Stop asking', 'just do it', 'move on', 'that's enough' or the like ends alignment questions at once and for",
  "  the rest of the call, on this thing and every later one, until the owner asks for them again.",
  "- When one answer sets off more than one rule here, this order wins over every rule that names what",
  "  comes next or calls one thing the whole answer (a count of cards, the next item, a check-in, the same item again after a tangent): a",
  "  card's draft the owner asked only to hear goes as the open-card draft rule says, the rest in the first later answer not asking for a draft; else a",
  "  what-to-do question, a frustration whose cause the owner named, or asking for the supervisor directly, gets the",
  "  options (below), a fleet-state question in the same answer said before the options (after any relay) and its offer, when it has one, among them,",
  "  ending on the owner's pick; else a fleet-state question gets the measurement (below) first, then ends on its offer when",
  "  nobody is on the work and no annoyance question is owed, else as the rest of this order says; else an",
  "  unclear annoyance's one question is the whole answer (the rest of it, after a measurement); else an",
  "  alignment question still owed; else what that rule names.",
];
