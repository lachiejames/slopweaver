/**
 * The local-page rendering of a proposal: raw HTML in the draft is escaped, the renderer's own toggle and
 * table-of-contents constructs are translated, media placeholders are re-pointed beside the page, and a
 * no-intake slug is keyed on the title and the bytes. Pure: strings in, strings out.
 */
import { describe, expect, it } from "vitest";

import {
  derivedLocalPageSlug,
  escapeHtml,
  localPageMedia,
  renderProposalHtml,
} from "../../../../outbound/proposal/localPage.js";
import { TOC } from "../../../../outbound/proposal/render.js";

describe("escapeHtml", () => {
  it("escapes every character that could open a tag or close an attribute", () => {
    expect(escapeHtml({ text: `<a href="x">'&'</a>` })).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("renderProposalHtml", () => {
  it("writes the title as an escaped heading, with the icon before it", () => {
    const html = renderProposalHtml({ icon: "📝", markdown: "Body.", title: "A <b>bold</b> plan" });
    expect(html).toBe("<h1>📝 A &lt;b&gt;bold&lt;/b&gt; plan</h1>\n<p>Body.</p>");
  });

  it("writes the title alone when no icon was given", () => {
    expect(renderProposalHtml({ icon: undefined, markdown: "", title: "Plan" })).toBe("<h1>Plan</h1>\n");
  });

  it("escapes raw HTML in the body rather than passing it through", () => {
    const html = renderProposalHtml({ icon: undefined, markdown: "<script>alert(1)</script>", title: "T" });
    expect(html).toBe("<h1>T</h1>\n&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("drops the Notion table-of-contents marker", () => {
    const html = renderProposalHtml({ icon: undefined, markdown: `${TOC}\n\n## Why`, title: "T" });
    expect(html).toBe("<h1>T</h1>\n<h2>Why</h2>");
  });

  it("turns a toggle into a real details element whose body is markdown and whose summary is escaped", () => {
    const markdown = [
      "Before.",
      "",
      "<details>",
      "<summary>Risk & <cost></summary>",
      "",
      "- **one**",
      "",
      "</details>",
    ].join("\n");
    const html = renderProposalHtml({ icon: undefined, markdown, title: "T" });
    expect(html).toBe(
      "<h1>T</h1>\n<p>Before.</p>\n<details>\n<summary>Risk &amp; &lt;cost&gt;</summary>\n" +
        "<ul>\n<li><strong>one</strong></li>\n</ul>\n</details>\n",
    );
  });

  it("leaves an unclosed toggle as escaped text rather than guessing where it ends", () => {
    const html = renderProposalHtml({
      icon: undefined,
      markdown: "<details>\n<summary>S</summary>\n\nbody",
      title: "T",
    });
    expect(html).toBe("<h1>T</h1>\n&lt;details&gt;\n&lt;summary&gt;S&lt;/summary&gt;\n<p>body</p>");
  });

  it("renders a GFM table", () => {
    const html = renderProposalHtml({ icon: undefined, markdown: "| a |\n| - |\n| 1 |", title: "T" });
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });
});

describe("localPageMedia", () => {
  it("re-points an image and a document placeholder under media/, keyed by the placeholder id", () => {
    const media = localPageMedia({
      markdown: "Intro\n![Hero shot](file:./shots/hero.PNG)\n[The DPA](file:/abs/dpa.pdf)",
    });
    expect(media.copies.length).toBe(2);
    expect(media.copies[0]!.source).toBe("./shots/hero.PNG");
    expect(media.copies[0]!.relative).toMatch(/^media\/[0-9a-f]{16}\.png$/);
    expect(media.copies[1]!.source).toBe("/abs/dpa.pdf");
    expect(media.copies[1]!.relative).toMatch(/^media\/[0-9a-f]{16}\.pdf$/);
    expect(media.markdown).toBe(
      `Intro\n![Hero shot](${media.copies[0]!.relative})\n[The DPA](${media.copies[1]!.relative})`,
    );
  });

  it("leaves a body with no placeholder byte-for-byte alone", () => {
    expect(localPageMedia({ markdown: "plain ![x](https://e.invalid/a.png)" })).toEqual({
      copies: [],
      markdown: "plain ![x](https://e.invalid/a.png)",
    });
  });

  it("gives the same file placed twice two names, so neither copy overwrites the other's position", () => {
    const media = localPageMedia({ markdown: "![a](file:x.png)\n![a](file:x.png)" });
    expect(new Set(media.copies.map((copy) => copy.relative)).size).toBe(2);
  });

  it("drops an extension carrying path segments, so the name cannot walk out of media/", () => {
    const media = localPageMedia({ markdown: "![Hero](file:x.png/../../../payload)" });
    const copy = media.copies[0]!;
    expect(copy.source).toBe("x.png/../../../payload");
    expect(copy.relative).toMatch(/^media\/[^/.]+$/);
  });
});

describe("derivedLocalPageSlug", () => {
  it("slugifies the title and appends a digest of the bytes", () => {
    expect(derivedLocalPageSlug({ markdown: "body", title: "Move the Queue — to v2!" })).toMatch(
      /^proposal-move-the-queue-to-v2-[0-9a-f]{12}$/,
    );
  });

  it("keys the same bytes to the same slug and edited bytes to a new one", () => {
    const one = derivedLocalPageSlug({ markdown: "body", title: "T" });
    expect(derivedLocalPageSlug({ markdown: "body", title: "T" })).toBe(one);
    expect(derivedLocalPageSlug({ markdown: "body edited", title: "T" })).not.toBe(one);
  });

  it("falls back to the digest alone for a title with no letters or digits", () => {
    expect(derivedLocalPageSlug({ markdown: "body", title: "—!" })).toMatch(/^proposal-[0-9a-f]{12}$/);
  });

  it("caps the title stem and never ends it on a dash", () => {
    const slug = derivedLocalPageSlug({ markdown: "b", title: `${"a".repeat(47)} bcd` });
    expect(slug).toMatch(new RegExp(`^proposal-${"a".repeat(47)}-[0-9a-f]{12}$`));
  });
});
