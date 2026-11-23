/**
 * The measurement behind `INDEX_LINE_AVERAGE_VISIBLE`: a written synthetic compliance card whose above-the-fold
 * lines have the reference widths. The constant's comment quotes these numbers, so this is the test that turns red
 * if the fixture or the width rule drifts away from what the comment claims.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ABOVE_FOLD_VISIBLE_MAX,
  INDEX_LINE_AVERAGE_VISIBLE,
  INDEX_MAX_ITEMS,
  TLDR_VISIBLE_MAX,
  updateArtifactSchema,
} from "../../../../outbound/artifact/schema.js";
import { visibleLengthOfRuns } from "../../../../outbound/artifact/visibleLength.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/aboveFold/compliance-standup-card.json", import.meta.url));
/** `source` is a placeholder permalink — provenance, not a card field. */
const { source: _source, ...FIELDS } = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
const CARD = updateArtifactSchema.parse({
  ...FIELDS,
  detail: [{ runs: [{ text: "detail", type: "text" }], type: "paragraph" }],
  kind: "update",
  media: [],
});

describe("the compliance stand-up card the above-the-fold average is measured against", () => {
  it("has the index widths the constant's comment quotes", () => {
    const widths = CARD.index.map((runs) => visibleLengthOfRuns({ citations: CARD.citations, runs }));
    expect(widths).toEqual([49, 107, 79, 112, 68]);
  });

  it("averages below INDEX_LINE_AVERAGE_VISIBLE", () => {
    const total = CARD.index.reduce((sum, runs) => sum + visibleLengthOfRuns({ citations: CARD.citations, runs }), 0);
    expect(Math.round(total / CARD.index.length)).toBe(83);
    expect(INDEX_LINE_AVERAGE_VISIBLE).toBe(100);
  });

  it("makes the region a full TL;DR plus nine average lines", () => {
    expect(INDEX_MAX_ITEMS).toBe(9);
    expect(ABOVE_FOLD_VISIBLE_MAX).toBe(TLDR_VISIBLE_MAX + 9 * 100);
    expect(ABOVE_FOLD_VISIBLE_MAX).toBe(1080);
  });
});
