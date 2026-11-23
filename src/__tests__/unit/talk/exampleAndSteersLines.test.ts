/**
 * The concrete-example and steers-first lines, asserted as the prompt data they are.
 * The pitch call asked the voice to preempt what it would be told every time, to hold one example steady,
 * and to read the last week of steers. The
 * wording is the behaviour, so each obligation is pinned by its exact words, and the placement is pinned because the
 * read has to come before the two rules that owe a question.
 */
import { describe, expect, it } from "vitest";

import { ALIGNMENT_QUESTION_BACKEND_LINES } from "../../../talk/alignmentQuestionLines.js";
import { ASKED_ONLY_BACKEND_LINES } from "../../../talk/askedOnlyLines.js";
import { CANDOUR_BACKEND_LINES, CANDOUR_VOICE_LINES } from "../../../talk/candourLines.js";
import { CARD_FIDELITY_BACKEND_LINES, CARD_FIDELITY_VOICE_LINES } from "../../../talk/cardFidelityLines.js";
import { MAX_RECENT_HOURS } from "../../../talk/continuity.js";
import {
  EXAMPLE_AND_STEERS_BACKEND_LINES,
  EXAMPLE_AND_STEERS_VOICE_LINES,
} from "../../../talk/exampleAndSteersLines.js";
import { OPTIONS_BACKEND_LINES, OPTIONS_VOICE_LINES } from "../../../talk/optionsLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";

const VOICE = EXAMPLE_AND_STEERS_VOICE_LINES.join("\n");
const BACKEND = EXAMPLE_AND_STEERS_BACKEND_LINES.join("\n");

describe("the concrete-example lines", () => {
  it("has the thinking model open an explanation on one real example before the general point, unprompted", () => {
    expect(BACKEND).toContain(
      "- Explaining something, or making a general claim about it: open on ONE concrete example from what you read\n  (a real card, pull request, steer, call moment or row) before the general point, unprompted, never waiting\n  for 'concrete example'.",
    );
  });

  // "every later answer" made a yes-or-no follow-up carry the example the no-padding rule forbids, so
  // keeping it binds only a later answer that uses an example.
  it("keeps the same example through the answer and any follow-up that uses one, and names a second as a second", () => {
    expect(BACKEND).toContain(
      "Keep that example through the whole answer, and any later answer on the same thing\n  that uses an example uses that one: never change it halfway through. A second one is said as a second\n  example, then back to the first.",
    );
  });

  // "never swap it" beside the candour rule left no way to take up an example the owner corrected.
  // The owner's ask for "a different example of your choice" named none, so the asked-only rule and the kept example
  // pulled opposite ways.
  it("lets the owner's correction, named example or ask for a different one take the kept example's place", () => {
    expect(BACKEND).toContain(
      "What the owner asks of the example (a correction, another they name, a\n  different one, none) always wins over this bullet, the new one taking its place from then on (the correction\n  rule above).",
    );
    expect(VOICE).toContain(
      "unless the owner corrects it, names another or asks for a different one: then the new one takes its place.",
    );
  });

  // "draft one sentence saying feature flags reduce risk" is a draft AND a general claim, so the
  // no-padding list wins even when what it says is general.
  it("never pads a yes-or-no answer, a correction, a measurement or a draft with an example, general or not", () => {
    expect(BACKEND).toContain(
      "A yes-or-no answer, a correction, a measurement or a draft read aloud is not an explanation:\n  never pad one with an example, even when it makes a general claim.",
    );
    expect(VOICE).toContain("yes-or-no answer needs no example.");
  });

  // "correct that, then explain why" had candour opening on the correction and these lines opening on
  // the example, so the correction keeps first place and the example opens the explanation after it.
  it("says an owed correction before the example, which then opens the explanation", () => {
    expect(BACKEND).toContain(
      "An answer that owes a correction and\n  then explains says it first (the correction rule above), and the example opens the explanation after it.",
    );
    expect(VOICE).toContain(
      "A correction the answer opens with is still said first, and the example opens what follows it.",
    );
  });

  // "define it, but do not use an example" had the asked-only rule forbid one and this bullet demand
  // one, so whatever the owner asks of the example themselves wins over the bullet as a class.
  it("lets what the owner asks of the example, none included, win over the example rule", () => {
    expect(BACKEND).toContain(
      "What the owner asks of the example (a correction, another they name, a\n  different one, none) always wins over this bullet,",
    );
    expect(VOICE).toContain("Asked\nfor no example, say none.");
  });

  // a read showing the kept example was wrong left only "reuse a false example" or "swap it unasked".
  // a yes-or-no answer still carries no example, so the replacement waits for an answer that uses one.
  it("corrects and replaces an example a read shows was wrong, in the next answer that uses an example", () => {
    expect(BACKEND).toContain(
      // Only on the same thing, never as an aside to an unrelated question.
      "An example a read shows was wrong is never kept: the next answer on the same thing that uses an\n  example corrects it first, then says the replacement is one.",
    );
    expect(VOICE).toContain("An example the answer says was wrong is replaced by the one it gives instead.");
  });

  // a wrong example meeting an unexplained "that annoyed me" had candour owe a which-part question
  // alone and this bullet owe the correction, so candour keeps precedence over the bullet as a class.
  it("gives the candour bullets precedence wherever they fix what an answer says first or alone", () => {
    expect(BACKEND).toContain(
      "  Where the candour bullets above fix what an answer says first or alone (a which-part question asked by\n  itself, say), they win over this bullet, and the example waits for the next answer that explains.",
    );
  });

  it("has the voice say the answer's own example first and never swap it", () => {
    expect(VOICE).toContain(
      "When you explain something, open on the one concrete example the thinking model's answer leads with, before the\ngeneral point, unasked, and keep that same example for the rest of the turn.\nAn example in whatever follows on the same thing is that one: never swap it for another halfway through. A\n",
    );
    expect(VOICE).toContain(
      "A second example is said as a second one, never in place of the\nfirst, unless the owner corrects it",
    );
  });
});

