/*
 * A card's detail fold, rendered inside the `what` cell: paragraphs and lists, image blocks as figures, and
 * paste blocks as a labelled copy control over the exact bytes, each escaped like every other run.
 */
import { describe, expect, it } from "vitest";

import { renderCard } from "../../../../../outbound/briefing/render.js";
import { CARD, NOW_ISO, text } from "./harness.js";

describe("the briefing renderer", () => {
  it("renders a card's detail as a details element inside the `what` cell", () => {
    const detail = {
      blocks: [
        { content: text({ value: "The long version." }), kind: "para" as const },
        { items: [text({ value: "one" }), text({ value: "two" })], kind: "list" as const, ordered: true },
      ],
      summary: "the depth",
    };

    expect(renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 })).toContain(
      "<dt>what</dt><dd>The draft adds a template and a doc. It also adds a check that only reports. " +
        "<details><summary>the depth</summary><div><p>The long version.</p><ol><li>one</li><li>two</li></ol>" +
        "</div></details></dd>",
    );
  });

  it("renders an image block as a figure carrying its alt text and, when given, a caption", () => {
    const detail = {
      blocks: [
        { content: text({ value: "As it would post." }), kind: "para" as const },
        {
          alt: "the drafted Slack post",
          caption: "screenshot 1 of 3",
          data: "data:image/png;base64,AA==",
          kind: "image" as const,
        },
      ],
      summary: "the screenshots",
    };

    expect(renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 })).toContain(
      "<p>As it would post.</p>" +
        '<figure><img src="data:image/png;base64,AA==" alt="the drafted Slack post">' +
        "<figcaption>screenshot 1 of 3</figcaption></figure>",
    );
  });

  it("omits the figcaption entirely when an image carries no caption", () => {
    const detail = {
      blocks: [{ alt: "a bare screenshot", data: "data:image/png;base64,AA==", kind: "image" as const }],
      summary: "the screenshot",
    };

    expect(renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 })).toContain(
      '<figure><img src="data:image/png;base64,AA==" alt="a bare screenshot"></figure>',
    );
  });

  it("escapes an image's alt, caption and src the same way every other run does", () => {
    const detail = {
      blocks: [
        {
          alt: 'a "quoted" alt',
          caption: "</figcaption><b>",
          data: "data:image/png;base64,AA==",
          kind: "image" as const,
        },
      ],
      summary: "s",
    };

    const html = renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 });
    expect(html).toContain('alt="a &quot;quoted&quot; alt"');
    expect(html).toContain("<figcaption>&lt;/figcaption&gt;&lt;b&gt;</figcaption>");
  });

  it("renders a paste block as a labelled copy control over a pre carrying the exact bytes", () => {
    const detail = {
      blocks: [
        { content: text({ value: "Paste this into the scopes box." }), kind: "para" as const },
        { kind: "paste" as const, label: "the 25 scopes, comma separated", text: "a/one,b/two" },
      ],
      summary: "the scopes",
    };

    expect(renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 })).toContain(
      "<p>Paste this into the scopes box.</p>" +
        '<div class="paste"><div class="paste-head">' +
        '<span class="paste-label">the 25 scopes, comma separated</span>' +
        '<button class="paste-copy" type="button">copy</button></div>' +
        "<pre>a/one,b/two</pre></div>",
    );
  });

  it("gives a paste block no id, so the chrome's one delegated listener is what wires every button", () => {
    const detail = {
      blocks: [
        { kind: "paste" as const, label: "first", text: "one" },
        { kind: "paste" as const, label: "second", text: "two" },
      ],
      summary: "two of them",
    };

    const html = renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 });
    expect(html).toContain("<pre>one</pre>");
    expect(html).toContain("<pre>two</pre>");
    expect(html.match(/<button class="paste-copy" type="button">copy<\/button>/g)!.length).toBe(2);
    expect(html).not.toContain('id="paste');
    expect(html).not.toContain("onclick");
  });

  it("escapes a paste block's label and text, so pasteable bytes can never become markup", () => {
    const detail = {
      blocks: [{ kind: "paste" as const, label: "a <b>label</b>", text: "</pre></details><script>x</script>" }],
      summary: "s",
    };

    const html = renderCard({ card: { ...CARD, detail }, nowIso: NOW_ISO, position: 1 });
    expect(html).toContain('<span class="paste-label">a &lt;b&gt;label&lt;/b&gt;</span>');
    expect(html).toContain("<pre>&lt;/pre&gt;&lt;/details&gt;&lt;script&gt;x&lt;/script&gt;</pre>");
  });
});
