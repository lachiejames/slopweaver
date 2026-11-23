/*
 * `capDetailProse`: the prose pass drops whole blocks, then bullet items, from the tail until the content PLUS
 * the exact warning fits, and never drops the last block. It moved here when `truncate.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { buildDetailTruncationWarning, capDetailProse } from "../../../../../outbound/artifact/detailProseCap.js";
import { bullets, paragraph, table } from "./harness.js";

describe("capDetailProse", () => {
  it("is a no-op when the total is already within the cap", () => {
    const detail = [paragraph({ value: "x".repeat(50) })];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 100,
      rowsDropped: 0,
    });

    expect(result.blocksDropped).toBe(0);
    expect(result.itemsDropped).toBe(0);
    expect(result.detail).toEqual(detail);
  });

  it("drops whole paragraph blocks from the tail until the content PLUS the exact warning fits", () => {
    const detail = [
      paragraph({ value: "a".repeat(50) }),
      paragraph({ value: "b".repeat(50) }),
      paragraph({ value: "c".repeat(50) }),
    ];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 100,
      rowsDropped: 0,
    });

    expect(result.blocksDropped).toBe(2);
    expect(result.itemsDropped).toBe(0);
    expect(result.detail.length).toBe(1);
    const survivor = result.detail[0]!;
    const run = survivor.type === "paragraph" ? survivor.runs[0]! : undefined;
    expect(run?.type === "text" ? run.text : "").toBe("a".repeat(50));
  });

  it("drops bullet items one at a time before dropping the whole block", () => {
    const detail = [bullets({ items: ["x".repeat(500), "y".repeat(500), "z".repeat(500)] })];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 1200,
      rowsDropped: 0,
    });

    expect(result.itemsDropped).toBe(1);
    expect(result.blocksDropped).toBe(0);
    const block = result.detail[0]!;
    expect(block.type === "bullets" ? block.items.length : -1).toBe(2);
  });

  it("never drops the LAST remaining detail block, even if it alone stays over the target", () => {
    const detail = [paragraph({ value: "x".repeat(80) })];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 50,
      rowsDropped: 0,
    });

    expect(result.detail.length).toBe(1);
    expect(result.blocksDropped).toBe(0);
  });

  it("skips over a trailing table when looking for prose to drop, since a table costs nothing", () => {
    const detail = [
      paragraph({ value: "a".repeat(400) }),
      paragraph({ value: "b".repeat(400) }),
      table({ rows: [["1"]] }),
    ];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 600,
      rowsDropped: 0,
    });

    expect(result.blocksDropped).toBe(1);
    expect(result.detail.map((block) => block.type)).toEqual(["paragraph", "table"]);
  });

  it("does NOT early-return once an earlier pass owes a warning, even when this pass's own content already fits — the r1-01b counterexample", () => {
    // r1-01b: three 600/600/592-char paragraphs plus a bullets block trimmed to 8 items elsewhere leaves
    // content at exactly 1800 (== cap). A bare "does the content already fit?" early return would stop
    // right there and never make room for the warning that 10,000 earlier-dropped items now owe — pushing
    // the real total to 1,912. This pass must keep dropping until content PLUS that warning both fit.
    const detail = [
      paragraph({ value: "a".repeat(600) }),
      paragraph({ value: "b".repeat(600) }),
      paragraph({ value: "c".repeat(592) }),
      bullets({ items: ["x", "y", "z", "w", "v", "u", "t", "s"] }), // 8 items, 8 visible chars
    ];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 10_000,
      citations: [],
      detail,
      maxProse: 1800,
      rowsDropped: 0,
    });
    const contentWidth = result.detail.reduce((total, block) => {
      if (block.type === "paragraph") {
        return total + block.runs.reduce((sum, run) => sum + (run.type === "text" ? run.text.length : 0), 0);
      }
      if (block.type === "bullets" || block.type === "list") {
        return (
          total +
          block.items.reduce(
            (sum, item) => sum + item.reduce((s, run) => s + (run.type === "text" ? run.text.length : 0), 0),
            0,
          )
        );
      }
      return total;
    }, 0);
    const warning = buildDetailTruncationWarning({
      blocksDropped: result.blocksDropped,
      cap: 1800,
      itemsDropped: 10_000 + result.itemsDropped,
      rowsDropped: 0,
    });
    const warningRun = warning.type === "paragraph" ? warning.runs[0]! : undefined;
    const warningWidth = warningRun?.type === "text" ? warningRun.text.length : Number.POSITIVE_INFINITY;

    expect(contentWidth + warningWidth).toBeLessThanOrEqual(1800);
  });

  it("takes the raw early-return only when NO pass — earlier or its own — has dropped anything", () => {
    const detail = [paragraph({ value: "a".repeat(90) })];
    const result = capDetailProse({
      baseBlocksDropped: 0,
      baseItemsDropped: 0,
      citations: [],
      detail,
      maxProse: 100,
      rowsDropped: 0,
    });

    expect(result.detail).toEqual(detail);
    expect(result.blocksDropped).toBe(0);
    expect(result.itemsDropped).toBe(0);
  });
});
