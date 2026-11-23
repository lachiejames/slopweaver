/**
 * Control-byte sanitisation, and the density judgement that decides prose from blob.
 *
 * The boundary cases here are the point rather than the coverage: the previous rule was "contains a NUL ⇒
 * binary", which threw away a whole real file for one stray byte, and the fix is only correct if a genuine
 * blob is STILL refused. Both halves are asserted.
 */
import { describe, expect, it } from "vitest";

import {
  BINARY_MIN_CONTROL,
  countControlBytes,
  countReplacementChars,
  looksBinary,
  stripControlBytes,
} from "../../../corpus/sanitise.js";

/** `n` control characters, as one string — built by code point so no control byte sits in this source file. */
function controls({ n }: { n: number }): string {
  return String.fromCharCode(0x1b).repeat(n);
}

describe("stripControlBytes", () => {
  it("removes an ANSI escape and reports how many characters went", () => {
    const result = stripControlBytes({ text: `red${String.fromCharCode(0x1b)}[31mtext` });
    expect(result.text).toBe("red[31mtext");
    expect(result.removed).toBe(1);
  });

  it("keeps tab, newline and carriage return, which carry a document's shape", () => {
    const result = stripControlBytes({ text: "a\tb\nc\rd" });
    expect(result.text).toBe("a\tb\nc\rd");
    expect(result.removed).toBe(0);
  });

  it("removes DEL", () => {
    expect(stripControlBytes({ text: `a${String.fromCharCode(0x7f)}b` }).text).toBe("ab");
  });

  it("leaves everything above U+007F alone — emoji, accents and CJK are content", () => {
    const text = "café 🎯 世界 — em dash";
    expect(stripControlBytes({ text }).text).toBe(text);
  });

  it("returns an empty string unchanged", () => {
    expect(stripControlBytes({ text: "" })).toEqual({ removed: 0, text: "" });
  });
});

describe("countControlBytes", () => {
  it("counts only the strippable controls", () => {
    expect(countControlBytes({ text: `a\tb\n${controls({ n: 3 })}` })).toBe(3);
  });

  it("is zero for clean prose", () => {
    expect(countControlBytes({ text: "an idea — restated, again" })).toBe(0);
  });
});

describe("countReplacementChars", () => {
  it("counts U+FFFD, which marks content a decode already lost", () => {
    expect(countReplacementChars({ text: `a${String.fromCharCode(0xfffd)}b${String.fromCharCode(0xfffd)}` })).toBe(2);
  });

  it("does not remove them — the loss is reported, never hidden", () => {
    const text = `a${String.fromCharCode(0xfffd)}b`;
    expect(stripControlBytes({ text }).text).toBe(text);
  });
});

describe("looksBinary", () => {
  // The behaviour change this module exists for. Under the old "contains a NUL" rule this was `true` and the
  // whole file was discarded; 239 lines of real prose were lost that way.
  it("passes a prose file carrying ONE stray NUL", () => {
    const prose = `${"a long line of real writing. ".repeat(20)}${String.fromCharCode(0)}and more prose`;
    expect(looksBinary({ text: prose })).toBe(false);
  });

  it("refuses a blob, where control bytes are dense", () => {
    expect(looksBinary({ text: controls({ n: 400 }) })).toBe(true);
  });

  it("passes prose with unusual punctuation", () => {
    expect(looksBinary({ text: "an idea — restated, again" })).toBe(false);
  });

  it("passes an empty string rather than dividing by zero", () => {
    expect(looksBinary({ text: "" })).toBe(false);
  });

  // Both conditions must fire. A short string that is ALL control bytes is over the ratio but under the
  // count floor, and calling it binary is what would make one bad byte in a short note fatal again.
  it("does not call a short string binary on ratio alone", () => {
    expect(looksBinary({ text: controls({ n: BINARY_MIN_CONTROL - 1 }) })).toBe(false);
  });

  // And the mirror: over the count floor but far under the ratio, which is a big document with a handful of
  // escapes in it — exactly the GitHub comments measured in the real corpus.
  it("does not call a long document binary for a handful of escapes", () => {
    const text = `${"real prose. ".repeat(5000)}${controls({ n: BINARY_MIN_CONTROL + 2 })}`;
    expect(looksBinary({ text })).toBe(false);
  });
});
