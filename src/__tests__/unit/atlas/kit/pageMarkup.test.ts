/**
 * The pieces every atlas page section is built from: that provider text is escaped where it enters, that markup
 * a section already rendered passes through untouched, and that only a web URL ever becomes something to click.
 */
import { describe, expect, it } from "vitest";

import { cell, codeCell, details, linkCell, scrollTable } from "../../../../atlas/kit/pageMarkup.js";

describe("cell", () => {
  it("escapes provider text so it cannot open a tag", () => {
    expect(cell({ value: "<b>a&b</b>" })).toBe("<td>&lt;b&gt;a&amp;b&lt;/b&gt;</td>");
  });
});

describe("codeCell", () => {
  it("escapes provider text inside a monospace run, quotes included", () => {
    expect(codeCell({ value: `'x"` })).toBe("<td><code>&#39;x&quot;</code></td>");
  });
});

describe("linkCell", () => {
  it("prints an em dash when there is no link", () => {
    expect(linkCell({ href: null })).toBe('<td class="muted">—</td>');
  });

  it.each([
    { href: "https://example.test/x", safe: "https://example.test/x" },
    { href: "http://example.test/?a=1&b=2", safe: "http://example.test/?a=1&amp;b=2" },
  ])("links the web URL $href, escaped", ({ href, safe }) => {
    expect(linkCell({ href })).toBe(`<td><a href="${safe}" rel="noreferrer">open</a></td>`);
  });

  it.each([
    { href: "javascript:alert(1)", safe: "javascript:alert(1)" },
    { href: "data:text/html,<script>", safe: "data:text/html,&lt;script&gt;" },
    { href: "not a url", safe: "not a url" },
  ])("prints $href as text and never as an href", ({ href, safe }) => {
    expect(linkCell({ href })).toBe(
      `<td class="muted" title="not a web URL, so it is printed rather than linked"><code>${safe}</code></td>`,
    );
  });
});

describe("scrollTable", () => {
  it("escapes the headings and passes the rendered rows through", () => {
    expect(scrollTable({ head: ["a&b"], rows: ["<tr><td>x</td></tr>", "<tr><td>y</td></tr>"] })).toBe(
      '<div class="scroll"><table><thead><tr><th>a&amp;b</th></tr></thead>' +
        "<tbody><tr><td>x</td></tr><tr><td>y</td></tr></tbody></table></div>",
    );
  });
});

describe("details", () => {
  it("stays shut unless asked, escaping the summary and passing the body through", () => {
    expect(details({ body: "<p>x</p>", open: false, summary: "a<b" })).toBe(
      "<details><summary>a&lt;b</summary><p>x</p></details>",
    );
  });

  it("opens when asked", () => {
    expect(details({ body: "", open: true, summary: "s" })).toBe("<details open><summary>s</summary></details>");
  });
});