describe("the steers-first lines", () => {
  it("reads the left-off block, a week of recent_steers, an all-time recall and the owner's profile before a judgement question", () => {
    expect(MAX_RECENT_HOURS).toBe(168);
    expect(BACKEND).toContain(
      "- Before you put a judgement question (an options pick, an alignment question, 'would you rather'), try\n  each read of what the owner already said about it: the 'Where you left off' block, recent_steers with hours\n  168 (the last week of steers), recall with the topic's two or three words and no days or source\n  (rulings and steers, all time; recall_open a hit before you quote it), and verb profile show (the\n  always-loaded profile).",
    );
  });

  // "say what was said and when" volunteered a time, a figure the asked-only rule refuses.
  it("says back the owner's own words instead of asking, and asks only the rest when the reads answer part", () => {
    expect(BACKEND).toContain(
      "When the reads answer an alignment question or a 'would you rather', say back the\n  owner's own words (a profile line as their profile, 'your profile says …', never as words they said)\n  and go on as it says instead of asking; for part of one, say what you found in a sentence and ask only the\n  rest.",
    );
    expect(BACKEND).toContain("When the reads hold nothing, ask as the rules below say, never saying you looked.");
    expect(BACKEND).not.toContain("and when");
  });

  // Under the asked-only rule an unasked read-back was a side note, so it is named as the owed
  // item here AND in that rule's own exception list, which named only owed questions.
  it("makes the read-back the owed item in the question's place, here and in the asked-only exception", () => {
    expect(BACKEND).toContain("That read-back is owed in the question's place, one sentence, never a side note.");
    expect(ASKED_ONLY_BACKEND_LINES.join("\n")).toContain(
      "The only question you add is one a rule here owes (the options' pick, an alignment question, a walk's next\n  item), and the only thing said in an owed question's place is the owner's own earlier words, or their profile, that\n  already answer it (the steers read, below).",
    );
    // "give me one general claim" had the unprompted example read as an unasked side note.
    expect(ASKED_ONLY_BACKEND_LINES.join("\n")).toContain(
      "The one concrete example an explanation or general claim opens on (below) is\n  part of the answer asked for, never a side note.",
    );
  });

  // The alignment bullets' own order names "an alignment question still owed", which would revive a
  // question the reads settled unless being owed itself waits on them.
  it("makes an alignment question owed only for a choice the reads leave open", () => {
    expect(BACKEND).toContain("An alignment\n  question (below) is owed only for a choice these reads leave open.");
  });

  // A settled steer had suppressed the options a "what now" is owed.
  // Keeping the pick then read as re-asking a settled choice, so the owner's own "what now" is named as the reopening.
  it("still gives a what-to-do question its options and pick, with the owner's settling steer as the lean", () => {
    expect(BACKEND).toContain(
      "The owner's own what-to-do question\n  reopens the choice, so it still gets options and their pick (below), any option their steers already settle as\n  your lean, said as theirs ('you said …')",
    );
    // "what next? no options, just your recommendation" — the owner's word on the shape wins.
    expect(BACKEND).toContain(
      "unless they ask for no options or just your pick: what the owner asks\n  of the shape always wins.",
    );
    expect(BACKEND).toContain("A settled choice not reopened is never asked again;");
  });

  // "ask me that A-or-B question again" is the owner's own alignment ask, which the voice line had refused
  // because only "what to do" counted as reopening.
  it("lets the owner's asking for a settled question again reopen it, in both prompts", () => {
    // An ask-again and a wave-off in the same words, in either order — whichever came last.
    // "ask it once more, then stop asking" — the line defers to the stop rule rather than demanding.
    expect(BACKEND).toContain(
      "\n  the owner asking for the question again reopens it. When the same words also wave it off or ask for no more\n  questions, whichever was said last decides, as the rules below say.",
    );
    expect(VOICE).toContain("reopens it, by asking what to do or for the question again.");
  });

  // "None of the above. What now?" read as a reopening here and as settled under the options wave-off
  // rule, so the wave-off keeps the choice settled.
  it("leaves a wave-off of options just offered settled, even when it asks what now", () => {
    expect(BACKEND).toContain(
      "A what-to-do question that waves off options you just offered reopens nothing:\n  the wave-off rule below settles that choice.",
    );
    expect(OPTIONS_BACKEND_LINES.join("\n")).toContain(
      "- When the owner waves off options you offered — 'none of the above', or a question back — that choice is\n  settled:",
    );
  });

  // "read before asking" beside "a failed read never holds it back" read as withhold-and-ask at once, so
  // the reads are tried and a failed one counts as holding nothing.
  it("widens nothing: no new act, no stall on a failed read, and no relay status from the read", () => {
    expect(BACKEND).toContain(
      "Going on as the owner said\n  is never a new act: an act outside the call is still relay_steer's. A read that will not open counts as\n  holding nothing and never holds the question back, and reading recent_steers is never a reason to say what\n  became of a steer.",
    );
  });

  it("has the voice put no judgement question the answer did not carry, so a settled choice is never re-asked", () => {
    expect(VOICE).toContain(
      "Never put a judgement question the thinking model's answer did not carry: it reads\nwhat the owner already said before it asks one, so a settled choice is never asked again unless the owner\nreopens it, by asking what to do or for the question again.",
    );
  });
});

