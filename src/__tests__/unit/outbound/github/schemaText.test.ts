import { describe, expect, it } from "vitest";

import { LINE_BREAK, lineText, nonBlank } from "../../../../outbound/github/schemaText.js";

describe("nonBlank", () => {
  it("accepts text with content", () => {
    expect(nonBlank().safeParse("a").success).toBe(true);
  });

  it("refuses an empty string", () => {
    expect(nonBlank().safeParse("").success).toBe(false);
  });

  it("refuses whitespace only, which renders to nothing", () => {
    const parsed = nonBlank().safeParse("  ");
    expect(parsed.error!.issues[0]!.message).toContain("must not be blank");
  });
});

describe("LINE_BREAK", () => {
  it("matches a newline, a carriage return and the Unicode line and paragraph separators", () => {
    expect(["\n", "\r", " ", " "].map((c) => LINE_BREAK.test(`a${c}b`))).toEqual([true, true, true, true]);
  });

  it("does not match a plain space", () => {
    expect(LINE_BREAK.test("a b")).toBe(false);
  });
});

describe("lineText", () => {
  it("accepts one line", () => {
    expect(lineText({ what: "A title" }).safeParse("one line").success).toBe(true);
  });

  it("refuses a newline and names what the text is", () => {
    const parsed = lineText({ what: "A title" }).safeParse("two\nlines");
    expect(parsed.error!.issues[0]!.message).toBe(
      "A title renders as ONE line, so a newline would break it. Remove it.",
    );
  });
});
