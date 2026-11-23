import { describe, expect, it } from "vitest";

import { escapeAttr, escapeCell, imageTag } from "../../../../outbound/github/htmlText.js";

describe("escapeCell", () => {
  it("escapes the ampersand first so later replacements are not escaped twice", () => {
    expect(escapeCell({ text: "a & <b> &lt;" })).toBe("a &amp; &lt;b&gt; &amp;lt;");
  });

  it("leaves a double quote alone, since an element body needs no attribute escape", () => {
    expect(escapeCell({ text: 'say "hi"' })).toBe('say "hi"');
  });

  it("returns an empty string unchanged", () => {
    expect(escapeCell({ text: "" })).toBe("");
  });
});

describe("escapeAttr", () => {
  it("escapes the double quote on top of the cell escapes", () => {
    expect(escapeAttr({ text: 'a "q" <b>' })).toBe("a &quot;q&quot; &lt;b&gt;");
  });
});

describe("imageTag", () => {
  it("writes src then alt and no width when none is set", () => {
    expect(imageTag({ alt: "the page", url: "https://example.com/a.png" })).toBe(
      '<img src="https://example.com/a.png" alt="the page">',
    );
  });

  it("writes the width last when set", () => {
    expect(imageTag({ alt: "the page", url: "https://example.com/a.png", width: 640 })).toBe(
      '<img src="https://example.com/a.png" alt="the page" width="640">',
    );
  });

  it("escapes a quote in the alt so it cannot close the attribute", () => {
    expect(imageTag({ alt: 'a"b', url: "u" })).toBe('<img src="u" alt="a&quot;b">');
  });
});
