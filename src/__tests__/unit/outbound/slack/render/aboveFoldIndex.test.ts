import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { UnresolvedMentionError } from "../../../../../outbound/slack/render.js";
import { minimalArtifact, render } from "./harness.js";

/**
 * The above-the-fold index. The ONE property that matters is that it adds no blocks: the fold is a function
 * of block count alone, so an index that cost a block would push the detail label to index 5 and fold the
 * very thing it exists to reveal.
 */
describe("renderUpdateCard — the above-the-fold index", () => {
  function indexed(): UpdateArtifact {
    return {
      ...minimalArtifact(),
      index: [
        [
          { text: "🔴 ", type: "text" },
          { label: "KK-1770", type: "link", url: "https://example.invalid/KK-1770" },
          { text: " NZ push tokens rejected", type: "text" },
        ],
        [{ text: "🟢 transition race — 0", type: "text" }],
      ],
    };
  }

  it("adds NO blocks — the same six as an index-free card", () => {
    const without = render({ artifact: minimalArtifact() }).attachments[0].blocks;
    const withIndex = render({ artifact: indexed() }).attachments[0].blocks;

    expect(without.length).toBe(6);
    expect(withIndex.length).toBe(6);
  });

  it("leaves the detail label at block 4, so it stays the last thing above the fold", () => {
    const blocks = render({ artifact: indexed() }).attachments[0].blocks;

    expect(blocks[4]).toEqual({ elements: [{ text: "*Details*", type: "mrkdwn" }], type: "context" });
  });

  it("renders the lines as a bullet list SIBLING of the TL;DR inside block 2", () => {
    const blocks = render({ artifact: indexed() }).attachments[0].blocks;

    expect(blocks[2]).toEqual({
      elements: [
        { elements: [{ text: "A short lead.\n\n", type: "text" }], type: "rich_text_section" },
        {
          elements: [
            {
              elements: [
                { text: "🔴 ", type: "text" },
                { text: "KK-1770", type: "link", url: "https://example.invalid/KK-1770" },
                { text: " NZ push tokens rejected", type: "text" },
              ],
              type: "rich_text_section",
            },
            {
              elements: [{ text: "🟢 transition race — 0", type: "text" }],
              type: "rich_text_section",
            },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("adds no gap when there is no index, so a pre-index card renders byte-identically", () => {
    const blocks = render({ artifact: minimalArtifact() }).attachments[0].blocks;

    expect(blocks[2]).toEqual({
      elements: [{ elements: [{ text: "A short lead.", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    });
  });

  it("keeps the primary link as the head of the section, with the index below it", () => {
    const artifact: UpdateArtifact = {
      ...indexed(),
      primaryLink: { label: "the board", url: "https://example.invalid/board" },
    };
    const blocks = render({ artifact }).attachments[0].blocks;

    expect(blocks[2]).toEqual({
      elements: [
        {
          elements: [
            { text: "🔗 ", type: "text" },
            { text: "the board", type: "link", url: "https://example.invalid/board" },
            { text: "\n\nA short lead.\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              elements: [
                { text: "🔴 ", type: "text" },
                { text: "KK-1770", type: "link", url: "https://example.invalid/KK-1770" },
                { text: " NZ push tokens rejected", type: "text" },
              ],
              type: "rich_text_section",
            },
            { elements: [{ text: "🟢 transition race — 0", type: "text" }], type: "rich_text_section" },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("resolves a mention inside an index line", () => {
    const artifact: UpdateArtifact = { ...minimalArtifact(), index: [[{ person: "ada", type: "mention" }]] };
    const blocks = render({ artifact }).attachments[0].blocks;

    expect(blocks[2]).toEqual({
      elements: [
        { elements: [{ text: "A short lead.\n\n", type: "text" }], type: "rich_text_section" },
        {
          elements: [{ elements: [{ type: "user", user_id: "U_fake_ada" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("refuses an unresolvable mention in an index line rather than dropping it", () => {
    const artifact: UpdateArtifact = { ...minimalArtifact(), index: [[{ person: "nobody", type: "mention" }]] };

    expect(() => render({ artifact })).toThrow(UnresolvedMentionError);
  });
});
