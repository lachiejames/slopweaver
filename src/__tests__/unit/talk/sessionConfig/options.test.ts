/**
 * A what-to-do question answered with options, costs and a lean, and a fleet-state question with a measurement: both
 * prompts' options blocks pinned verbatim, and the candour lines that hand a named cause to them.
 */
import { describe, expect, it } from "vitest";

import { ALIGNMENT_QUESTION_BACKEND_LINES } from "../../../../talk/alignmentQuestionLines.js";
import { CANDOUR_BACKEND_LINES, CANDOUR_VOICE_LINES } from "../../../../talk/candourLines.js";
import { EXAMPLE_AND_STEERS_VOICE_LINES } from "../../../../talk/exampleAndSteersLines.js";
import { OPTIONS_BACKEND_LINES, OPTIONS_VOICE_LINES } from "../../../../talk/optionsLines.js";
import { SCREEN_LOOK_BACKEND_LINES } from "../../../../talk/screenLookLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";

describe("the two prompts", () => {
  // Complaints of not being given options, or of a yes man, were answered with the briefing's one next step, and
  // "you've had all night" with "I haven't checked what finished overnight". Prompt policy, so its exact words are
  // the property.
  it("answers a what-to-do question with options, costs and a lean, and a fleet-state question with a measurement", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      `${EXAMPLE_AND_STEERS_VOICE_LINES.join("\n")}\n\n${OPTIONS_VOICE_LINES.join("\n")}\n\nNever read an id aloud`,
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      `${ALIGNMENT_QUESTION_BACKEND_LINES.join("\n")}\n${OPTIONS_BACKEND_LINES.join("\n")}\n${SCREEN_LOOK_BACKEND_LINES[0]!}`,
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(OPTIONS_BACKEND_LINES[0]!);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(OPTIONS_VOICE_LINES[0]!);
    // A phrase-by-phrase pin kept leaving one obligation (the gap sentence, the lean, the four reads)
    // carried only by the whole-block check derived from the same constant, so both blocks are pinned verbatim.
    // The lean and pick, the list exception (the voice's own turn-taking says "one or two sentences" and
    // "never read a list aloud" outside a walk), the measured state and its sources, and the pace-reproach line (the
    // replay of both earlier prompt versions answered "you've had all night" without where it stood).
    expect(OPTIONS_VOICE_LINES).toEqual([
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
      // "make it warmer, then read me the draft" met this and draft-edit's "never read
      // the new words out", so it names only a card draft the owner asked only to hear.
      "its chat to type. A card's draft asked only to hear this turn is read as its rule says, and nothing more: the rest",
      "(options or a measurement) comes in the first later turn not asking for a draft, a draft asked again going alone again.",
    ]);
    expect(OPTIONS_BACKEND_LINES).toEqual([
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
      // A card's draft the owner asked to hear going alone is the precedence order's first clause,
      // `ALIGNMENT_QUESTION_BACKEND_LINES`, held once there so the prompts' budget pays for it once.
      // "none of the above" met with "your decision follows", then the options again.
      "- When the owner waves off options you offered — 'none of the above', or a question back — that choice is",
      "  settled: answer what they said instead, never writing that their choice or decision is still owed. When the",
      // "none of the above; ask me that again" reopens it, matching the steers read's own line.
      "  same words also ask for that question again, whichever was said last wins (the steers read, above).",
    ]);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "After the owner asks what to do, the one question\n  you add is the owner's pick between the options (above), never a yes to one.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "'What is waiting on me', or 'what should I do' meaning the whole\n  plate (about the thing in hand it is the options above)",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("or send them to its chat mid-call.");
    // The unclear-annoyance question was the one other rule that could answer "you're useless".
    expect(CANDOUR_VOICE_LINES.join("\n")).toContain(
      "A cause the owner names ('no options', 'yes man', 'useless') is not that: it gets\nthe options (below).",
    );
    expect(CANDOUR_BACKEND_LINES.join("\n")).toContain(
      "A cause the owner names ('no options', 'yes man', 'useless')\n  is not unclear: it gets the options (below)",
    );
    // An agreement dressed in a reason was the voice's reply to "yes man" on that call.
    expect(CANDOUR_VOICE_LINES.join("\n")).toContain(
      "Agreeing with a reason is still agreement when the rest only restates the complaint.",
    );
    expect(CANDOUR_BACKEND_LINES.join("\n")).toContain(
      "agreeing with a reason that only restates the complaint\n  is still stock agreement.",
    );
  });
});
