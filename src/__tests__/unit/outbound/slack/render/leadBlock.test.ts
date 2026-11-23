/*
 * Block 2, the only content above the fold: a bare TL;DR, or the primary link inlined at the head of the same
 * section.
 */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — block 2, the only content above the fold", () => {
  it("renders a bare TL;DR as one text run when there is no primary link", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.attachments[0].blocks[2]).toEqual({
      elements: [{ elements: [{ text: "A short lead.", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    });
  });

  it("inlines the primary link at the head of the same section, with a literal unicode glyph", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      primaryLink: { label: "Draft PR", url: "https://example.invalid/pr/5" },
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[2]).toEqual({
      elements: [
        {
          elements: [
            { text: "🔗 ", type: "text" },
            { text: "Draft PR", type: "link", url: "https://example.invalid/pr/5" },
            { text: "\n\nA short lead.", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});