describe("where the lines sit in the two prompts", () => {
  it("puts the voice's paragraph between its candour and card-fidelity paragraphs and its options paragraph", () => {
    expect(EXAMPLE_AND_STEERS_VOICE_LINES.length).toBeGreaterThan(0);
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      `${CANDOUR_VOICE_LINES.join("\n")}\n\n${CARD_FIDELITY_VOICE_LINES.join("\n")}\n\n${VOICE}\n\n${OPTIONS_VOICE_LINES.join("\n")}`,
    );
  });

  it("puts the backend's bullets after candour and card fidelity and before the alignment and options bullets that owe a question", () => {
    expect(EXAMPLE_AND_STEERS_BACKEND_LINES.length).toBeGreaterThan(0);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      `${CANDOUR_BACKEND_LINES.join("\n")}\n${CARD_FIDELITY_BACKEND_LINES.join("\n")}\n${BACKEND}\n${ALIGNMENT_QUESTION_BACKEND_LINES.join("\n")}\n${OPTIONS_BACKEND_LINES.join("\n")}`,
    );
  });

  it("keeps each half in its own prompt", () => {
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(EXAMPLE_AND_STEERS_BACKEND_LINES[0]!);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(EXAMPLE_AND_STEERS_VOICE_LINES[0]!);
  });
});
