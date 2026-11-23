import { describe, expect, it } from "vitest";

import { chunkText } from "../../../corpus/chunkText.js";

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText({ text: "" })).toEqual([]);
    expect(chunkText({ text: "  \n\n \t " })).toEqual([]);
  });

  it("trims the body and keeps single newlines inside a paragraph", () => {
    expect(chunkText({ text: "\n  line-alpha\nline-bravo  \n" })).toEqual(["line-alpha\nline-bravo"]);
  });

  it("keeps a candidate exactly at the cap in one chunk", () => {
    expect(chunkText({ maxChars: 10, text: "abcd\n\nefgh" })).toEqual(["abcd\n\nefgh"]);
  });

  it("starts a new chunk with the paragraph that pushes the candidate past the cap", () => {
    expect(chunkText({ maxChars: 10, text: "abcd\n\nefghi\n\njk\n\nlm" })).toEqual(["abcd", "efghi\n\njk", "lm"]);
  });

  it("keeps a paragraph longer than the soft cap whole, since paragraph boundaries win", () => {
    expect(chunkText({ maxChars: 5, text: "ab\n\nlonger-than-five\n\ncd" })).toEqual(["ab", "longer-than-five", "cd"]);
  });

  it("normalises three or more blank lines to the two-newline paragraph join", () => {
    expect(chunkText({ text: "alpha\n\n\n\n\nbravo" })).toEqual(["alpha\n\nbravo"]);
  });

  it("does not split on a line holding only spaces, which is not a run of newlines", () => {
    expect(chunkText({ maxChars: 3, text: "ab\n \ncd" })).toEqual(["ab\n \ncd"]);
  });

  it("uses a 1500-character soft cap by default", () => {
    const first = "a".repeat(1000);
    const second = "b".repeat(498);
    const third = "c";
    expect(chunkText({ text: `${first}\n\n${second}` })).toEqual([`${first}\n\n${second}`]);
    expect(chunkText({ text: `${first}\n\n${second}c\n\n${third}` })).toEqual([first, `${second}c\n\n${third}`]);
  });
});
