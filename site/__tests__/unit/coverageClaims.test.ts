import { describe, expect, it } from "vitest";

import { coverageClaimsOf } from "../../lib/coverageClaims";

describe("coverageClaimsOf", () => {
  it("picks out each sentence claiming a whole read or a total, in order", () => {
    const text =
      "I've read the whole briefing. It says the pool ran dry at noon. That covers fourteen cards. " +
      "There are eleven in total.";
    expect(coverageClaimsOf({ text })).toEqual([
      "I've read the whole briefing.",
      "That covers fourteen cards.",
      "There are eleven in total.",
    ]);
  });

  it("reads list-closing and all-of-a-number claims", () => {
    const text = "That's everything on it.\nI went through all 29 cards. Nothing else needs you.";
    expect(coverageClaimsOf({ text })).toEqual([
      "That's everything on it.",
      "I went through all 29 cards.",
      "Nothing else needs you.",
    ]);
  });

  // "from beginning to end" is a whole-read claim too, never one the hold lets pass unseen.
  it("reads a whole-read claim worded as reading from one end to the other", () => {
    const text = "I read the briefing from beginning to end. I went through it start to finish. The pool ran dry.";
    expect(coverageClaimsOf({ text })).toEqual([
      "I read the briefing from beginning to end.",
      "I went through it start to finish.",
    ]);
  });

  it("never holds a hedge, which is the honest answer the hold protects", () => {
    const text =
      "I couldn't read the whole briefing. I've only read part of the page so far. " +
      "I have not gone through all of them yet.";
    expect(coverageClaimsOf({ text })).toEqual([]);
  });

  it("answers no claim for an answer that states facts without closing a read", () => {
    expect(coverageClaimsOf({ text: "The pool ran dry at noon. Two cards are waiting on you." })).toEqual([]);
    expect(coverageClaimsOf({ text: "" })).toEqual([]);
  });
});
