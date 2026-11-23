/**
 * The `ordered` index style — the colour-coded ranked list: the schema refuses a line that
 * opens with no colour, the renderer asks Slack for its own numbered list, and the dry-run preview numbers it.
 */
import { describe, expect, it } from "vitest";

import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import { previewBlockLines } from "../../../../outbound/slack/preview.js";
import { renderLeadBlock } from "../../../../outbound/slack/render.js";

const DETAIL = [{ runs: [{ text: "the table lives here", type: "text" }], type: "paragraph" }];

/** A card with the given ordered index lines. */
function orderedForm({ lines }: { lines: readonly string[] }): Record<string, unknown> {
  return {
    detail: DETAIL,
    index: lines.map((text) => [{ text, type: "text" }]),
    indexStyle: "ordered",
    kind: "update",
    tldr: "where ISO stands this morning",
  };
}

describe("updateArtifactSchema — an ordered index", () => {
  it("ACCEPTS lines that each open with a rank colour, in whatever order the author ranked them", () => {
    const form = orderedForm({ lines: ["🟢 upload five docs", "🔴 internal audit report", "🟡 training records"] });
    const parsed = updateArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(true);
    expect(parsed.data!.indexStyle).toBe("ordered");
  });

  it("REFUSES a line with no colour, naming the line and the colours", () => {
    const parsed = updateArtifactSchema.safeParse(orderedForm({ lines: ["🔴 audit report", "training records"] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual([
      "index line 1 does not open with a colour — an ordered index is a colour-coded ranked list, so every line " +
        "starts with one of 🔴 🟠 🟡 🟢 and a space.",
    ]);
  });

  it("REFUSES a colour with no space after it, which would weld the dot onto the first word", () => {
    const parsed = updateArtifactSchema.safeParse(orderedForm({ lines: ["🔴audit report"] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["index", 0]);
  });

  it("does not ask a bullet index for colours", () => {
    const form = { ...orderedForm({ lines: ["training records"] }), indexStyle: "bullet" };

    expect(updateArtifactSchema.safeParse(form).success).toBe(true);
  });
});

describe("renderLeadBlock and the preview — an ordered index", () => {
  const block = renderLeadBlock({
    citations: [],
    index: [[{ text: "🔴 audit report", type: "text" }], [{ text: "🟢 five docs", type: "text" }]],
    indexStyle: "ordered",
    mentions: { groups: new Map(), people: new Map() },
    primaryLink: undefined,
    tldr: "where ISO stands",
  });

  it("asks Slack for its own numbered list", () => {
    expect(block.elements[1]).toEqual({
      elements: [
        { elements: [{ text: "🔴 audit report", type: "text" }], type: "rich_text_section" },
        { elements: [{ text: "🟢 five docs", type: "text" }], type: "rich_text_section" },
      ],
      style: "ordered",
      type: "rich_text_list",
    });
  });

  it("previews the list with numbers rather than bullets", () => {
    expect(previewBlockLines({ block })).toEqual(["where ISO stands", "", "1. 🔴 audit report", "2. 🟢 five docs"]);
  });
});
