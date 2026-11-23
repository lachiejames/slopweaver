/**
 * `draftApprovalWords.ts` direct: the two closed vocabularies a draft approval reads the owner's words against — a
 * take-back, and a yes, which an unruled relay or a card landing must carry (keep-export row).
 */
import { describe, expect, it } from "vitest";

import {
  affirmativeActWhy,
  carriesAffirmative,
  carriesTakeBack,
} from "../../../../../cli/commands/slack/draftApprovalWords.js";

/** A remark of the keep-export row's shape: a question about the card, with no yes in it. */
const REMARK_WITH_THE_CARD_OPEN = "Hm, who's Tobias again? Is that the one from the payments thread?";

describe("affirmativeActWhy and carriesAffirmative", () => {
  it("reads a yes as whole words whatever the case and punctuation", () => {
    expect(
      [
        "YES.",
        "yep!",
        "Okay, go ahead",
        "lgtm",
        "send it out",
        "that works for me",
        "Good to go",
        "Knock yourself out",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("reads no yes in a remark, inside a longer word, in a bare send or good, or in bare filler", () => {
    expect(
      [
        REMARK_WITH_THE_CARD_OPEN,
        "yesterday's thread",
        "who did we send the last one to",
        "good question",
        "Okay, who's Tobias?",
        "sure, but who's Tobias",
        "fine",
        "great",
        "perfect",
        "",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });

  it("reads no yes in a question that holds a yes phrase, marked or opened as one", () => {
    expect(
      [
        "Should we send it to Tobias?",
        "should we send it to tobias",
        "Can you post it in the other channel",
        "Who said yes to this?",
        "Does it look good to you?",
        "Yes? Is this the one",
        // An unpunctuated question on `it`.
        "Is it good to go",
        "does it look good",
        "is that good to go",
        // An auxiliary opener asks whatever its subject.
        "Should Tobias send it",
        "can the team ship it",
        // Filler before the opener.
        "So, should we send it",
        "okay so who approved this, send it",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([false, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it("reads a yes said beside a question, and an imperative that opens like one", () => {
    expect(
      [
        "What? Yes, send it.",
        "Who's Tobias? Never mind. Send it.",
        "Do it.",
        "Do that, ship it",
        "Have at it",
        "Will do, send it",
        "So, yeah, send it",
        "Okay.",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([true, true, true, true, true, true, true, false]);
  });

  it("reads no yes in a yes put under a condition, at either end of the sentence", () => {
    expect(
      [
        "If Tobias approves, send it.",
        "send it if Tobias's happy",
        "Yes, once the typo's fixed",
        "go ahead when Tobias's back",
        "Looks good, as long as the date is right",
        "Unless Tobias objects, ship it",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("reads a yes said in its own sentence beside a conditional one", () => {
    expect(carriesAffirmative({ text: "If you'd asked yesterday I'd have waited. Send it." })).toBe(true);
  });

  it("reads no yes in a yes somebody else gave, reported rather than said", () => {
    expect(
      [
        "Tobias said yes.",
        "she told me to send it",
        "I said yes earlier",
        "apparently it's good to go",
        // A bare "approved" reports somebody else's act.
        "Tobias approved it.",
      ].map((text) => carriesAffirmative({ text })),
    ).toEqual([false, false, false, false, false]);
  });

  it("names a reported yes", () => {
    expect(affirmativeActWhy({ text: "Tobias said yes." })).toBe(
      "the words carry a yes only as words reported, not said",
    );
  });

  it("names a yes put under a condition", () => {
    expect(affirmativeActWhy({ text: "If Tobias approves, send it." })).toBe(
      "the words carry a yes only under a condition",
    );
  });

  it("names a yes asked rather than said", () => {
    expect(affirmativeActWhy({ text: "Should we send it to Tobias?" })).toBe(
      "the words carry a yes only inside a question",
    );
    expect(affirmativeActWhy({ text: "Ought we send it" })).toBe("the words carry a yes only inside a question");
  });

  it("names a yes asked inside a quoted question with an attribution after it", () => {
    expect(affirmativeActWhy({ text: '"Send it?" they wondered.' })).toBe(
      "the words carry a yes only inside a question",
    );
    expect(affirmativeActWhy({ text: "“Send it?” they wondered." })).toBe(
      "the words carry a yes only inside a question",
    );
    expect(affirmativeActWhy({ text: '"Send it?"—they wondered.' })).toBe(
      "the words carry a yes only inside a question",
    );
    expect(affirmativeActWhy({ text: "Send it?Yes." })).toBeUndefined();
  });

  it("refuses a yes beside any negation, the conservative trade the take-back list states", () => {
    expect([affirmativeActWhy({ text: "yes, actually wait" }), affirmativeActWhy({ text: "yes, no changes" })]).toEqual(
      ["the words carry a yes beside a take-back", "the words carry a yes beside a take-back"],
    );
  });

  it("names why words are not an affirmative act, or nothing when they are one", () => {
    expect([
      affirmativeActWhy({ text: "Yep, send it." }),
      affirmativeActWhy({ text: REMARK_WITH_THE_CARD_OPEN }),
      affirmativeActWhy({ text: "yes but don't send it yet" }),
    ]).toEqual([undefined, "the words carry no yes", "the words carry a yes beside a take-back"]);
  });
});

describe("carriesTakeBack", () => {
  it.each([
    "oh wait, no, not that one",
    "No wait — park it",
    "Scratch that.",
    "never mind, leave it",
    "actually no, needs more info",
    "I take that back",
    "on second thought hold it",
    "Don't do that one",
    "no, flip that, I'll take the codex one",
    "I've changed my mind",
    // A list of whole sentences let this one through.
    "I take it back",
    "nope",
    "Nah.",
    "hmm, I wouldn't send that, don't",
    "hang on",
    // Any negative contraction, never a list of them.
    "I won't send that",
    "we can’t send this",
    "that isn't right",
    "I rescind my approval",
    "abort that send",
    "that isnʼt right",
    // A retraction verb the first list missed.
    "disregard that",
    "belay that",
    "let me reconsider",
    // Another retraction verb.
    "strike that",
  ])("hears a take-back in %j", (text) => {
    expect(carriesTakeBack({ text })).toBe(true);
  });

  it.each(["yes, send it", "what is this one about?", "nowait", "who wrote this?", "Yep, ship it", "notable, park it"])(
    "hears none in %j",
    (text) => {
      expect(carriesTakeBack({ text })).toBe(false);
    },
  );
});
