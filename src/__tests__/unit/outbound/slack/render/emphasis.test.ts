/*
 * Emphasis is a style flag on a run, never syntax in its text: markdown-looking text, an em-dash and a
 * `<@Uxxx>`-shaped string all pass through untouched, and an unstyled run carries no style object.
 */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — emphasis is structural, never syntax", () => {
  it("emits style flags rather than asterisks, and leaves markdown-looking text untouched", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          runs: [
            { bold: true, text: "Bold: ", type: "text" },
            { italic: true, text: "an *asterisked* literal", type: "text" },
            { code: true, text: "id", type: "text" },
          ],
          type: "paragraph",
        },
      ],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "Bold: ", type: "text" },
            { style: { italic: true }, text: "an *asterisked* literal", type: "text" },
            { style: { code: true }, text: "id", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("omits the style object entirely for an unstyled run", () => {
    const payload = render({ artifact: minimalArtifact() });
    const detail = payload.attachments[0].blocks[5];

    expect(detail).toEqual({
      elements: [{ elements: [{ text: "The detail.", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    });
  });

  it("passes an em-dash and other special characters through UNTOUCHED — they are not banned here", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          runs: [{ text: 'Quoted — with an em-dash, an apostrophe\'s curl, & <angles> "quotes" 🎉', type: "text" }],
          type: "paragraph",
        },
      ],
    };

    const payload = render({ artifact });
    const block = payload.attachments[0].blocks[5];

    expect(block).toEqual({
      elements: [
        {
          elements: [{ text: 'Quoted — with an em-dash, an apostrophe\'s curl, & <angles> "quotes" 🎉', type: "text" }],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("renders a <@Uxxx>-shaped string in quoted prose as inert text, pinging nobody", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [{ runs: [{ text: "They wrote <@U_fake_nobody> in the ticket.", type: "text" }], type: "paragraph" }],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [{ text: "They wrote <@U_fake_nobody> in the ticket.", type: "text" }],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});
