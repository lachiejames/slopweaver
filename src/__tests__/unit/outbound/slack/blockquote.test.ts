import type { RichTextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { quoteMarkedLines } from "../../../../outbound/slack/blockquote.js";
import { renderDrip } from "../../../../outbound/slack/dripRender.js";
import { NO_MENTIONS } from "../../../../outbound/slack/render.js";
import { payloadRenderIssues } from "../../../../outbound/slack/renderCheck.js";

describe("quoteMarkedLines", () => {
  it("quotes a marked line past its spacing gaps and leaves code, plain lines, lists and quotes alone", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: "\n", type: "text" },
            { style: { bold: true }, text: "> the quoted words", type: "text" },
            { text: " and a ", type: "text" },
            { text: "link", type: "link", url: "https://example.invalid/a" },
            { text: "\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
        {
          elements: [{ style: { code: true }, text: "> literal by request", type: "text" }],
          type: "rich_text_section",
        },
        { elements: [{ text: "an ordinary line", type: "text" }], type: "rich_text_section" },
        {
          elements: [{ elements: [{ text: "> a bullet stays a bullet", type: "text" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
        { elements: [{ text: "already a quote", type: "text" }], type: "rich_text_quote" },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block })).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "the quoted words", type: "text" },
            { text: " and a ", type: "text" },
            { text: "link", type: "link", url: "https://example.invalid/a" },
          ],
          type: "rich_text_quote",
        },
        {
          elements: [{ style: { code: true }, text: "> literal by request", type: "text" }],
          type: "rich_text_section",
        },
        { elements: [{ text: "an ordinary line", type: "text" }], type: "rich_text_section" },
        {
          elements: [{ elements: [{ text: "> a bullet stays a bullet", type: "text" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
        { elements: [{ text: "already a quote", type: "text" }], type: "rich_text_quote" },
      ],
      type: "rich_text",
    });
  });

  it("returns the very same block when no line is marked, and is idempotent once one is", () => {
    const plain: RichTextBlock = {
      elements: [{ elements: [{ text: "a > b is prose", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    };
    const marked: RichTextBlock = {
      elements: [{ elements: [{ text: "> quoted", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    };
    const once = quoteMarkedLines({ block: marked });

    expect(quoteMarkedLines({ block: plain })).toBe(plain);
    expect(quoteMarkedLines({ block: once })).toEqual(once);
  });

  it("keeps a bare marker as text rather than building an empty quote", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: "> ", type: "text" },
            { text: "\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block })).toBe(block);
  });

  it("drops the whitespace a marker leaves before a mention rather than keeping it inside the quote", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: ">   ", type: "text" },
            { type: "user", user_id: "U1" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block }).elements).toEqual([
      { elements: [{ type: "user", user_id: "U1" }], type: "rich_text_quote" },
    ]);
  });

  it("trims the whitespace at both edges of the quoted words", () => {
    const [payload] = renderDrip({
      artifact: { kind: "one-card", lines: [{ runs: [{ text: ">  quoted  ", type: "text" }] }] },
      mentions: NO_MENTIONS,
    });

    expect(JSON.stringify(payload)).toContain(
      '{"elements":[{"text":"quoted","type":"text"}],"type":"rich_text_quote"}',
    );
  });

  it("trims the leading whitespace of the run after a marker that stands alone", () => {
    const [payload] = renderDrip({
      artifact: {
        kind: "one-card",
        lines: [
          {
            runs: [
              { text: "> ", type: "text" },
              { text: "  quoted  ", type: "text" },
            ],
          },
        ],
      },
      mentions: NO_MENTIONS,
    });

    expect(JSON.stringify(payload)).toContain(
      '{"elements":[{"text":"quoted","type":"text"}],"type":"rich_text_quote"}',
    );
  });

  it("quotes a marker split across two runs, as a reader sees it joined", () => {
    const [payload] = renderDrip({
      artifact: {
        kind: "one-card",
        lines: [
          {
            runs: [
              { text: ">", type: "text" },
              { text: " quoted ", type: "text" },
            ],
          },
        ],
      },
      mentions: NO_MENTIONS,
    });

    expect(JSON.stringify(payload)).toContain(
      '{"elements":[{"text":"quoted","type":"text"}],"type":"rich_text_quote"}',
    );
  });

  it("leaves a line alone when an authored space comes before the marker", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: " ", type: "text" },
            { text: "> quoted", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block })).toBe(block);
  });

  it("carries a code span at the edge of a quote verbatim, spaces included", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: "> ", type: "text" },
            { style: { code: true }, text: "  literal  ", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block }).elements).toEqual([
      { elements: [{ style: { code: true }, text: "  literal  ", type: "text" }], type: "rich_text_quote" },
    ]);
  });

  it("looks past a CRLF line break for the marker, as it does past a bare \\n", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: "\r\n", type: "text" },
            { text: "> quoted", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block }).elements).toEqual([
      { elements: [{ text: "quoted", type: "text" }], type: "rich_text_quote" },
    ]);
  });

  it("leaves a line alone when a code span of line breaks opens it", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { style: { code: true }, text: "\n", type: "text" },
            { text: "> quoted", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block })).toBe(block);
  });

  it("leaves a line alone when a code span carries half the marker", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: ">", type: "text" },
            { style: { code: true }, text: " literal", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block })).toBe(block);
  });

  it("quotes a marker standing alone before the rest of the line", () => {
    const block: RichTextBlock = {
      elements: [
        {
          elements: [
            { text: "> ", type: "text" },
            { type: "user", user_id: "U1" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };

    expect(quoteMarkedLines({ block }).elements).toEqual([
      { elements: [{ type: "user", user_id: "U1" }], type: "rich_text_quote" },
    ]);
  });

  it("leaves a bullet opening > as text, and the render check does not report it", () => {
    const [payload] = renderDrip({
      artifact: {
        bullets: [[{ text: "> quoted-looking bullet", type: "text" }]],
        kind: "one-list",
        lead: [{ text: "Lead", type: "text" }],
        trailing: [],
      },
      mentions: NO_MENTIONS,
    });

    expect(JSON.stringify(payload)).toContain('"text":"> quoted-looking bullet"');
    expect(payloadRenderIssues({ payload: payload! })).toEqual([]);
  });
});
