/**
 * Pins the card-fidelity lines (`src/talk/cardFidelityLines.ts`): the voice must not move an option's "powerful" into the
 * problem statement or, challenged, concede a flaw the card never contained; and banning phrases solves the wrong
 * problem, so one source-fidelity rule replaces the list. Each assertion is a rule a later edit could quietly drop.
 */

import { describe, expect, it } from "vitest";

import { CANDOUR_BACKEND_LINES, CANDOUR_VOICE_LINES } from "../../../talk/candourLines.js";
import { CARD_FIDELITY_BACKEND_LINES, CARD_FIDELITY_VOICE_LINES } from "../../../talk/cardFidelityLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";

const VOICE = CARD_FIDELITY_VOICE_LINES.join("\n");
const BACKEND = CARD_FIDELITY_BACKEND_LINES.join("\n");

describe("the voice keeps a handed claim's structure", () => {
  it("keeps subject, qualifiers, negation, condition and time on the claim, and moves no word between claims", () => {
    expect(VOICE).toContain(
      "keep every claim as it was handed:\nthe same subject, and its qualifiers, its 'not', its 'if' and its time stay on that claim, and no word moves\nto another claim.",
    );
  });

  it("adds no claim the answer did not make, by one rule rather than a list of words, leaving room to acknowledge the owner", () => {
    expect(VOICE).toContain("Add no claim the answer did not make: no sharpening word, judgement, question or promise");
  });

  it("keeps the attribution and what the answer has not read or checked", () => {
    expect(VOICE).toContain(
      "never drop who said it ('the card says') or what it has not read or checked: that is part of it.",
    );
  });

  it("bans no phrase: the words the owner named are absent from both prompts' fidelity lines", () => {
    const named = ["right now", "powerful", "huge", "serious", "gap in the proposal", "right to push on that"];
    expect(named.filter((phrase) => VOICE.includes(phrase) || BACKEND.includes(phrase))).toEqual([]);
  });

  it("delegates a challenge to a card claim rather than answering it, even to hold its ground", () => {
    expect(VOICE).toContain(
      "never answer it yourself, not even to hold your ground: delegate it, so the thinking model reads the\ncard again and answers from its words.",
    );
  });
});

describe("the thinking model explains and defends a card from its words", () => {
  it("attributes anything it read, from a card to the screen, and keeps each claim whole", () => {
    expect(BACKEND).toContain(
      "- Explaining anything you read (card, row, page, thread, file, code, supervisor chat, the screen):\n  say what it says, attributed ('the card says …')",
    );
    expect(BACKEND).toContain(
      "Each claim keeps its subject, qualifiers, 'if', 'not' and time; an option's trade-off is never the\n  problem.",
    );
    expect(BACKEND).toContain("Past what you read is yours: say so and what it rests on.");
  });

  it("quotes the source where its words carry the claim, and never quotes words it does not hold", () => {
    expect(BACKEND).toContain(
      "quoting its words where they carry the claim (a number,\n  name, 'not', qualifier, option, decision, what someone said). Never quote words it does not hold.",
    );
    // An id is never quoted, since the spoken-claim rule keeps every id out of an answer.
    expect(BACKEND).not.toContain("name, id,");
  });

  it("says when it read only part of the source", () => {
    expect(BACKEND).toContain("Read only part? Say so.");
  });

  it("answers a challenge by re-reading the card, its words first, then what it does not say and what is unchecked", () => {
    expect(BACKEND).toContain(
      "- The owner challenges a claim you made from a card: read it again, by whichever tool the card rule picks, and\n  answer with its words first, then what it does not say, then what you have not checked.",
    );
  });

  it("never concedes a flaw the card does not contain, and says when the card is silent", () => {
    expect(BACKEND).toContain(
      "Never agree to a\n  flaw it does not contain or critique a proposal it does not make; when it is silent, say so.",
    );
  });

  // The model answered a briefing from a read made 20 to 50 minutes earlier and deferred to "the next cut" what the
  // page's third section already covered.
  it("says what a page covers or leaves to a later cut only off a read_page this turn, and names a change since", () => {
    expect(BACKEND).toContain(
      "- Saying what a page the owner reads covers, lacks or leaves to a later cut needs a read_page this turn, never\n  an earlier read.",
    );
    expect(BACKEND).toContain("Differing from what they say is on screen, it changed since their tab loaded.");
  });

  it("names what it has not read, opened or checked", () => {
    expect(BACKEND).toContain(
      "- Name what you have not read, opened or checked whenever it bears on the answer, rather than answer as if\n  you had",
    );
  });
});

describe("where the lines sit in the two prompts", () => {
  it("puts the voice's paragraph directly after its candour paragraph", () => {
    expect(CARD_FIDELITY_VOICE_LINES.length).toBeGreaterThan(0);
    expect(TALK_VOICE_INSTRUCTIONS).toContain(`${CANDOUR_VOICE_LINES.join("\n")}\n\n${VOICE}\n\n`);
  });

  it("puts the backend's bullets directly after its candour bullets", () => {
    expect(CARD_FIDELITY_BACKEND_LINES.length).toBeGreaterThan(0);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(`${CANDOUR_BACKEND_LINES.join("\n")}\n${BACKEND}\n`);
  });

  it("keeps each half in its own prompt", () => {
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(CARD_FIDELITY_BACKEND_LINES[0]!);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(CARD_FIDELITY_VOICE_LINES[0]!);
  });
});
