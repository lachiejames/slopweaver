import { describe, expect, it } from "vitest";

import {
  type EvidenceContent,
  escapeMd,
  parseEvidenceContent,
  parseInlineContent,
  renderContent,
  renderEvidenceContent,
  topLevelIndexOf,
} from "../../../../outbound/github/authoringInline.js";
import type { Content } from "../../../../outbound/github/types.js";

describe("the authoring file's inline grammar", () => {
  it("round-trips every inline kind through render and parse", () => {
    const content: Content = [
      { kind: "text", text: "Plain [bracketed] * text, " },
      { kind: "strong", text: "bold" },
      { kind: "text", text: " then " },
      { kind: "code", text: "renderContent" },
      { kind: "text", text: " and " },
      { kind: "link", text: "a link", url: "https://example.com/x" },
      { kind: "text", text: " and " },
      { kind: "em", text: "emphasis" },
    ];
    expect(parseInlineContent({ source: renderContent({ content }) })).toStrictEqual({ content });
  });

  it.each([
    "https://en.wikipedia.org/wiki/Foo_(bar)",
    "https://x.test/a)b",
    "https://x.test/a(b",
    "https://x.test/a\\(b",
  ])("round-trips the url %s whole", (url) => {
    const content: Content = [{ kind: "link", text: "see", url }];
    expect(parseInlineContent({ source: renderContent({ content }) })).toStrictEqual({ content });
  });

  it("reads a hand-typed url carrying one balanced pair of parentheses whole", () => {
    expect(parseInlineContent({ source: "[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) then" })).toStrictEqual({
      content: [
        { kind: "link", text: "Foo", url: "https://en.wikipedia.org/wiki/Foo_(bar)" },
        { kind: "text", text: " then" },
      ],
    });
  });

  it("escapes every character the grammar gives meaning to", () => {
    expect(escapeMd({ text: "a*b`c[d]e\\f" })).toBe("a\\*b\\`c\\[d\\]e\\\\f");
  });

  it("declines an empty section rather than reading it as no content", () => {
    expect(parseInlineContent({ source: "" })).toStrictEqual({
      error: "this section is empty — it must contain at least some text",
    });
  });

  it("refuses `![alt](url)` outside evidence, naming where an image goes", () => {
    expect(parseInlineContent({ source: "The panel. ![a](https://x.test/i)" })).toStrictEqual({
      error:
        "an `![alt](url)` image belongs only in an evidence field, where it renders as the picture: a " +
        "`## Before and after` evidence line, the `## Click-through` destination, a `- proven:` claim's evidence " +
        "in `## Other claims`, or a `## Proof` line. Move the screenshot to the claim it proves rather than linking it here",
    });
  });

  it("escapes a `!` before a link, so the cell reads back rather than being refused as an image", () => {
    const content: Content = [
      { kind: "text", text: "Broken!" },
      { kind: "link", text: "run", url: "https://x.test/r" },
    ];
    expect(renderContent({ content })).toBe("Broken\\![run](https://x.test/r)");
    expect(parseInlineContent({ source: renderContent({ content }) })).toStrictEqual({ content });
  });
});

describe("the evidence grammar", () => {
  it("round-trips an image run between inline runs", () => {
    const content: EvidenceContent = [
      { kind: "text", text: "after " },
      { alt: "the [new] row", kind: "image", url: "https://github.com/user-attachments/assets/abc" },
      { kind: "code", text: "x" },
    ];
    expect(parseEvidenceContent({ source: renderEvidenceContent({ content }) })).toStrictEqual({ content });
  });

  it("escapes a `!` that would otherwise turn the link after it into an image", () => {
    const content: EvidenceContent = [
      { kind: "text", text: "Broken!" },
      { kind: "link", text: "run", url: "https://x.test/r" },
    ];
    expect(renderEvidenceContent({ content })).toBe("Broken\\![run](https://x.test/r)");
    expect(parseEvidenceContent({ source: renderEvidenceContent({ content }) })).toStrictEqual({ content });
  });

  it("round-trips an image url carrying a parenthesis", () => {
    const content: EvidenceContent = [{ alt: "shot", kind: "image", url: "https://x.test/a_(1).png" }];
    expect(parseEvidenceContent({ source: renderEvidenceContent({ content }) })).toStrictEqual({ content });
  });

  it("round-trips a display width as a {width=N} suffix, after a url carrying parentheses", () => {
    const content: EvidenceContent = [
      { alt: "shot", kind: "image", url: "https://x.test/a_(1).png", width: 600 },
      { kind: "text", text: " then" },
    ];
    expect(renderEvidenceContent({ content })).toBe("![shot](https://x.test/a_\\(1\\).png){width=600} then");
    expect(parseEvidenceContent({ source: renderEvidenceContent({ content }) })).toStrictEqual({ content });
  });

  it("reads a hand-typed width after a url with one balanced pair of parentheses", () => {
    expect(parseEvidenceContent({ source: "![shot](https://x.test/a_(1).png){width=320}" })).toStrictEqual({
      content: [{ alt: "shot", kind: "image", url: "https://x.test/a_(1).png", width: 320 }],
    });
  });

  it("escapes text that opens with a brace right after an image, so it never reads back as a width", () => {
    const content: EvidenceContent = [
      { alt: "shot", kind: "image", url: "https://x.test/i" },
      { kind: "text", text: "{width=5} is literal" },
    ];
    expect(renderEvidenceContent({ content })).toBe("![shot](https://x.test/i)\\{width=5} is literal");
    expect(parseEvidenceContent({ source: renderEvidenceContent({ content }) })).toStrictEqual({ content });
  });

  it("refuses a width that is not a whole number of pixels", () => {
    expect(parseEvidenceContent({ source: "![shot](https://x.test/i){width=50%}" })).toStrictEqual({
      error: "an image's `{width=N}` takes a whole number of pixels, such as `{width=600}`",
    });
  });

  it("declines an image with an empty alt", () => {
    expect(parseEvidenceContent({ source: "![](https://x.test/i)" })).toStrictEqual({
      error: "an `![alt](url)` image needs both a non-empty alt text and a non-empty url",
    });
  });
});

describe("topLevelIndexOf", () => {
  it("finds a separator outside every inline construct and escape", () => {
    expect(topLevelIndexOf({ separator: " — ", source: "`a — b` c \\— d — e" })).toBe(14);
  });

  it("answers -1 when the separator only sits inside a construct", () => {
    expect(topLevelIndexOf({ separator: " — ", source: "[a — b](https://x.test) and **c — d**" })).toBe(-1);
  });
});
