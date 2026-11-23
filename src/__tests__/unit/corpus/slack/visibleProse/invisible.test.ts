/*
 * What carries no language emits nothing: machine-token field values, blank emoji, and text that is only invisible
 * by its Unicode property in any container, while real prose beside such a character and an oversized payload pass.
 */
import { describe, expect, it } from "vitest";

import { flattenSlackVisibleProse } from "../../../../../corpus/slack/visibleProse.js";
import { flatten, maps } from "./fixtures.js";

describe("flattenSlackVisibleProse — nothing synthetic passes for content", () => {
  it("emits nothing for an emoji with a blank name, so it cannot displace the placeholder", () => {
    const raw = {
      blocks: [
        { elements: [{ elements: [{ name: "", type: "emoji" }], type: "rich_text_section" }], type: "rich_text" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("drops an interactive field's value when it declares a type but no action id", () => {
    const raw = { attachments: [{ fields: [{ type: "button", value: "opaque-machine-token" }] }] };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("still reads a text-composition field's value", () => {
    const raw = { attachments: [{ fields: [{ title: "Environment", type: "mrkdwn", value: "production" }] }] };
    expect(flatten({ raw })).toStrictEqual(["Environment", "production"]);
  });
});

describe("flattenSlackVisibleProse — invisible and oversized payloads", () => {
  it("emits nothing for text that is only a zero-width character", () => {
    const raw = { blocks: [{ text: { text: "\u200B", type: "plain_text" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("returns rather than overflowing the stack on an attachment with a very large block array", () => {
    // A spread-argument append dies somewhere near a hundred thousand entries; `appendAll` does not.
    const blocks = Array.from({ length: 130_000 }, (_, i) => ({
      text: { text: `frag-${String(i)}`, type: "plain_text" },
      type: "section",
    }));
    const kept = flattenSlackVisibleProse({ dedupeAgainst: [], maps, raw: { attachments: [{ blocks }] } });
    expect(kept).toHaveLength(130_000);
    expect(kept[129_999]).toBe("frag-129999");
  });
});

describe("flattenSlackVisibleProse — invisible content in every container", () => {
  it("emits nothing for a rich_text leaf that is only a zero-width character", () => {
    const raw = {
      blocks: [
        { elements: [{ elements: [{ text: "\u200B", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("emits nothing for a table row whose cells are all invisible", () => {
    const cell = {
      elements: [{ elements: [{ text: "\u200B", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    };
    expect(flatten({ raw: { blocks: [{ rows: [[cell, cell]], type: "table" }] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — an emoji name that is itself invisible", () => {
  it("emits nothing rather than manufacturing bare colons", () => {
    const raw = {
      blocks: [
        { elements: [{ elements: [{ name: "\u200B", type: "emoji" }], type: "rich_text_section" }], type: "rich_text" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — invisibility is a Unicode property, not a list", () => {
  const section = ({ text }: { text: string }) => ({
    blocks: [{ text: { text, type: "plain_text" }, type: "section" }],
  });

  it("emits nothing for a word joiner, which is invisible but not whitespace", () => {
    expect(flatten({ raw: section({ text: "\u2060" }) })).toStrictEqual([]);
  });

  it("emits nothing for a soft hyphen or a byte-order mark", () => {
    expect(flatten({ raw: section({ text: "\u00AD" }) })).toStrictEqual([]);
    expect(flatten({ raw: section({ text: "\uFEFF" }) })).toStrictEqual([]);
  });

  it("emits nothing for a link whose label resolves to an invisible character", () => {
    // The raw markup contains visible URL characters, so invisibility must be judged AFTER resolution.
    const raw = section({ text: "<https://example.invalid|\u200B>" });
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("still emits text that merely contains an invisible character alongside real words", () => {
    expect(flatten({ raw: section({ text: "real\u2060words here" }) })).toStrictEqual(["real\u2060words here"]);
  });
});

describe("flattenSlackVisibleProse — combining marks alone are invisible too", () => {
  const section = ({ text }: { text: string }) => ({
    blocks: [{ text: { text, type: "plain_text" }, type: "section" }],
  });

  it("emits nothing for a lone variation selector", () => {
    expect(flatten({ raw: section({ text: "\uFE0F" }) })).toStrictEqual([]);
  });

  it("emits nothing for a lone combining grapheme joiner", () => {
    expect(flatten({ raw: section({ text: "\u034F" }) })).toStrictEqual([]);
  });

  it("still emits accented prose, where the marks combine with a base character", () => {
    expect(flatten({ raw: section({ text: "cafe\u0301 opened" }) })).toStrictEqual(["cafe\u0301 opened"]);
  });
});

describe("flattenSlackVisibleProse — a blank glyph in a letter category is still invisible", () => {
  it("emits nothing for a lone Hangul filler, whose Unicode category is Letter", () => {
    const raw = { blocks: [{ text: { text: "\u3164", type: "plain_text" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("emits nothing for an emoji name that is a blank glyph", () => {
    const raw = {
      blocks: [
        { elements: [{ elements: [{ name: "\u3164", type: "emoji" }], type: "rich_text_section" }], type: "rich_text" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("still emits ordinary Hangul prose", () => {
    const raw = { blocks: [{ text: { text: "배포 완료", type: "plain_text" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual(["배포 완료"]);
  });
});

describe("flattenSlackVisibleProse — the last two recursion and mark gaps", () => {
  it("emits nothing for a lone spacing combining mark", () => {
    const raw = { blocks: [{ text: { text: "\u{1D165}", type: "plain_text" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual([]);
  });
});
