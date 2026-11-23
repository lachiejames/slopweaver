import { describe, expect, it } from "vitest";
import {
  COLD_TOKENS_PER_BATCH,
  calibrateRate,
  estimateDistilCost,
  type PersistedBatchUsage,
} from "../../../audit/costEstimate.js";

function usageMap({
  entries,
}: {
  entries: readonly [string, PersistedBatchUsage][];
}): Map<string, PersistedBatchUsage> {
  return new Map(entries);
}

describe("calibrateRate", () => {
  it("averages real captured usage into a per-batch token + cost rate", () => {
    const rate = calibrateRate({
      usageByHash: usageMap({
        entries: [
          ["h1", { costUsd: 0.5, inputTokens: 100, outputTokens: 200 }],
          ["h2", { costUsd: 1.0, inputTokens: 300, outputTokens: 400 }],
        ],
      }),
    });
    expect(rate.tokensPerBatch).toBe(500);
    expect(rate.costUsdPerBatch).toBeCloseTo(0.75, 10);
    expect(rate.calibratedFrom).toBe(2);
  });

  it("falls back to the documented COLD rate (no cost) when no batch has usage", () => {
    const rate = calibrateRate({ usageByHash: usageMap({ entries: [] }) });
    expect(rate).toStrictEqual({ calibratedFrom: 0, tokensPerBatch: COLD_TOKENS_PER_BATCH });
  });

  it("omits cost when only SOME batches carry it (keeps tokens + $ from the same population)", () => {
    const rate = calibrateRate({
      usageByHash: usageMap({
        entries: [
          ["h1", { costUsd: 0.5, inputTokens: 100, outputTokens: 100 }],
          ["h2", { inputTokens: 300, outputTokens: 100 }],
        ],
      }),
    });
    expect(rate.tokensPerBatch).toBe(300);
    expect(rate.costUsdPerBatch).toBeUndefined();
    expect(rate.calibratedFrom).toBe(2);
  });
});

describe("estimateDistilCost", () => {
  it("computes initial = uncached × rate and ongoing = one changed batch × rate (calibrated)", () => {
    const estimate = estimateDistilCost({
      batchHashes: ["h1", "h2", "h3"],
      cachedHashes: new Set(["h1"]),
      rate: { calibratedFrom: 2, costUsdPerBatch: 0.75, tokensPerBatch: 500 },
    });
    expect(estimate.totalBatches).toBe(3);
    expect(estimate.uncachedBatches).toBe(2);
    expect(estimate.initialTokens).toBe(1000);
    expect(estimate.initialCostUsd).toBeCloseTo(1.5, 10);
    expect(estimate.ongoingTokensPerChangedBatch).toBe(500);
    expect(estimate.ongoingCostUsdPerChangedBatch).toBeCloseTo(0.75, 10);
  });

  it("omits cost figures under a cold rate and counts duplicate hashes once", () => {
    const estimate = estimateDistilCost({
      batchHashes: ["h1", "h1", "h2"],
      cachedHashes: new Set<string>(),
      rate: { calibratedFrom: 0, tokensPerBatch: COLD_TOKENS_PER_BATCH },
    });
    expect(estimate.totalBatches).toBe(2);
    expect(estimate.uncachedBatches).toBe(2);
    expect(estimate.initialTokens).toBe(2 * COLD_TOKENS_PER_BATCH);
    expect(estimate.initialCostUsd).toBeUndefined();
    expect(estimate.ongoingCostUsdPerChangedBatch).toBeUndefined();
  });
});
