import { describe, expect, it } from "vitest";

import { checkReactNowCards, type ReactNowCheck } from "../../../briefing/reactNowCard.js";

/** `count` plain words as one sentence, so a fixture can sit a chosen distance from a word cap. */
function sentenceOfWords({ count }: { count: number }): string {
  return `${Array.from({ length: count }, () => "alpha").join(" ")}.`;
}

/** One well-shaped react-now card, with every field overridable so a test names only what it breaks. */
function card({
  question = "1. Ship the thing, are you happy with the draft?",
  what = "The draft adds a template and a doc. It also adds an advisory check that only reports.",
  whyYou = "It is a post to the team under your name.",
  options = "A: send it as written. B: send it with edits.",
  lean = "A, on Monday morning.",
  ifSilent = "the draft stays unsent.",
}: {
  question?: string;
  what?: string;
  whyYou?: string;
  options?: string;
  lean?: string;
  ifSilent?: string;
} = {}): string {
  return (
    `<h2>react now</h2><div class="need"><div class="q">${question}</div>${AGE_LINE}` +
    `<dl class="f"><dt>what</dt><dd>${what}</dd>` +
    `<dt>why you</dt><dd>${whyYou}</dd>` +
    `<dt>options</dt><dd>${options}</dd>` +
    `<dt>lean</dt><dd>${lean}</dd>` +
    `<dt>if silent</dt><dd>${ifSilent}</dd></dl></div><h2>done</h2>`
  );
}

/** The renderer's own age line, which every card carries. */
const AGE_LINE =
  '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>';

/** The checker with the voice pass on and no private operator rules. */
function check({ html }: { html: string }): ReactNowCheck {
  return checkReactNowCards({ applyFraming: true, applyVoice: true, html, nowIso: "2026-09-12T00:00:00Z", rules: [] });
}

/** Every defect's reason, in order — the shape a cap test asserts on. */
function reasons({ result }: { result: ReactNowCheck }): readonly string[] {
  return result.defects.map((defect) => defect.reason);
}

describe("react-now card caps", () => {
  it("refuses a `what` over the word cap, naming the count and the cap", () => {
    const what = [25, 25, 25].map((count) => sentenceOfWords({ count })).join(" ");

    expect(reasons({ result: check({ html: card({ what }) }) })).toEqual([
      "75 words above the fold, over the cap of 60. Cut the background down, or move the rest into a details " +
        "fold inside the card.",
    ]);
  });

  it("accepts the same words when the excess sits inside a details fold", () => {
    const folded = `<details><summary>the long version</summary><div>${sentenceOfWords({ count: 400 })}</div></details>`;
    const what = `The draft adds a template. It also adds a check. ${folded}`;

    expect(check({ html: card({ what }) }).defects).toEqual([]);
  });

  it("refuses a `what` over the sentence cap", () => {
    expect(reasons({ result: check({ html: card({ what: "One. Two. Three. Four. Five." }) }) })).toEqual([
      "5 sentences above the fold, over the cap of 4. Keep the ones the owner has to read to decide, and fold the rest.",
    ]);
  });

  it("refuses a `why you` over the short-field word cap", () => {
    // "only you" is the warrant the card owes; the other 29 words are the filler
    // that puts the cell one word over its cap, which is what this test measures.
    const whyYou = `only you ${sentenceOfWords({ count: 29 })}`;

    expect(reasons({ result: check({ html: card({ whyYou }) }) })).toEqual([
      "31 words above the fold, over the cap of 30. Cut why you down, or move the rest into a details fold " +
        "inside the card.",
      "whyYou: one sentence is 31 authored-prose words (max 30). Split it. Technical identifiers are not " +
        "counted, so this is longer than it looks.",
    ]);
  });

  it("refuses a `why you` that runs to two sentences", () => {
    expect(reasons({ result: check({ html: card({ whyYou: "It is your call. Nobody else can make it." }) }) })).toEqual(
      [
        "2 sentences above the fold, over the cap of 1. Keep the ones the owner has to read to decide, and fold the rest.",
      ],
    );
  });

  it("refuses a `lean` over the short-field sentence cap", () => {
    expect(reasons({ result: check({ html: card({ lean: "A. Then B. Then C." }) }) })).toEqual([
      "3 sentences above the fold, over the cap of 2. Keep the ones the owner has to read to decide, and fold the rest.",
    ]);
  });

  it("refuses one option over the option word cap", () => {
    const options = `A: ${sentenceOfWords({ count: 26 })} B: hold it for now.`;

    expect(reasons({ result: check({ html: card({ options }) }) })).toEqual([
      "26 words above the fold, over the cap of 25. Cut option A down, or move the rest into a details fold " +
        "inside the card.",
    ]);
  });

  it("refuses an option that runs to two sentences", () => {
    const options = "A: send it as written. Then tell the team. B: hold it for now.";

    expect(reasons({ result: check({ html: card({ options }) }) })).toEqual([
      "option A is 2 sentences, over the cap of 1. One option, one sentence.",
    ]);
  });

  it("refuses more options than a reader can hold above the fold", () => {
    const options = ["A", "B", "C", "D", "E"].map((letter) => `${letter}: hold it for now.`).join(" ");

    expect(reasons({ result: check({ html: card({ options }) }) })).toEqual([
      "5 options, over the cap of 4. More choices than that is a design discussion, not a decision you can " +
        "react to.",
    ]);
  });

  it("refuses a card over the whole-card budget while every field is inside its own cap", () => {
    const options = ["A", "B", "C", "D"].map((letter) => `${letter}: ${sentenceOfWords({ count: 25 })}`).join(" ");
    const html = card({
      options,
      // Two of the thirty are the warrant the card owes; the count is what this test measures.
      whyYou: `only you ${sentenceOfWords({ count: 28 })}`,
      lean: sentenceOfWords({ count: 30 }),
      what: [20, 20, 18].map((count) => sentenceOfWords({ count })).join(" "),
    });

    expect(reasons({ result: check({ html }) })).toEqual([
      "the whole card is 243 words above the fold, over the cap of 200. Every field is short enough on its " +
        "own and the card still is not. Fold something.",
    ]);
  });
});
