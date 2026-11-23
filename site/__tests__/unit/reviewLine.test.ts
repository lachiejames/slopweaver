/*
 * The queue card's "review before sending" line: the message a held reply or an as-me post would send, flattened
 * onto one line.
 */
import { describe, expect, it } from "vitest";

import { REVIEW_LINE_CHARS, reviewLineOf } from "../../lib/reviewLine";

describe("reviewLineOf", () => {
  it("flattens line breaks and runs of spaces onto one line", () => {
    expect(reviewLineOf({ text: "Hi Daniel,\n\n  the fix is   in." })).toBe("Hi Daniel, the fix is in.");
  });

  it("has no line for a message with no words", () => {
    expect(reviewLineOf({ text: " \n\t " })).toBe(undefined);
  });

  it("keeps a message at exactly the limit whole", () => {
    const text = "a".repeat(REVIEW_LINE_CHARS);
    expect(reviewLineOf({ text })).toBe(text);
  });

  it("cuts a longer message at the last word inside the limit and marks the cut", () => {
    const text = `${"word ".repeat(40)}end`;
    const line = reviewLineOf({ text })!;
    expect(line).toBe(`${"word ".repeat(27)}word…`);
    expect(line.length).toBe(REVIEW_LINE_CHARS);
  });

  it("reads a standard shortcode as its emoji, its tone folded in (an emoji stays in its emoji form)", () => {
    expect(reviewLineOf({ text: "Shipped :tada: nice one :+1::skin-tone-3:" })).toBe("Shipped 🎉 nice one 👍🏼");
  });

  it("leaves a custom emoji, a time, a shortcode in code and a web address exactly as written", () => {
    expect(reviewLineOf({ text: ":partyparrot: at 10:30:45, run `:tada:` https://example.com/a:tada:b" })).toBe(
      ":partyparrot: at 10:30:45, run `:tada:` https://example.com/a:tada:b",
    );
  });

  it("cuts mid-word when the first word alone passes the limit", () => {
    const text = "x".repeat(REVIEW_LINE_CHARS + 10);
    expect(reviewLineOf({ text })).toBe(`${"x".repeat(REVIEW_LINE_CHARS)}…`);
  });
});
