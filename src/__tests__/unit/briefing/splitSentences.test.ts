/**
 * `splitSentences`, which turns a generated paragraph into the list of one-sentence bullets a fold reads best
 * as. The per-item cap it was written against came off; the shape stayed,
 * so the property below is what the function is now FOR rather than how it satisfied a gate.
 *
 * That property is not "it splits sentences" but that it splits on the SAME boundary `sentenceCount` counts
 * on. A splitter with its own opinion emits items that count as two, which is a defect nothing else on the
 * page would report — so every case here asserts the split and the count together.
 */
import { describe, expect, it } from "vitest";

import { sentenceCount, splitSentences } from "../../../briefing/sentences.js";

/** The largest sentence count any one of `text`'s split parts carries. */
function worstItem({ text }: { text: string }): number {
  return Math.max(0, ...splitSentences({ text }).map((part) => sentenceCount({ text: part })));
}

describe("splitSentences", () => {
  it("splits on the terminator and keeps it, dropping the space between", () => {
    expect(splitSentences({ text: "It landed. Then it did not. And it went out." })).toEqual([
      "It landed.",
      "Then it did not.",
      "And it went out.",
    ]);
  });

  it("gives every part exactly the one sentence the fold's list-item cap admits", () => {
    const generated =
      "A pull request you opened in acme/widgets. Its title is the line above. " +
      "It is the bottom of a stack of 6 and carries the stack's only review ask; " +
      "acme/widgets#16341, acme/widgets#16378 wait behind it until it lands.";

    expect(sentenceCount({ text: generated })).toBe(3);
    expect(splitSentences({ text: generated }).length).toBe(3);
    expect(worstItem({ text: generated })).toBe(1);
  });

  it("returns text carrying no terminator as one part, so a caller never meets an empty list", () => {
    expect(splitSentences({ text: "GitHub already has a review request out to platform" })).toEqual([
      "GitHub already has a review request out to platform",
    ]);
  });

  it("returns nothing at all for the empty string", () => {
    expect(splitSentences({ text: "" })).toEqual([]);
    expect(splitSentences({ text: "   " })).toEqual([]);
  });

  it("keeps a multi-mark terminator whole rather than splitting inside it", () => {
    expect(splitSentences({ text: "Did it land?! It did." })).toEqual(["Did it land?!", "It did."]);
  });

  it("does not split on a full stop inside a reference, which carries no following space", () => {
    expect(splitSentences({ text: "It reads acme/widgets#16341.2 and then stops. Nothing else." })).toEqual([
      "It reads acme/widgets#16341.2 and then stops.",
      "Nothing else.",
    ]);
  });
});
