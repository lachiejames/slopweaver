/**
 * `richTextShape.ts` — a `rich_text` block read off disk is believed only when every node down to its leaves is one
 * this version can draw and send.
 */
import { describe, expect, it } from "vitest";

import { richTextBlockValid } from "../../../../outbound/slack/richTextShape.js";

/** A block carrying every container and every inline type the drip renderer emits. */
const WHOLE = {
  elements: [
    {
      elements: [
        { style: { bold: true, italic: false }, text: "hey ", type: "text" },
        { type: "user", user_id: "U0SETH" },
        { type: "usergroup", usergroup_id: "S0OPS" },
        { channel_id: "C0ENG", type: "channel" },
        { range: "here", type: "broadcast" },
        { range: "channel", type: "broadcast" },
        { range: "everyone", type: "broadcast" },
        { text: "the trace", type: "link", url: "https://example.com/trace" },
        { type: "link", url: "mailto:seth@example.com" },
      ],
      type: "rich_text_section",
    },
    {
      elements: [{ elements: [{ text: "one", type: "text" }], type: "rich_text_section" }],
      border: 0,
      indent: 0,
      offset: 0,
      style: "ordered",
      type: "rich_text_list",
    },
    { elements: [{ text: "quoted", type: "text" }], type: "rich_text_quote" },
  ],
  type: "rich_text",
};

/** WHOLE with its first section's children replaced. */
function withInline({ inline }: { inline: readonly unknown[] }): unknown {
  return { ...WHOLE, elements: [{ elements: inline, type: "rich_text_section" }] };
}

