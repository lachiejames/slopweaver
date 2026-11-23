import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  anyLineMatches,
  checkSingleLine,
  checkStructuralEscapes,
  FENCE_LINE,
  hasLineBreak,
  hasRawHtml,
  RAW_HTML_CORRECTION,
} from "../../../../outbound/linear/structuralEscapes.js";

/** Every line ending Linear's reader splits on, as code points. */
const LINE_ENDINGS = [0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029];

/** One field refined by the structural checks, so a test reads the refusal paths it raised. */
const escapeField = z.string().superRefine((text, ctx) => {
  checkStructuralEscapes({ ctx, path: ["body"], text });
});

/** One field refined by the one-line check. */
const singleLineField = z.string().superRefine((text, ctx) => {
  checkSingleLine({ ctx, path: ["title"], text, what: "fold title" });
});

describe("hasLineBreak", () => {
  it("answers true for every line ending Linear honours, CRLF included", () => {
    const texts = [...LINE_ENDINGS.map((code) => `a${String.fromCodePoint(code)}b`), "a\r\nb"];
    expect(texts.map((text) => hasLineBreak({ text }))).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("answers false for one line, a tab and the empty string", () => {
    expect([hasLineBreak({ text: "one line" }), hasLineBreak({ text: "a\tb" }), hasLineBreak({ text: "" })]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("anyLineMatches", () => {
  it("finds a fence that starts a line after every line ending", () => {
    const texts = LINE_ENDINGS.map((code) => `prose${String.fromCodePoint(code)}\`\`\`ts`);
    expect(texts.map((text) => anyLineMatches({ pattern: FENCE_LINE, text }))).toEqual(LINE_ENDINGS.map(() => true));
  });

  it("does not match a fence written inline, mid-line", () => {
    expect(anyLineMatches({ pattern: FENCE_LINE, text: "use ``` to fence code" })).toBe(false);
  });
});

describe("checkStructuralEscapes", () => {
  it("refuses a +++ delimiter hidden behind a vertical tab", () => {
    const result = escapeField.safeParse("before\v+++ Injected");
    expect(result.error!.issues.map((issue) => issue.message.slice(0, 26))).toEqual(['a line beginning with "+++']);
  });

  it("refuses a heading opened after a form feed and a bare ###", () => {
    const messages = ["before\f## Escape", "###"].map((text) =>
      escapeField.safeParse(text).error!.issues[0]!.message.slice(0, 24),
    );
    expect(messages).toEqual(['a line beginning with "#', 'a line beginning with "#']);
  });

  it("passes inline +++ and # in ordinary prose", () => {
    expect(escapeField.safeParse("foo +++ bar, issue #12").success).toBe(true);
  });

  it("refuses an unterminated HTML comment at the field's own path, with the raw-HTML correction", () => {
    const result = escapeField.safeParse("<!--");
    expect(result.error!.issues.map((issue) => [issue.path, issue.message])).toEqual([[["body"], RAW_HTML_CORRECTION]]);
  });
});

describe("hasRawHtml", () => {
  it("answers true for an HTML block, an open element and inline tags", () => {
    const texts = ["<!--", "<!-- note -->", "<div>", "prose\n<details>", "a <b>bold</b> word", "x <span hidden>y"];
    expect(texts.map((text) => hasRawHtml({ text }))).toEqual([true, true, true, true, true, true]);
  });

  it("answers true for a comment left open mid-line, which a later field's `-->` would complete", () => {
    expect(["foo <!--", "Ship <!-- later", "a\n<!-- b"].map((text) => hasRawHtml({ text }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("answers true for an indented tag, which is code alone but inline HTML after `+++ ` or `- `", () => {
    expect(hasRawHtml({ text: "    <b>x</b>" })).toBe(true);
  });

  it("answers true for a tab-indented open comment, an HTML block once `- ` or a nested indent moves its tab stop", () => {
    expect(["\t<!--", "a\n\t<!--", "  \t<!--"].map((text) => hasRawHtml({ text }))).toEqual([true, true, true]);
  });

  it("answers false for an open comment quoted in a code span, and an email autolink", () => {
    expect([hasRawHtml({ text: "write `<!--` to open" }), hasRawHtml({ text: "mail <a@example.test>" })]).toEqual([
      false,
      false,
    ]);
  });

  it("answers false for markup in a code span, a comparison, an autolink and plain prose", () => {
    const texts = ["the type `Array<string>`", "a < b and c > d", "see <https://example.test/a>", "<5ms p99", ""];
    expect(texts.map((text) => hasRawHtml({ text }))).toEqual([false, false, false, false, false]);
  });
});

describe("checkSingleLine", () => {
  it("refuses a title split by NEL at the title's own path", () => {
    const result = singleLineField.safeParse("Rollout\x85plan");
    expect(result.error!.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["title"], "a fold title renders as ONE line, so an embedded newline would break out of it. Split it into two."],
    ]);
  });

  it("passes a title on one line", () => {
    expect(singleLineField.safeParse("Rollout plan").success).toBe(true);
  });
});
