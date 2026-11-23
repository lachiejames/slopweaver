import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildDetailTruncationWarning } from "../../../../outbound/artifact/detailProseCap.js";
import * as artifactSchema from "../../../../outbound/artifact/schema.js";
import {
  BULLET_ITEM_VISIBLE_MAX,
  BULLETS_MAX_ITEMS,
  DETAIL_PROSE_VISIBLE_MAX,
  PARAGRAPH_VISIBLE_MAX,
  TABLE_CELL_VISIBLE_MAX,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
} from "../../../../outbound/assistant/contentLimits.js";

/** This module's own source, so a test can assert the MEASUREMENT PROSE survived the move intact. */
const SOURCE = readFileSync(join(import.meta.dirname, "../../../../outbound/assistant/contentLimits.ts"), "utf8");

describe("contentLimits — the measured values", () => {
  it("holds the exact caps both the artifact card and the answer form measure against", () => {
    expect(TLDR_VISIBLE_MAX).toBe(180);
    expect(PARAGRAPH_VISIBLE_MAX).toBe(650);
    expect(DETAIL_PROSE_VISIBLE_MAX).toBe(1800);
    expect(BULLETS_MAX_ITEMS).toBe(8);
    expect(BULLET_ITEM_VISIBLE_MAX).toBe(200);
    expect(TABLE_MAX_COLUMNS).toBe(4);
    expect(TABLE_MAX_ROWS).toBe(10);
    expect(TABLE_CELL_VISIBLE_MAX).toBe(120);
  });
});

describe("contentLimits — artifact/schema.ts re-exports these, rather than declaring its own copies", () => {
  it("re-exports the exact same values this module declares", () => {
    expect(artifactSchema.TLDR_VISIBLE_MAX).toBe(TLDR_VISIBLE_MAX);
    expect(artifactSchema.PARAGRAPH_VISIBLE_MAX).toBe(PARAGRAPH_VISIBLE_MAX);
    expect(artifactSchema.DETAIL_PROSE_VISIBLE_MAX).toBe(DETAIL_PROSE_VISIBLE_MAX);
    expect(artifactSchema.BULLETS_MAX_ITEMS).toBe(BULLETS_MAX_ITEMS);
    expect(artifactSchema.BULLET_ITEM_VISIBLE_MAX).toBe(BULLET_ITEM_VISIBLE_MAX);
    expect(artifactSchema.TABLE_MAX_COLUMNS).toBe(TABLE_MAX_COLUMNS);
    expect(artifactSchema.TABLE_MAX_ROWS).toBe(TABLE_MAX_ROWS);
    expect(artifactSchema.TABLE_CELL_VISIBLE_MAX).toBe(TABLE_CELL_VISIBLE_MAX);
  });

  it("ABOVE_FOLD_VISIBLE_MAX is a full TL;DR plus nine average index lines, wider than one paragraph", () => {
    expect(artifactSchema.ABOVE_FOLD_VISIBLE_MAX).toBe(
      TLDR_VISIBLE_MAX + 9 * artifactSchema.INDEX_LINE_AVERAGE_VISIBLE,
    );
    expect(artifactSchema.ABOVE_FOLD_VISIBLE_MAX).toBeGreaterThan(PARAGRAPH_VISIBLE_MAX);
  });
});

describe("contentLimits — DETAIL_PROSE_VISIBLE_MAX clears detailProseCap.ts's stated floor precondition", () => {
  it("holds a surviving PARAGRAPH_VISIBLE_MAX-sized block plus its truncation warning, with real margin", () => {
    // `detailProseCap.ts`'s capDetailProse never removes the sole remaining block, so this sum is the actual
    // worst case it can return — see its own doc comment for why this is a stated precondition, not
    // something the function enforces for an arbitrary caller.
    const worstRealisticWarning = buildDetailTruncationWarning({
      blocksDropped: 0,
      cap: DETAIL_PROSE_VISIBLE_MAX,
      itemsDropped: 1_000_000,
      rowsDropped: TABLE_MAX_ROWS,
    });
    const warningRun = worstRealisticWarning.type === "paragraph" ? worstRealisticWarning.runs[0]! : undefined;
    const warningWidth = warningRun?.type === "text" ? warningRun.text.length : Number.POSITIVE_INFINITY;

    expect(PARAGRAPH_VISIBLE_MAX + warningWidth).toBeLessThan(DETAIL_PROSE_VISIBLE_MAX);
  });
});

describe("contentLimits — the TL;DR measurement's provenance survived the move", () => {
  it("still cites the three real reference TL;DRs measured in visible characters", () => {
    expect(SOURCE.includes("125 / 166 / 170 visible characters")).toBe(true);
  });

  it("states 180 is a REUSE of the card measurement, never a measurement of Slack's own length fold", () => {
    expect(SOURCE.includes("This number is a REUSE of that card measurement")).toBe(true);
    expect(SOURCE.includes("Nobody has measured that boundary")).toBe(true);
  });
});
