/*
 * Fitting a subject's free text onto one summary line: whitespace collapsed, cut by code point, an ellipsis only on
 * text that was cut.
 */
import { describe, expect, it } from "vitest";

import { collapseWhitespace, fitOnOneLine, printableOneLine } from "../../../lib/oneLineSummary.js";

describe("collapseWhitespace", () => {
  it("turns every whitespace run, line breaks and tabs included, into one space and trims the ends", () => {
    expect(collapseWhitespace({ text: "  a\n\nb\tc   d \n" })).toBe("a b c d");
  });

  // JavaScript's `\s` omits U+0085 NEXT LINE, which Unicode counts a line break.
  it("collapses a NEXT LINE, which JavaScript's \\s does not match", () => {
    expect(collapseWhitespace({ text: `legit${String.fromCharCode(0x85)}FORGED ROW` })).toBe("legit FORGED ROW");
  });

  it("leaves empty text empty", () => {
    expect(collapseWhitespace({ text: " \n " })).toBe("");
  });
});

describe("printableOneLine", () => {
  it("drops an ESC sequence's control byte, DEL and a C1 control, and still folds line breaks", () => {
    const text = `linear read\u001b[2JFORGED\u007f\u009b\nnext`;

    expect(printableOneLine({ text })).toBe("linear read[2JFORGED next");
  });

  it("drops a format character — a right-to-left override — and the line and paragraph separators", () => {
    // Built by code point, so this file carries none of them raw.
    const text = `acme${String.fromCharCode(0x202e)}evil${String.fromCharCode(0x2028)}two${String.fromCharCode(0x2029)}three`;

    expect(printableOneLine({ text })).toBe("acmeevil two three");
  });

  it("leaves printable text, non-ASCII included, unchanged", () => {
    expect(printableOneLine({ text: "café — 401 🔑" })).toBe("café — 401 🔑");
  });
});

describe("fitOnOneLine", () => {
  it("returns text that fits unchanged, with no ellipsis, at exactly the limit", () => {
    expect(fitOnOneLine({ maxChars: 5, text: "abcde" })).toBe("abcde");
  });

  it("cuts text one over the limit to the limit, the ellipsis included", () => {
    expect(fitOnOneLine({ maxChars: 5, text: "abcdef" })).toBe("abcd…");
  });

  it("drops trailing space left by the cut before the ellipsis", () => {
    expect(fitOnOneLine({ maxChars: 5, text: "abc defgh" })).toBe("abc…");
  });

  it("counts an emoji as one code point and never splits its surrogate pair", () => {
    expect(fitOnOneLine({ maxChars: 3, text: "🚀🚀🚀🚀" })).toBe("🚀🚀…");
  });

  it("collapses a line break before measuring, so the result is one line", () => {
    expect(fitOnOneLine({ maxChars: 20, text: "one\ntwo" })).toBe("one two");
  });
});
