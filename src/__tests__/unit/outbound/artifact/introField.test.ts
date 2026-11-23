/**
 * The card's day-one `intro` — bounded by the schema, drawn above the TL;DR, read by the above-the-fold voice
 * rules, and carried unchanged from both scheduled forms onto the card they derive.
 */
import { describe, expect, it } from "vitest";

import { updateArtifactAboveFoldCells } from "../../../../outbound/artifact/aboveFold.js";
import {
  alertSummaryFormSchema,
  alertSummaryToUpdate,
  withoutQuotedFlags,
} from "../../../../outbound/artifact/alertSummary.js";
import { INTRO_LINE_VISIBLE_MAX } from "../../../../outbound/artifact/introAndRank.js";
import { INDEX_ITEM_VISIBLE_MAX, updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import { renderLeadBlock } from "../../../../outbound/slack/render.js";

const INTRO = ["👋 this is a trial.", "reply in the thread to say whether it helps."];

/** A minimal card carrying the given intro. */
function card({ intro }: { intro: unknown }): Record<string, unknown> {
  return {
    detail: [{ runs: [{ text: "detail", type: "text" }], type: "paragraph" }],
    intro,
    kind: "update",
    tldr: "the headline",
  };
}

describe("updateArtifactSchema — intro", () => {
  it("ACCEPTS one to four plain lines", () => {
    const parsed = updateArtifactSchema.safeParse(card({ intro: INTRO }));

    expect(parsed.success).toBe(true);
    expect(parsed.data!.intro).toEqual(INTRO);
  });

  it("REFUSES five lines, an empty list, and a line break inside a line", () => {
    expect(updateArtifactSchema.safeParse(card({ intro: ["a", "b", "c", "d", "e"] })).success).toBe(false);
    expect(updateArtifactSchema.safeParse(card({ intro: [] })).success).toBe(false);
    const broken = updateArtifactSchema.safeParse(card({ intro: ["one\ntwo"] }));
    expect(broken.error!.issues.map((issue) => issue.message)).toEqual([
      "an intro line carries a line break — give each line its own entry",
    ]);
  });

  it("bounds an intro line exactly as wide as an index line", () => {
    expect(INTRO_LINE_VISIBLE_MAX).toBe(INDEX_ITEM_VISIBLE_MAX);
  });

  it("REFUSES a line wider than an index line, naming the line", () => {
    const parsed = updateArtifactSchema.safeParse(card({ intro: ["x".repeat(INTRO_LINE_VISIBLE_MAX + 1)] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path)).toEqual([["intro", 0]]);
  });

  it("REFUSES a line that is over the cap in UTF-16 units, which is what the card measures", () => {
    const line = "👋".repeat(61);

    expect(line.length).toBe(122);
    expect(updateArtifactSchema.safeParse(card({ intro: [line] })).success).toBe(false);
  });

  it("REFUSES a bare URL and a [n] marker, neither of which a plain string can render", () => {
    expect(updateArtifactSchema.safeParse(card({ intro: ["read https://example.invalid/x"] })).success).toBe(false);
    expect(updateArtifactSchema.safeParse(card({ intro: ["see [1]"] })).success).toBe(false);
  });

  it("REFUSES a raw mention, so a day-one intro cannot tag anyone", () => {
    const parsed = updateArtifactSchema.safeParse(card({ intro: ["ping <@U123ABC>"] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["intro", 0]);
  });

  it("hands every intro line to the above-the-fold voice rules, ahead of the TL;DR", () => {
    const parsed = updateArtifactSchema.parse(card({ intro: INTRO }));

    expect(updateArtifactAboveFoldCells({ artifact: parsed }).map((cell) => cell.path)).toEqual([
      "intro[0]",
      "intro[1]",
      "tldr",
    ]);
  });
});

describe("renderLeadBlock — intro", () => {
  it("draws the intro lines first, a paragraph gap, then the TL;DR", () => {
    const block = renderLeadBlock({
      citations: [],
      index: [],
      indexStyle: "bullet",
      intro: INTRO,
      mentions: { groups: new Map(), people: new Map() },
      primaryLink: undefined,
      tldr: "the headline",
    });

    expect(block.elements).toEqual([
      {
        elements: [
          { text: "👋 this is a trial.\nreply in the thread to say whether it helps.\n\n", type: "text" },
          { text: "the headline", type: "text" },
        ],
        type: "rich_text_section",
      },
    ]);
  });
});

describe("alertSummaryToUpdate — intro", () => {
  it("carries the form's intro onto the derived card unchanged", () => {
    const form = alertSummaryFormSchema.parse({
      intro: INTRO,
      kind: "alert-summary",
      label: "alerts-dx",
      rows: [{ count: 3, label: "checkout down", severity: "red" }],
      skipped: 0,
      window: "24h",
    });

    expect(alertSummaryToUpdate({ form }).intro).toEqual(INTRO);
    expect(
      updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact: alertSummaryToUpdate({ form }) })).success,
    ).toBe(true);
  });
});
