/**
 * The composer's budget, stated before it composes. Every assertion here derives its expected figure from
 * the constant that enforces the cap, so a line that stops matching its own check fails rather than quietly
 * briefing a stale number — which is the exact defect this module exists to close.
 */
import { describe, expect, it } from "vitest";

import { ABOVE_FOLD_VISIBLE_MAX, INDEX_MAX_ITEMS } from "../../../../outbound/artifact/schema.js";
import { answerFormCapLines } from "../../../../outbound/assistant/capGuidance.js";
import {
  BODY_MAX_BLOCKS,
  BULLETS_MAX_ITEMS,
  CITATIONS_MAX,
  DETAIL_PROSE_VISIBLE_MAX,
  TLDR_VISIBLE_MAX,
} from "../../../../outbound/assistant/contentLimits.js";

const TEXT = answerFormCapLines().join("\n");

describe("answerFormCapLines", () => {
  it("names every cap the answer arm enforces, by constant", () => {
    const named = [
      "TLDR_VISIBLE_MAX",
      "INDEX_MAX_ITEMS",
      "INDEX_ITEM_VISIBLE_MAX",
      "ABOVE_FOLD_VISIBLE_MAX",
      "BODY_MAX_BLOCKS",
      "DETAIL_PROSE_VISIBLE_MAX",
      "PARAGRAPH_VISIBLE_MAX",
      "BULLETS_MAX_ITEMS",
      "BULLET_ITEM_VISIBLE_MAX",
      "TABLE_MAX_COLUMNS",
      "TABLE_MAX_ROWS",
      "TABLE_CELL_VISIBLE_MAX",
      "CITATIONS_MAX",
    ];

    expect(named.filter((constant) => !TEXT.includes(constant))).toEqual([]);
  });

  it("states the body-block cap the dogfood turns actually died on, with its live value", () => {
    expect(TEXT).toContain(`≤ ${String(BODY_MAX_BLOCKS)} sub-blocks (BODY_MAX_BLOCKS)`);
  });

  it("states the citation budget as the FORMULA, never as the flat ceiling it stopped being", () => {
    expect(TEXT).toContain(`≤ the LARGER of ${String(CITATIONS_MAX)} (CITATIONS_MAX) and this answer's own item count`);
    expect(TEXT).toContain("one item is one");
    expect(TEXT).toContain("one TABLE ROW or one index line");
    // The old line read `citations   ≤ 12 (CITATIONS_MAX)`. A composer briefed with that number would hold a
    // sixteen-row ranked answer to twelve citations and never learn the other four were available.
    expect(TEXT).not.toContain(`citations   ≤ ${String(CITATIONS_MAX)} (CITATIONS_MAX)`);
  });

  it("states each remaining figure from its own constant, never a restated literal", () => {
    expect(TEXT).toContain(`≤ ${String(TLDR_VISIBLE_MAX)} visible chars (TLDR_VISIBLE_MAX)`);
    expect(TEXT).toContain(`≤ ${String(INDEX_MAX_ITEMS)} lines (INDEX_MAX_ITEMS)`);
    expect(TEXT).toContain(`≤ ${String(ABOVE_FOLD_VISIBLE_MAX)} visible chars all together (ABOVE_FOLD_VISIBLE_MAX)`);
    expect(TEXT).toContain(`≤ ${String(DETAIL_PROSE_VISIBLE_MAX)} visible chars of PROSE`);
    expect(TEXT).toContain(`≤ ${String(BULLETS_MAX_ITEMS)} items per block (BULLETS_MAX_ITEMS)`);
  });

  // A composer briefed "images ≤ 2" would drop nine of the eleven captures an ISO answer names.
  it("briefs images as judgement with NO count cap", () => {
    expect(TEXT).toContain("images      no count cap — as many as the evidence earns");
    expect(TEXT).not.toContain("IMAGES_MAX");
  });

  it("says a cap is a REFUSAL, so a composer never expects a silent trim", () => {
    expect(TEXT).toContain("REFUSES the whole form");
  });

  it("does NOT brief the operator card's structure rule, which the answer arm never applies", () => {
    expect(TEXT).toContain("OUTBOUND SIZE CAPS");
    expect(TEXT.includes("STRUCTURE_REQUIRED_VISIBLE_THRESHOLD")).toBe(false);
  });
});
