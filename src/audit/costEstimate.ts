/**
 * The PURE, sample-calibrated distil cost estimate behind `slopweaver audit` (spec decision #3). It never
 * calls a model: it extrapolates from the REAL per-batch usage `distil` captured back when it called a model
 * itself. The rate is the mean of those measured batches; only when NO batch carries usage does it fall back
 * to a documented COLD default — an honest, `~`-labelled extrapolation of measured data, not a blind guess.
 *
 * Two figures, reported separately: the INITIAL full-backfill (every currently-uncached batch × the rate)
 * and the ONGOING marginal (one changed batch × the rate) — since a steady-state refresh only re-distils
 * changed batches while the content-hash cache serves the rest, so ongoing ≪ initial.
 *
 * Under rule 2 (no spawned model, anywhere — `AGENTS.md`) `distil` no longer calls a model in-process at
 * all, so this calibration data can never grow again: a fresh install's usage map is permanently empty, and
 * every estimate here is now the COLD default, forever. `PersistedBatchUsage` is defined HERE rather than
 * imported from `src/gold/distilUsageCache.ts` because that file is gone with the model call it existed to
 * calibrate — this type is the one piece of it still worth keeping, as the shape of whatever historical
 * usage data an existing home's `usage.json` may still hold on disk from before this change.
 */

import { absentAsNumber } from "#lib/absent.js";

/** One batch's captured usage, as `distil` used to persist it for cost calibration. Cost is optional. */
export interface PersistedBatchUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
}

/**
 * The COLD fallback `~tokens/batch` when the usage cache is empty (nothing has been distilled yet, or — the
 * only case that exists now — the calibration data can never be written again). A deliberately rough
 * single-batch envelope, always labelled "cold estimate" so it's never mistaken for measured data.
 */
export const COLD_TOKENS_PER_BATCH = 8000;

/** The per-batch rate + its provenance (how many real batches calibrated it; 0 ⇒ the cold fallback). */
export interface CalibratedRate {
  readonly tokensPerBatch: number;
  readonly costUsdPerBatch?: number;
  /** Number of real distilled batches whose captured usage calibrated this rate (0 ⇒ cold estimate). */
  readonly calibratedFrom: number;
}

/**
 * Derive the per-batch rate from the persisted real usages: the mean input+output tokens per batch (and the
 * mean cost over the batches that reported one). No usages ⇒ the cold default. Pure.
 *
 * @param usageByHash the persisted per-batch usage (content-hash → captured usage)
 * @returns the calibrated (or cold) rate
 */
export function calibrateRate({
  usageByHash,
}: {
  usageByHash: ReadonlyMap<string, PersistedBatchUsage>;
}): CalibratedRate {
  const usages = [...usageByHash.values()];
  if (usages.length === 0) {
    return { calibratedFrom: 0, tokensPerBatch: COLD_TOKENS_PER_BATCH };
  }
  const totalTokens = usages.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
  // Only expose a $/batch when EVERY calibrating batch carried a cost — else the token mean (over all
  // batches) and a cost mean (over a subset) would come from different populations, so the reported `$` and
  // `tokens` would be internally inconsistent. All-or-nothing keeps them the same population.
  const allHaveCost = usages.every((u) => u.costUsd !== undefined);
  const costUsdPerBatch = allHaveCost
    ? usages.reduce((sum, u) => sum + absentAsNumber({ value: u.costUsd, whenAbsent: 0 }), 0) / usages.length
    : undefined;
  return {
    calibratedFrom: usages.length,
    tokensPerBatch: Math.round(totalTokens / usages.length),
    ...(costUsdPerBatch !== undefined ? { costUsdPerBatch } : {}),
  };
}

/** The estimated distil cost: the initial full backfill + the ongoing marginal, at the calibrated rate. */
export interface DistilCostEstimate {
  readonly totalBatches: number;
  readonly uncachedBatches: number;
  readonly rate: CalibratedRate;
  readonly initialTokens: number;
  readonly initialCostUsd?: number;
  readonly ongoingTokensPerChangedBatch: number;
  readonly ongoingCostUsdPerChangedBatch?: number;
}

/**
 * Estimate the distil cost from the current batch plan + digest cache + calibrated rate. `initial` = the
 * unique currently-uncached batches × the rate (a `distil --full` right now); `ongoing` = one changed batch
 * × the rate (the marginal cost of a steady-state refresh, since the cache serves everything unchanged).
 * Pure.
 *
 * @param batchHashes every batch content-hash in the current plan (from `groupForDistil`)
 * @param cachedHashes the hashes already in the digest cache (served without a model call)
 * @param rate the calibrated (or cold) per-batch rate
 * @returns the cost estimate
 */
export function estimateDistilCost({
  batchHashes,
  cachedHashes,
  rate,
}: {
  batchHashes: readonly string[];
  cachedHashes: ReadonlySet<string>;
  rate: CalibratedRate;
}): DistilCostEstimate {
  const uniqueHashes = new Set(batchHashes);
  const uncached = [...uniqueHashes].filter((hash) => !cachedHashes.has(hash)).length;
  return {
    initialTokens: uncached * rate.tokensPerBatch,
    ongoingTokensPerChangedBatch: rate.tokensPerBatch,
    rate,
    totalBatches: uniqueHashes.size,
    uncachedBatches: uncached,
    ...(rate.costUsdPerBatch !== undefined
      ? {
          initialCostUsd: uncached * rate.costUsdPerBatch,
          ongoingCostUsdPerChangedBatch: rate.costUsdPerBatch,
        }
      : {}),
  };
}
