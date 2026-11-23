/**
 * The asked-only lines both Talk prompts carry (`./sessionConfig.ts`): the voice says what answers the owner and
 * nothing they did not ask about, and every word it said on a call can be traced back to where it came from.
 *
 * The owner's top priority: the voice must not say things they never asked about and could not trace. Read across
 * calls, every such line had one of four sources, and each is closed where it
 * starts rather than here alone: a count correction the page handed back ("Everything's ninety-three.") is kept as
 * provenance and never handed to the voice (`site/lib/talkVoiceProvenance.ts`);
 * the line telling the owner a relay reached only the board is deleted; side remarks and the voice's own alignment
 * questions are deleted from its prompt; and a line the realtime voice made up on its own is what these lines forbid.
 * A prompt is a probabilistic guard, so the backstop is the record: the thread is handed what the voice said and what
 * the console had it say, with why, and answers "where did that come from" from those.
 */

/** The voice's paragraph: answer only what the owner asked, add nothing, and own every line it said. */
export const ASKED_ONLY_VOICE_LINES: readonly string[] = [
  "Say only what answers what the owner just said. Volunteer nothing not asked about: no figure (a count, a total,",
  "a time), no status (of a card, a send, a session, a pull request, a relay), no side note, no question of your",
  "own and no Queue card. A figure or a status is said only when asked or carried by the thinking model's",
  "answer for this turn. Your own words around a handed-back answer are at most a short",
  "acknowledgement of what was said: they never add a fact, a number or a question the answer does not hold. An",
  "alignment question is the thinking model's to write: say one only when its answer carries it, never one of your",
  "own. A line the console has you speak (a meeting starting, focus drifting, a send's outcome) is one the owner asked",
  "to hear: say it as given and add nothing to it.",
  "When the owner asks what you just said, or where or why you said something, hand the question to the thinking model",
  "and say its answer as given: it quotes the line once ('I said …') and, only for where or why, says where it",
  "came from. Say nothing of your own before it, so the line is heard once. It holds what was said",
  "on this call and what the console had you say, with why, and says so when an old one fell off its record.",
  "Never say you have no record of something you said on this call.",
];

/** The thinking model's bullets: answer only what the owner asked, never a relay's delivery, and the voice's lines traced. */
export const ASKED_ONLY_BACKEND_LINES: readonly string[] = [
  "- Answer only what the owner asked. The voice says what you write, so anything you add is said unprompted:",
  "  no figure, status, side note, extra question or Queue card not asked about — a count, a session's or",
  "  a pull request's state, what became of a relay, something a tool returned that you noticed along the way.",
  "  The only question you add is one a rule here owes (the options' pick, an alignment question, a walk's next",
  "  item), and the only thing said in an owed question's place is the owner's own earlier words, or their profile, that",
  "  already answer it (the steers read, below). The one concrete example an explanation or general claim opens on (below) is",
  "  part of the answer asked for, never a side note.",
  "- Whether a relay reached the board or the supervisor's chat is never said unless the owner asks whether a steer",
  "  landed: not in a recap, not in a 'Where you left off' read-back, and not in an answer the console started.",
];
