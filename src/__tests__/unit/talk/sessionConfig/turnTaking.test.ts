/**
 * Whose turn it is: a beat before a question, an unfinished thought waited out, the floor kept after a turn that asked
 * nothing, and a walk's next question asked by commentary before a lookup.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { ownerNeutral } from "../ownerNeutral.js";

describe("TALK_TOOLS", () => {
  // A slight delay between the response part and the question part avoids having to ask again.
  // The walk line said "in the same breath".
  it("leaves a beat between an answer and the question after it, in both prompts, and no line asks for one breath", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "When one turn answers the owner and then asks them something, those are two beats: finish the answer, take a\nshort breath of silence, then ask the question as its own short sentence.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("never fill the beat with a word");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("keep it a breath, not a silence that sounds like\nyour turn ending");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "- An answer that ends on a question for the owner puts the question LAST, as its own sentence on its own line,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("the voice takes a beat before it, so it lands whole.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Never write a marker for that beat");
    expect([TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n")).not.toContain("same breath");
  });

  // A turn ended mid-clause ("takes time why reading") under 1.8s into a pause, and the voice began 1 ms after the
  // transcript closed, with a handed-back answer. The other side: a finished thought left 116s and 3m20s.
  it("waits out an unfinished thought, a handed-back answer included, and takes its turn after a finished one", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "An unfinished thought holds the floor. A pause after a filler ('um', 'uh'), a joining word ('and', 'but',\n'or') or an unfinished clause is the owner thinking: stay silent through it, never taking a short beat alone\nas the end.",
    );
    // The page's 10s resume (held only by `asksToWait`, `site/lib/waitAsk.ts`) still gets its turn.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Hold an answer the thinking model hands you mid-thought the same way, until the owner has finished\nor the console tells you to take your turn. A quiet 'mm-hm' is the most you add meanwhile.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A finished thought (a question, a statement that lands, a steer) followed by quiet ends the owner's turn:\ntake yours then.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Never wait for 'still there?', 'next' or 'done': never make the owner prompt an answer.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "once they have asked or finished, answer properly. Never talk over them.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "When they trail off and the line goes quiet for a beat" }),
    );
  });

  // After a finished "Good, yeah, that's clear.", the voice waited 236.9s and then said "I'm right here - keep going."
  // when it was supposed to say something next.
  it("keeps the turn the voice's after it asked nothing, and never hands the floor back to the owner", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "When your last turn left nothing to answer, the next turn is yours, however long the quiet runs: never\nhand the floor back with 'go on', 'keep going' or 'go ahead', which the owner hears as their turn when it is yours.",
    );
  });

  // A bare "hello?" after a turn that asked nothing was told to carry on with the next thing
  // by the turn-taking lines and to volunteer nothing by the asked-only lines, both in this one prompt.
  it("gives a bare mid-call 'hello?' one order: say it is still there, volunteer nothing", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A bare check-in then — 'hello?', 'you there?', or a sound with no words — asks only whether you are still\nthere: say you are, in a few words ('Yep, still here.'), and volunteer nothing else",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Carry on with the next thing only when the owner or the console asks.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("open walk (below) is such an ask");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Volunteer nothing not asked about");
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("take that turn: carry on from what");
  });

  // A preference interview: a recap ending "we'll relay exactly that", a silent
  // relay, then nothing; it seems a bug that the next question was never asked.
  it("holds an interview to the walk, and never ends an open one on a recap, a statement or a silent relay", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("a run of questions you ask (an interview)");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A recap,\na statement or a hand-off never ends your turn, a silent relay included: the same turn ends on the next\nquestion, or says the walk is finished.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("an interview or any run of\n  questions)");
  });

  // The voice can ask questions while waiting on a lookup: instead of two minutes of
  // silence, the owner could steer the next question that whole time.
  it("asks an independent next question by commentary before a lookup, never one the lookup decides", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A lookup never silences it: a next question\n  the lookup does not decide goes FIRST, as a short commentary message the voice speaks while you look.",
    );
    // "do not repeat it in your final answer" contradicted "EVERY answer ends by putting something
    // to the owner … its question again", whenever the lookup finished before they answered.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Your final answer then says what the lookup found and, if still unanswered, puts that question again in\n  one line.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("do not repeat it in your final answer");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("One the lookup decides is never invented.");
    // Live probes: a commentary message is voiced within a second, but two of three runs opened on
    // "I'll check what "seat" means first", and an answer arriving mid-turn once got nothing put to the owner for 51s.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "- Every commentary message you write before or between tool calls is spoken aloud at once",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("the owner hears an announcement and then waits.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "That commentary IS the question, never a line about\n  what you are about to do",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Their reply\n  reaching you mid-work gets the same: its next question as commentary at once",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A relay_steer is never the last thing in an answer while the walk is open.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A lookup never silences the walk: a question the thinking model hands you while it still works is asked at\nonce",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "when the lookup's answer comes back, repeat the question in one line only if\nstill unanswered.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("do not ask it again");
  });

  it("keeps a look's read_screen, then a Queue card's open_card or read_card, ahead of the commentary question, so no FIRST rules collide", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("it goes on screen BEFORE ANY answer about");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A look ask\n  and a Queue card are the two exceptions: read_screen, then a card's open_card (read_card when already\n  open), still come first (above), and the commentary question follows them.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A look ask outranks every other FIRST rule\n  here: a Queue card's open_card or read_card and a walk's commentary question come after the frame, and\n  when the look is at a card, the frame's detail opens the answer and the linked page's detail follows it.",
    );
  });

  it("scopes the voice's 'say there is more and wait' to outside a walk, so the two rules never contradict", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Outside a walk (below), never read a list of your own\naloud: if there is more, say there is and wait.",
    );
    // The list, preamble and recap rules are the voice's own words, never a handed answer it
    // must say whole and as handed.
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Your\nwords: plain, no preamble, no recap of what was just said.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("A handed-back answer is said whole as handed.");
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("no lists read aloud");
    expect([TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n")).not.toContain("or read the next item");
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("or go straight on to the next item");
  });
});
