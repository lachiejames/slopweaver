/**
 * The two vetoes on the owner's words landing on a card: a hand step never takes words, and greeting or filler never answers
 * anything — while an answer sharing no word with its card, and bare assent, still land.
 */
import { describe, expect, it } from "vitest";

import { cardAnswerRefusal, cardAnswerVerdict, isOnlyFiller } from "../../../talk/cardAnswer.js";
import { CardLandingErrors } from "../../../talk/cardLandingErrors.js";

const ASK = "ask:owner-steer-console-call-5a50c50e-01-56z-01";
const HAND = "hand:twilio-and-knock-read-only-keys";

describe("isOnlyFiller", () => {
  it.each([
    ["Uh, good morning"],
    ["Um, but, where was I, um"],
    ["[chuckle]"],
    ["[chuckle"],
    ["GOOD MORNING!"],
    ["Hey there… so, anyway"],
    ["Hmm. Let me think."],
    ["Good day"],
    ["G'day, how are you going?"],
    ["Yo, what's up"],
    [""],
  ])("%j is nothing but greeting, hesitation or noise", (words) => {
    expect(isOnlyFiller({ words })).toBe(true);
  });

  it.each([
    ["yes, go ahead"],
    ["send it"],
    ["drop that one"],
    ["option B"],
    ["Okay"],
    ["Okay, send it"],
    ["Huh. Right."],
    ["good"],
    ["Good morning, send it"],
    ["How are you going with the deploy"],
    // A one-word reply that is a connective or a time of day can be the whole answer.
    ["AND."],
    ["So."],
    ["Morning."],
    ["Uh, evening"],
  ])("%j carries a word that could answer a card", (words) => {
    expect(isOnlyFiller({ words })).toBe(false);
  });
});

describe("cardAnswerVerdict", () => {
  it("lands an answer sharing no word with its card", () => {
    expect(cardAnswerVerdict({ cardKey: ASK, words: "yes, go ahead" })).toEqual({ kind: "land" });
  });

  it("skips the greeting that took a hand step off the owner's queue, on any card", () => {
    expect(cardAnswerVerdict({ cardKey: ASK, words: "Uh, good morning" })).toEqual({
      kind: "skip",
      reason: "not-an-answer",
      why: `"Uh, good morning" is a greeting or filler, never an answer to ${ASK}`,
    });
  });

  it("skips every word on a hand step, an answer included", () => {
    expect(cardAnswerVerdict({ cardKey: HAND, words: "yes, go ahead" })).toEqual({
      kind: "skip",
      reason: "hand-step",
      why: `${HAND} is a step only the owner's hands take: it settles when the step is done, never on words said with it open`,
    });
  });
});

describe("cardAnswerRefusal", () => {
  it("is nothing for words that may land", () => {
    expect(cardAnswerRefusal({ cardKey: ASK, words: "yes, go ahead" })).toBe(undefined);
  });

  it("is the factory's NOT_AN_ANSWER for a hand step, carrying the verdict's reason", () => {
    expect(cardAnswerRefusal({ cardKey: HAND, words: "yes, go ahead" })).toEqual(
      CardLandingErrors.notAnAnswer({
        cardKey: HAND,
        reason: "hand-step",
        why: `${HAND} is a step only the owner's hands take: it settles when the step is done, never on words said with it open`,
      }),
    );
  });
});
