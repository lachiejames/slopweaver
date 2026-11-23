/*
 * A blank table column header renders as one space, because rich_text rejects an empty text element, and a
 * non-empty header stays exactly as written.
 */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — a blank column header", () => {
  function tableArtifact({ columns }: { columns: readonly string[] }): UpdateArtifact {
    return {
      ...minimalArtifact(),
      detail: [
        { columns, rows: [[[{ text: "RED", type: "text" }], [{ text: "NZ push", type: "text" }]]], type: "table" },
      ],
    };
  }

  it("renders an empty header as a single space, because rich_text rejects an empty text element", () => {
    const blocks = render({ artifact: tableArtifact({ columns: ["", "Issue"] }) }).attachments[0].blocks;
    const table = blocks[5];

    expect(table).toEqual({
      rows: [
        [
          { elements: [{ elements: [{ text: " ", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
          { elements: [{ elements: [{ text: "Issue", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
        ],
        [
          { elements: [{ elements: [{ text: "RED", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
          {
            elements: [{ elements: [{ text: "NZ push", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
      ],
      type: "table",
    });
  });

  it("leaves a non-empty header exactly as written", () => {
    const blocks = render({ artifact: tableArtifact({ columns: ["Sev", "Issue"] }) }).attachments[0].blocks;
    const table = blocks[5]!;

    expect(table.type).toBe("table");
    expect(JSON.stringify(table)).toContain('{"text":"Sev","type":"text"}');
  });
});
