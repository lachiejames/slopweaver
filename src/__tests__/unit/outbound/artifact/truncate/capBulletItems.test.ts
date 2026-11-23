/*
 * `capBulletItems`: trailing bullet items past the cap are dropped and counted, and a bullets block never trims
 * to zero items. It moved here when `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { capBulletItems } from "../../../../../outbound/artifact/truncate.js";
import { bullets } from "./harness.js";

describe("capBulletItems", () => {
  it("drops trailing items past the cap on a bullets block", () => {
    const result = capBulletItems({ detail: [bullets({ items: ["a", "b", "c"] })], maxItems: 2 });

    expect(result.itemsDropped).toBe(1);
    const block = result.detail[0]!;
    expect(block.type === "bullets" ? block.items.length : -1).toBe(2);
  });

  it("is a no-op when every bullets block is already within the cap", () => {
    const detail = [bullets({ items: ["a", "b"] })];
    const result = capBulletItems({ detail, maxItems: 2 });

    expect(result.itemsDropped).toBe(0);
    expect(result.detail).toEqual(detail);
  });

  it("never trims to zero items even when maxItems itself is 0 — the zero-cap counterexample", () => {
    // A bullets block with no items is a shape `.min(1)` refuses outright, so the effective floor is 1
    // regardless of how small maxItems is.
    const result = capBulletItems({ detail: [bullets({ items: ["a"] })], maxItems: 0 });

    expect(result.itemsDropped).toBe(0);
    const block = result.detail[0]!;
    expect(block.type === "bullets" ? block.items.length : -1).toBe(1);
  });

  it("never trims to zero items for NaN or negative maxItems — the NaN-cap counterexample", () => {
    const nanResult = capBulletItems({ detail: [bullets({ items: ["a"] })], maxItems: Number.NaN });
    const negativeResult = capBulletItems({ detail: [bullets({ items: ["a"] })], maxItems: -5 });
    const nanBlock = nanResult.detail[0]!;
    const negativeBlock = negativeResult.detail[0]!;

    expect(nanBlock.type === "bullets" ? nanBlock.items.length : -1).toBe(1);
    expect(negativeBlock.type === "bullets" ? negativeBlock.items.length : -1).toBe(1);
  });
});
