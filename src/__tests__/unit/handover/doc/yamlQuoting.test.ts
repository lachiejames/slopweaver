import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";

describe("a flat scalar's YAML quoting is not part of its value", () => {
  it("unquotes a double-quoted summary, which is how every summary carrying a colon is written", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", 'summary: "landed: #445, and the pool held"', "---"].join("\n"),
    });

    expect(parsed.summary).toBe("landed: #445, and the pool held");
  });

  it("unescapes an inner double quote rather than leaving the backslash in the value", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", 'summary: "Ana said \\"ship it\\" and left"', "---"].join("\n"),
    });

    expect(parsed.summary).toBe('Ana said "ship it" and left');
  });

  it("unquotes a single-quoted scalar, and un-doubles the escape YAML spells that way", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", "summary: 'it''s green'", "---"].join("\n"),
    });

    expect(parsed.summary).toBe("it's green");
  });

  it("leaves a plain scalar exactly as written, quotes being absent rather than stripped", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", "summary: the pool held", "---"].join("\n"),
    });

    expect(parsed.summary).toBe("the pool held");
  });

  it("keeps a quote that opens the value without closing it — that is one character of the text", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", 'summary: "the pool held', "---"].join("\n"),
    });

    expect(parsed.summary).toBe('"the pool held');
  });

  it("reads an empty quoted scalar as ABSENT, exactly as an empty plain one is", () => {
    const parsed = parseHandoverDoc({
      path: "/h/a-thing.md",
      text: ["---", "slug: a-thing", 'summary: ""', "---"].join("\n"),
    });

    expect(parsed.summary).toBeUndefined();
  });
});
