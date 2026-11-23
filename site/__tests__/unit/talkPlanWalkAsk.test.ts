/*
 * The owner's words asking the walk to move on, read off the owner's own finals: every shape in the first list is
 * one measured on a call's tail (fillers, a clipped first word, a stutter, a joining "and"), written in synthetic
 * words; the second holds the near-misses a bounded last-clause read must refuse.
 */
import { describe, expect, it } from "vitest";

import { walkAskOf } from "../../lib/talkPlanWalkAsk";

describe("walkAskOf", () => {
  it("reads every measured move-on ask of theirs as one", () => {
    const said = [
      "Cool, next card please",
      "Next card, please",
      "Next card please",
      "Sure, okay, next card please",
      "That works for me. Next card please",
      "Okay. Um, Um, yeah, right, so, next card please",
      "So, uh, I think, next card please",
      "ase. Right, that one was a lot. Um, Anyway, next card, please",
      "Uh, no, take me to the next card",
      "[cough ] Um, nah, done with it. Get us on to the next queue card",
      "Okay, then take us on to the next card",
      "and get me to the next one",
      ", I suppose, file this card away, bring bring us to the next one",
      "no, no, um, that's fine, let's go on to next cue card",
      "ishing this next summary and we could move on to next card",
    ];
    expect(said.length).toBeGreaterThan(0);
    expect(said.filter((text) => !walkAskOf({ text }))).toEqual([]);
  });

  it("refuses words that only mention the next card, ask about it, or end on something else", () => {
    const notAsks = [
      "the next card asks about backups",
      "Is that the next one?",
      "what's on the next card",
      "I've just opened the next one. If you want to take a look",
      "next card please, but first tell me what this one said",
      "next card and the one after that",
      "tell me about the next card",
      "not the next one",
      "I will answer the next one",
      "...",
      "",
    ];
    expect(notAsks.length).toBeGreaterThan(0);
    expect(notAsks.filter((text) => walkAskOf({ text }))).toEqual([]);
  });

  // A polite request transcribes with a "?", and the matcher already takes its words.
  it("reads a polite request ending on a question mark as the ask, and no other question", () => {
    const polite = [
      "Could you please take me to the next card?",
      "Okay, can you open the next one?",
      "Are we finished? Next card please",
      "Keep this one - next card please",
      "Mm-hm, next card please",
    ];
    const questions = [
      "What's the next card?",
      "Is the next one ready?",
      "Next card?",
      "We could move on to the next one?",
    ];
    expect(polite.filter((text) => !walkAskOf({ text }))).toEqual([]);
    expect(questions.filter((text) => walkAskOf({ text }))).toEqual([]);
  });
});
