import { describe, expect, it } from "vitest";

import { note, pageHead, tabs, unitHtml } from "../../../../policy/diff/pageParts.js";

describe("tabs", () => {
  it("checks the first tab, counts beside a label only when given, and one panel per tab", () => {
    const html = tabs({
      entries: [
        { body: "<p>a</p>", count: "", label: "Overview" },
        { body: "<p>b</p>", count: "4", label: "Network" },
      ],
      group: "g",
    });
    expect(html).toBe(
      [
        '<div class="tabs">',
        '<input type="radio" name="g" id="g-0" checked><label for="g-0">Overview</label>',
        '<input type="radio" name="g" id="g-1"><label for="g-1">Network <span class="n">4</span></label>',
        '<section class="panel">\n<p>a</p>\n</section>',
        '<section class="panel">\n<p>b</p>\n</section>',
        "</div>",
      ].join("\n"),
    );
  });
});

describe("pageHead", () => {
  it("escapes the title and shows each tab's panel by its own rule", () => {
    const head = pageHead({ count: 2, group: "g", title: "A & B" });
    expect(head.startsWith("<title>A &amp; B</title>\n<style>")).toBe(true);
    expect(
      head.endsWith(
        "#g-0:checked~.panel:nth-of-type(1){display:block}#g-1:checked~.panel:nth-of-type(2){display:block}</style>",
      ),
    ).toBe(true);
  });
});

describe("unitHtml", () => {
  it("indents a nested list item and prints a fence from its own text, escaped", () => {
    expect(unitHtml({ inner: "x", unit: { depth: 5, kind: "item", level: 0, raw: "x" } })).toBe(
      '<div class="u li d3">x</div>',
    );
    expect(unitHtml({ inner: "ignored", unit: { depth: 0, kind: "fence", level: 0, raw: "```\na<b\n```" } })).toBe(
      '<pre class="u">```\na&lt;b\n```</pre>',
    );
  });
});

describe("note", () => {
  it("is nothing without lines, else one note holding them in order", () => {
    expect(note({ lines: [] })).toBe("");
    expect(note({ lines: ["<b>1</b>", "<b>2</b>"] })).toBe('<span class="note" role="note"><b>1</b><b>2</b></span>');
  });
});
