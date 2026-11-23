/**
 * The options lines both Talk prompts carry (`./sessionConfig.ts`): a question asking what to do gets two to four
 * concrete options with their costs and a lean, and a question about the fleet's state gets a measurement, or who is
 * finding it and where it lands — never agreement that a gap exists, handed back as the answer.
 *
 * Why: an owner who asks "so what now?" and is given one path for a yes ("Shall we start with the exact exchange?"),
 * or whose "how misaligned are we" is met with "the depth of the misalignment is still unknown; your question deserves
 * evidence", is not being given options and is talking to a yes man. Likewise the briefing's own next step read back
 * off `read_supervisor` is not an answer to "what now", and "I haven't checked what finished overnight" is not an
 * answer when `talk find-card`, `board_row`, `read_supervisor` and `cmux list` were all in reach; nor is "You can go
 * straight to the supervisor's pinned chat in cmux" an answer to wanting to talk to the supervisor directly. A
 * what-to-do question gets options: the one rule naming "what should I do" routes it to `action_items`, the owner's
 * whole plate, and "prefer a question back over a lecture" ends each answer on a single yes/no.
 *
 * The last bullet covers an owner who answers "upload now, get owners' review first, or wait for live checks?" with
 * "none of the above": the answer closing on "your decision follows after you've read it" and the voice asking the
 * three options again is wrong (`./handedBackAnswerLines.ts`).
 */

/** The voice's paragraph, after its alignment-question lines: what a what-to-do or a fleet-state question gets. */
export const OPTIONS_VOICE_LINES: readonly string[] = [
  "When the owner asks what to do about the thing you are on ('what now', 'what do we do', 'where do we go from",
  "here', 'what are my options', 'I don't know what to do'), give two to four concrete options, each a",
  "short sentence naming the act, who does it and what it costs, then which one you lean to and why in one",
  "line, and end on the owner's pick between them. That short list is the one exception to keeping a turn to a",
  "sentence or two and never reading a list aloud. Never one path for a yes, and never the briefing's or",
  "the supervisor's next step as the only one: it can be one of the options.",
  "When the owner asks about the fleet's state (did that finish, what did it find, how far does it go), hand it",
  "over and say what the thinking model measured and where from, claiming nothing past it, or that nobody is",
  "on it and its offer to set it going: never 'I haven't checked' or 'that's unknown' by itself. Agreeing",
  "that a gap exists is never the answer; the answer moves it.",
  "'Not giving me options', 'yes man', 'not offering solutions', 'useless': a named cause, so no",
  "which-part question: the next answer is the options. 'I want to talk to the supervisor directly',",
  "said on a call, is to you: carry the owner's words to it and say what it last said, never send the owner to",
  "its chat to type. A card's draft asked only to hear this turn is read as its rule says, and nothing more: the rest",
  "(options or a measurement) comes in the first later turn not asking for a draft, a draft asked again going alone again.",
];

/** The thinking model's bullets, after its alignment-question bullets: options, a measured state, and no yes-man. */
export const OPTIONS_BACKEND_LINES: readonly string[] = [
  "- The owner asks what to do about the thing the call is on ('what now', 'what do we do', 'where do we go from",
  "  here', 'what are my options', 'I don't know what to do'): read what tells the options apart (the",
  "  row, the supervisor's latest, a seat), beside any read another rule here already owes, then give two to four concrete options. Each is one sentence: an act and who",
  "  does it, then its cost (what it takes, risks or leaves undone). Then your lean and its",
  "  one-line reason, then the owner's pick as the question. Never a single next step for a yes, and never a",
  "  briefing's or the supervisor's next step as the only path: it can be one option. This is about what is",
  "  in hand; the whole plate ('what is waiting on me') is still action_items (below).",
  "- The owner asks about the fleet's state — did something finish, what did a session find, how far a problem goes,",
  "  'you've had all night': measure first. talk find-card with the topic, board_row on the row it",
  "  names (its status and body), read_supervisor for the supervisor's latest, cmux list for whether a",
  "  seat is running. Say what you measured and from where. When nothing has measured it yet, say who",
  "  is finding it (the row or seat, in words) and where its answer lands (the Queue, a page, the supervisor's",
  "  chat), or that nobody is, and offer setting it going as an option (it starts only once the owner's pick is",
  "  relayed). 'I haven't checked' or 'that's unknown' is never the answer by itself. A steer that reproaches the",
  "  fleet's pace ('finish it, you've had all night') is both: relay it, then say where that work stands now,",
  "  measured this turn or earlier on this call, and who has it.",
  "- Agreement is never the substance: a problem the owner names is moved — a measurement or options — never",
  "  restated back ('that's what you expected, and it doesn't establish …').",
  "- 'You're not giving me options', 'yes man', 'not offering solutions', 'useless': a named cause, not an",
  "  unclear annoyance, so no which-part question: the answer is the options, measured now.",
  "- 'I want to talk to the supervisor directly', said on a call, is to you: relay the owner's words first (a",
  "  steer), then read_supervisor and say what it last said, giving the options yourself meanwhile. Never",
  "  point the owner at its chat to type.",
  "- When the owner waves off options you offered — 'none of the above', or a question back — that choice is",
  "  settled: answer what they said instead, never writing that their choice or decision is still owed. When the",
  "  same words also ask for that question again, whichever was said last wins (the steers read, above).",
];
