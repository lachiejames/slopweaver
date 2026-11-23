/*
 * How the detail sequence maps to blocks: bullets, a table as a sibling block with its column settings, and the
 * gaps between paragraphs, lists and tables.
 */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — the detail sequence maps one block per sub-block", () => {
  it("emits bullets as a rich_text_list inside its own block", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          items: [
            [{ text: "first", type: "text" }],
            [
              { text: "second with ", type: "text" },
              { code: true, text: "code", type: "text" },
            ],
          ],
          type: "bullets",
        },
      ],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { elements: [{ text: "first", type: "text" }], type: "rich_text_section" },
            {
              elements: [
                { text: "second with ", type: "text" },
                { style: { code: true }, text: "code", type: "text" },
              ],
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

  it("emits a table as a SIBLING top-level block, never nested in rich_text", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        { runs: [{ text: "Above.", type: "text" }], type: "paragraph" },
        {
          columns: ["Probe", "Result"],
          rows: [[[{ text: "A4", type: "text" }], [{ text: "folds", type: "text" }]]],
          type: "table",
        },
        { runs: [{ text: "Below.", type: "text" }], type: "paragraph" },
      ],
    };

    const payload = render({ artifact });
    const blocks = payload.attachments[0].blocks;

    expect(blocks.length).toBe(8);
    expect(blocks.map((b) => b.type)).toEqual([
      "context",
      "divider",
      "rich_text",
      "divider",
      "context",
      "rich_text",
      "table",
      "rich_text",
    ]);
    expect(blocks[6]).toEqual({
      rows: [
        [
          {
            elements: [{ elements: [{ text: "Probe", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
          {
            elements: [{ elements: [{ text: "Result", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
        [
          {
            elements: [{ elements: [{ text: "A4", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
          {
            elements: [{ elements: [{ text: "folds", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
      ],
      type: "table",
    });
  });

  it("passes columnSettings through as Slack's own column_settings, wrap renamed to is_wrapped", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          columnSettings: [{ wrap: true }, { align: "right" }],
          columns: ["Alert", "24h"],
          rows: [[[{ text: "disk writes", type: "text" }], [{ text: "3", type: "text" }]]],
          type: "table",
        },
      ],
    };

    const payload = render({ artifact });
    const table = payload.attachments[0].blocks.find((block) => block.type === "table")!;

    expect(table).toMatchObject({ column_settings: [{ is_wrapped: true }, { align: "right" }] });
  });

  it("omits column_settings entirely when the detail block carries none", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          columns: ["Alert", "24h"],
          rows: [[[{ text: "disk writes", type: "text" }], [{ text: "3", type: "text" }]]],
          type: "table",
        },
      ],
    };

    const payload = render({ artifact });
    const table = payload.attachments[0].blocks.find((block) => block.type === "table")!;

    expect(Object.hasOwn(table, "column_settings")).toBe(false);
  });

  it("groups consecutive paragraphs into ONE block, separated by an embedded double newline", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        { runs: [{ text: "One.", type: "text" }], type: "paragraph" },
        { runs: [{ text: "Two.", type: "text" }], type: "paragraph" },
      ],
    };

    const payload = render({ artifact });
    const blocks = payload.attachments[0].blocks;

    expect(blocks.length).toBe(6);
    expect(blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { text: "One.", type: "text" },
            { text: "\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
        { elements: [{ text: "Two.", type: "text" }], type: "rich_text_section" },
      ],
      type: "rich_text",
    });
  });

  it("gives a paragraph FOLLOWING a list a single leading newline, not a full gap", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        { runs: [{ text: "Intro.", type: "text" }], type: "paragraph" },
        { items: [[{ text: "a bullet", type: "text" }]], type: "bullets" },
        { runs: [{ text: "Closing.", type: "text" }], type: "paragraph" },
      ],
    };

    const payload = render({ artifact });
    const blocks = payload.attachments[0].blocks;

    expect(blocks.length).toBe(6);
    expect(blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { text: "Intro.", type: "text" },
            { text: "\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
        {
          elements: [{ elements: [{ text: "a bullet", type: "text" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
        {
          elements: [
            { text: "\n", type: "text" },
            { text: "Closing.", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("emits NO gap before a table, because the block closes and a trailing newline is stripped", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        { runs: [{ text: "Above.", type: "text" }], type: "paragraph" },
        {
          columns: ["A"],
          rows: [[[{ text: "1", type: "text" }]]],
          type: "table",
        },
      ],
    };

    const payload = render({ artifact });
    const blocks = payload.attachments[0].blocks;

    expect(blocks[5]).toEqual({
      elements: [{ elements: [{ text: "Above.", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    });
    expect(blocks[6]?.type).toBe("table");
  });
});
