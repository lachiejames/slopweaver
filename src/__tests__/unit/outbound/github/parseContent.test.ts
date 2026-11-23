import { describe, expect, it } from "vitest";

import { decodeAttr, decodeCell, IMG, parseContent } from "../../../../outbound/github/parseContent.js";
import type { Content } from "../../../../outbound/github/types.js";

describe("decodeCell", () => {
  it("decodes exactly one escaping layer, so a double-escaped entity comes back as the entity text", () => {
    expect(decodeCell({ text: "&amp;lt;" })).toBe("&lt;");
  });

  it("decodes the three cell entities and leaves a quote entity and a numeric entity as text", () => {
    expect(decodeCell({ text: "&lt;b&gt; &amp; &quot;x&quot; &#60;" })).toBe("<b> & &quot;x&quot; &#60;");
  });
});

describe("decodeAttr", () => {
  it("decodes the quote entity as well as the cell entities, one layer only", () => {
    expect(decodeAttr({ text: "&quot;x&quot; &lt;&gt; &amp;quot; &#34;" })).toBe('"x" <> &quot; &#34;');
  });
});

describe("parseContent", () => {
  it("recovers every run kind in order, decoding text one layer and the link URL as an attribute", () => {
    const source =
      "plain <strong>bold</strong> and <em>it</em><code>a &lt; b</code> " +
      '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">t &amp; u</a> end';
    const expected: Content = [
      { kind: "text", text: "plain " },
      { kind: "strong", text: "bold" },
      { kind: "text", text: " and " },
      { kind: "em", text: "it" },
      { kind: "code", text: "a < b" },
      { kind: "text", text: " " },
      { kind: "link", text: "t & u", url: 'https://example.com/?a=1&b="2"' },
      { kind: "text", text: " end" },
    ];
    expect(parseContent({ source })).toEqual(expected);
  });

  it("coalesces adjacent plain text, entities included, into one run", () => {
    expect(parseContent({ source: "a &amp; b &gt; c" })).toEqual([{ kind: "text", text: "a & b > c" }]);
  });

  it("leaves a quote entity in plain text undecoded", () => {
    expect(parseContent({ source: "&quot;hi&quot;" })).toEqual([{ kind: "text", text: "&quot;hi&quot;" }]);
  });

  it("decodes a double-escaped entity inside a tag to the entity text, not the character", () => {
    expect(parseContent({ source: "<code>&amp;lt;</code>" })).toEqual([{ kind: "code", text: "&lt;" }]);
  });

  it("returns undefined for an empty cell", () => {
    expect(parseContent({ source: "" })).toBe(undefined);
  });

  it("returns undefined for a tag the renderer never emits", () => {
    expect(parseContent({ source: "a <b>x</b>" })).toBe(undefined);
  });

  it("returns undefined for an unclosed inline tag and an unclosed link", () => {
    expect(parseContent({ source: "<strong>x" })).toBe(undefined);
    expect(parseContent({ source: '<a href="https://example.com">x' })).toBe(undefined);
  });
});

describe("IMG", () => {
  it("captures the source and alt text of a canonical image tag at the head of the text", () => {
    expect([...IMG.exec('<img src="a.png" alt="A chart">after')!]).toEqual([
      '<img src="a.png" alt="A chart">',
      "a.png",
      "A chart",
      undefined,
    ]);
  });

  it("captures a display width as the third group, emitted last by the renderer", () => {
    expect([...IMG.exec('<img src="a.png" alt="A chart" width="600">after')!]).toEqual([
      '<img src="a.png" alt="A chart" width="600">',
      "a.png",
      "A chart",
      "600",
    ]);
  });

  it("does not read a width written before the alt, which the renderer never emits", () => {
    expect(IMG.exec('<img src="a.png" width="600" alt="A chart">')).toBeNull();
  });

  it("refuses an image whose attributes are reordered or which does not start the text", () => {
    expect(IMG.exec('<img alt="A chart" src="a.png">')).toBe(null);
    expect(IMG.exec(' <img src="a.png" alt="A chart">')).toBe(null);
  });
});