describe("richTextBlockValid", () => {
  it("reads a block whose every node is whole", () => {
    expect(richTextBlockValid({ block: WHOLE })).toBe(true);
    expect(richTextBlockValid({ block: { elements: [], type: "rich_text" } })).toBe(true);
  });

  it("reads two sections only when a paragraph break parts them, as the renderer emits", () => {
    const section = ({ texts }: { texts: readonly string[] }): unknown => ({
      elements: texts.map((text) => ({ text, type: "text" })),
      type: "rich_text_section",
    });
    const block = ({ sections }: { sections: readonly unknown[] }): unknown => ({
      elements: sections,
      type: "rich_text",
    });
    const verdicts = [
      block({ sections: [section({ texts: ["one", "\n\n"] }), section({ texts: ["two"] })] }),
      block({ sections: [section({ texts: ["one"] }), section({ texts: ["\n\n", "two"] })] }),
      block({ sections: [section({ texts: ["one"] }), section({ texts: ["two"] })] }),
      block({ sections: [section({ texts: ["one", "\n"] }), section({ texts: ["two"] })] }),
    ].map((candidate) => richTextBlockValid({ block: candidate }));
    expect(verdicts).toEqual([true, true, false, false]);
  });

  it("refuses a node typed as a prototype property rather than throwing", () => {
    const names = ["constructor", "toString", "__proto__"];
    const faults = names.flatMap((type) => [
      { ...WHOLE, elements: [{ elements: [], type }] },
      withInline({ inline: [{ constructor: "x", text: "x", toString: "x", type }] }),
    ]);
    expect(faults.map((block) => richTextBlockValid({ block }))).toEqual(faults.map(() => false));
  });

  it("refuses a malformed inline element at any position", () => {
    const faults = [
      withInline({ inline: [7] }),
      withInline({ inline: [null] }),
      withInline({ inline: [{ type: "text" }] }),
      withInline({ inline: [{ type: "user" }] }),
      withInline({ inline: [{ text: "x", type: "link" }] }),
      withInline({ inline: [{ text: "x", type: "sparkle" }] }),
      // A whole date is refused too: the card would draw its fallback where Slack formats the timestamp.
      withInline({ inline: [{ fallback: "WRONG", format: "{date_short}", timestamp: 0, type: "date" }] }),
      withInline({ inline: [{ style: 42, text: "send me", type: "text" }] }),
      withInline({ inline: [{ style: { bold: "yes" }, text: "send me", type: "text" }] }),
      withInline({ inline: [{ style: { bogus: true }, text: "send me", type: "text" }] }),
      withInline({ inline: [{ style: { strike: true }, text: "send me", type: "text" }] }),
      withInline({ inline: [{ text: 7, type: "link", url: "https://example.com" }] }),
      // A broadcast at a range Slack never posts, and types the drip renderer never emits.
      withInline({ inline: [{ range: "bogus", type: "broadcast" }] }),
      withInline({ inline: [{ team_id: "T0ACME", type: "team" }] }),
      withInline({ inline: [{ name: "wave", type: "emoji" }] }),
      withInline({ inline: [{ type: "color", value: "#ff0000" }] }),
      // A style on anything but a text run: the renderer emits none, and the card would draw it plain.
      withInline({ inline: [{ style: { bold: true }, text: "docs", type: "link", url: "https://example.com" }] }),
      withInline({ inline: [{ style: { italic: true }, type: "user", user_id: "U0SETH" }] }),
      // A link with an empty label: the card draws a blank anchor where Slack shows the address.
      withInline({ inline: [{ text: "", type: "link", url: "https://example.com" }] }),
      withInline({ inline: [{ text: "two\nlines", type: "link", url: "https://example.com" }] }),
      // A link the card draws as text: a scheme it does not recognise, an upper-case one included.
      withInline({ inline: [{ text: "download", type: "link", url: "HTTPS://example.com" }] }),
      // An empty text run, which Slack refuses.
      withInline({ inline: [{ text: "", type: "text" }] }),
      // A drawn scheme with nothing Slack can post after it.
      withInline({ inline: [{ text: "click", type: "link", url: "https://" }] }),
      withInline({ inline: [{ text: "click", type: "link", url: "http:// bad host" }] }),
      withInline({ inline: [{ text: "mail", type: "link", url: "mailto:" }] }),
      withInline({ inline: [{ text: "open", type: "link", url: "slack://channel?id=C1" }] }),
      // A reference whose id Slack would refuse, which the card would still draw as a chip.
      withInline({ inline: [{ type: "user", user_id: "" }] }),
      withInline({ inline: [{ type: "user", user_id: "S0OPS" }] }),
      withInline({ inline: [{ type: "usergroup", usergroup_id: "U0SETH" }] }),
      withInline({ inline: [{ channel_id: "general", type: "channel" }] }),
      // A key the renderer never emits, which the card would drop while it rides to Slack.
      withInline({ inline: [{ text: "hi", type: "text", unsafe: true }] }),
      withInline({ inline: [{ style: { bold: true }, type: "user", user_id: "U0SETH" }] }),
      withInline({ inline: [{ text: "x", type: "user", user_id: "U0SETH" }] }),
    ];
    expect(faults.map((block) => richTextBlockValid({ block }))).toEqual(faults.map(() => false));
  });

  it("reads only the line breaks the drip renderer emits, which the card draws as Slack does (thirty-third pass)", () => {
    const list = {
      elements: [{ elements: [{ text: "one", type: "text" }], type: "rich_text_section" }],
      style: "bullet",
      type: "rich_text_list",
    };
    const after = ({ text }: { text: string }): unknown => ({
      elements: [{ text, type: "text" }],
      type: "rich_text_section",
    });
    const blockOf = ({ elements }: { elements: readonly unknown[] }): unknown => ({ elements, type: "rich_text" });
    const read = [
      withInline({ inline: [{ text: "lead\n\n", type: "text" }] }),
      withInline({ inline: [{ text: "one\n\ntwo", type: "text" }] }),
      blockOf({ elements: [list, after({ text: "\nafter the list" })] }),
    ];
    const faults = [
      withInline({ inline: [{ text: "hello\nworld", type: "text" }] }),
      withInline({ inline: [{ text: "one\n\n\ntwo", type: "text" }] }),
      withInline({ inline: [{ text: "\nnot after a list", type: "text" }] }),
      blockOf({ elements: [list, after({ text: "\nafter\nthe list" })] }),
      blockOf({
        elements: [
          list,
          {
            elements: [
              { text: "x", type: "text" },
              { text: "\nsecond", type: "text" },
            ],
            type: "rich_text_section",
          },
        ],
      }),
    ];
    expect(read.map((block) => richTextBlockValid({ block }))).toEqual([true, true, true]);
    expect(faults.map((block) => richTextBlockValid({ block }))).toEqual(faults.map(() => false));
  });

  it("refuses a malformed container, a list of anything but sections, and a wrong outer block", () => {
    const run = { text: "x", type: "text" };
    const section = { elements: [run], type: "rich_text_section" };
    const faults = [
      { elements: [7], type: "rich_text" },
      { elements: [{ type: "rich_text_section" }], type: "rich_text" },
      { elements: [{ elements: [run], type: "rich_text_table" }], type: "rich_text" },
      { elements: [{ elements: [run], style: "bullet", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ elements: [section], type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ elements: [section], style: "bogus", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ elements: [section], offset: "2", style: "ordered", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ border: "1", elements: [run], type: "rich_text_quote" }], type: "rich_text" },
      // Nesting and a border are whole but undrawn by the card, so a candidate carrying either would draw unlike Slack.
      { elements: [{ elements: [section], indent: 1, style: "bullet", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ border: 1, elements: [run], type: "rich_text_quote" }], type: "rich_text" },
      { elements: [section], type: "section" },
      { type: "rich_text" },
      { block_id: "b1", elements: [section], type: "rich_text" },
      { elements: [{ elements: [run], extra: 1, type: "rich_text_section" }], type: "rich_text" },
      // A key on a container that never carries it, which the card would drop.
      { elements: [{ elements: [run], style: "future-format", type: "rich_text_section" }], type: "rich_text" },
      { elements: [{ elements: [run], offset: 0, type: "rich_text_quote" }], type: "rich_text" },
      // An empty container draws a blank line its payload's text does not carry.
      { elements: [{ elements: [], type: "rich_text_section" }], type: "rich_text" },
      { elements: [{ elements: [], style: "bullet", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ elements: [], type: "rich_text_quote" }], type: "rich_text" },
      // A list offset that is not a count reads differently once listed.
      {
        elements: [{ elements: [section], offset: Infinity, style: "ordered", type: "rich_text_list" }],
        type: "rich_text",
      },
      { elements: [{ elements: [section], offset: 1.5, style: "ordered", type: "rich_text_list" }], type: "rich_text" },
      { elements: [{ elements: [section], offset: -1, style: "ordered", type: "rich_text_list" }], type: "rich_text" },
    ];
    const counted = { elements: [section], offset: 2, style: "ordered", type: "rich_text_list" };
    expect(richTextBlockValid({ block: { elements: [counted], type: "rich_text" } })).toBe(true);
    expect(richTextBlockValid({ block: { elements: [section], type: "rich_text" } })).toBe(true);
    expect(faults.map((block) => richTextBlockValid({ block }))).toEqual(faults.map(() => false));
  });
});
