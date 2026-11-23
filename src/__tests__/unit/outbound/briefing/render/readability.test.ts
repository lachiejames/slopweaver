/*
 * Readability: a bare URL becomes a real anchor that stops before the sentence's punctuation, a fold nests inside
 * a fold, the owner's list states its own age, what landed is folded, and the alignment heading reads as a sentence.
 */
import { describe, expect, it } from "vitest";

import { checkBriefing } from "../../../../../briefing/check.js";
import { renderBriefing, renderNote, renderYourList } from "../../../../../outbound/briefing/render.js";
import { FORM, NOW_ISO, text, yourRow } from "./harness.js";

describe("readability: links, option lists, nested folds and an honest read time", () => {
  it("turns a bare URL in a text run into a real anchor, keeping the visible text identical", () => {
    const html = renderNote({
      note: { headline: text({ value: "see https://claude.ai/code/artifact/0dc1a3db for the ranking" }) },
    });

    expect(html).toContain(
      'see <a class="raw" href="https://claude.ai/code/artifact/0dc1a3db">https://claude.ai/code/artifact/0dc1a3db</a> for the ranking',
    );
  });

  it("stops the link before the punctuation the sentence supplies, so the href still resolves", () => {
    const html = renderNote({ note: { headline: text({ value: "at https://example.invalid/a, then more." }) } });

    expect(html).toContain('<a class="raw" href="https://example.invalid/a">https://example.invalid/a</a>, then more.');
  });

  it("leaves a URL inside a code run literal, and never nests an anchor inside a link run", () => {
    const html = renderNote({
      note: {
        headline: [
          { kind: "code", text: "https://example.invalid/a" },
          { kind: "link", text: "https://example.invalid/b the page", url: "https://example.invalid/b" },
        ],
      },
    });

    expect(html).toContain("<code>https://example.invalid/a</code>");
    expect(html).toContain('<a href="https://example.invalid/b">https://example.invalid/b the page</a>');
  });

  it("renders a fold inside a fold as a nested details element", () => {
    const html = renderNote({
      note: {
        headline: text({ value: "The ranking." }),
        detail: {
          blocks: [
            {
              fold: { blocks: [{ content: text({ value: "The deeper detail." }), kind: "para" }], summary: "inner" },
              kind: "fold",
            },
          ],
          summary: "outer",
        },
      },
    });

    expect(html).toContain(
      "<details><summary>outer</summary><div><details><summary>inner</summary>" +
        "<div><p>The deeper detail.</p></div></details></div></details>",
    );
  });

  it("states how old the owner's list is in the summary, from the list's own read instant rather than the eyebrow's", () => {
    const lines = renderYourList({
      header: { ...FORM.header, readyIso: "2026-09-06T07:43:00.000Z", refreshedIso: "2026-09-06T07:40:00.000Z" },
      list: {
        notShown: 0,
        readIso: "2026-09-06T02:56:00.000Z",
        rows: [yourRow({ over: {} })],
        source: "session-start",
      },
    });

    expect(lines[1]).toBe(
      '  <details data-section="your-list"><summary>1 ranked rows — read 4 hours 47 minutes before this ' +
        "page was rendered</summary><div>",
    );
  });

  it("says minutes alone when the gap is under an hour", () => {
    const lines = renderYourList({
      header: { ...FORM.header, readyIso: "2026-09-06T03:14:00.000Z", refreshedIso: "2026-09-06T03:14:00.000Z" },
      list: {
        notShown: 0,
        readIso: "2026-09-06T02:56:00.000Z",
        rows: [yourRow({ over: {} })],
        source: "session-start",
      },
    });

    expect(lines[1]).toContain("read 18 minutes before this page was rendered");
  });

  it("folds what landed since the last look, so only the cards sit unfolded", () => {
    const html = renderBriefing({ form: FORM });

    expect(html).toContain('<details data-section="recent"><summary>1 landing(s) since you last looked</summary><div>');
    expect(
      checkBriefing({ applyBareRefs: true, applyFraming: true, applyVoice: true, html, nowIso: NOW_ISO, rules: [] })
        .page.unfoldedBlocks,
    ).toBe(0);
  });

  it("names the alignment section with a heading that reads as a sentence", () => {
    expect(renderBriefing({ form: FORM })).toContain('<h2 id="alignment">what the fleet is working on</h2>');
  });
});
