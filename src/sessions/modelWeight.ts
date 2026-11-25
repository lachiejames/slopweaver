/**
 * What a token COSTS relative to another token — the model weighting that makes two sessions comparable.
 *
 * ## Why this exists, and why `sessions/sessionCost.ts` was right to refuse it
 *
 * That module reports tokens and not dollars, on the stated ground that this repository has no rate card. It
 * was right when the fleet was effectively one model. It stopped being right when the fleet became four:
 * MEASURED over 822 transcripts recently touched (133,445 assistant turns, deduplicated by
 * `message.id`), Fable took **30.8% of notional spend on 15.9% of the tokens**, so a token-only panel
 * understates it by about 2x and points a supervisor at the wrong sessions. Reproduce the split:
 *
 * ```
 * slopweaver session depth --json
 * ```
 *
 * The owner's ruling of the same day asked for exactly this: usage is model weighted, because the fleet mixes
 * Sonnet, Opus and Fable and the point is using the right tool for the job.
 *
 * ## It is an INDEX, and that word is load-bearing
 *
 * The unit here is "model-weighted index units", never dollars, and four separate facts make a dollar figure
 * a lie rather than an approximation:
 *
 * - the fleet runs on flat-rate Max plans, so nothing is billed per token at all;
 * - a transcript records cumulative totals and not cache-write DURATION, so a 5-minute and a 1-hour cache
 *   write are indistinguishable here while costing 1.25x and 2x respectively;
 * - long-context pricing tiers cannot be reconstructed from those totals either;
 * - published prices drift, and this file does not.
 *
 * So the weights are RATIOS, normalised to one fresh Sonnet 5 input token, and every render prints
 * {@link ModelWeightCard.id} and {@link ModelWeightCard.asOf} beside the number. A ratio that has drifted is
 * still a usable ranking; a dollar figure that has drifted is a wrong bill.
 *
 * ## An unknown model is EXCLUDED, never defaulted
 *
 * A model this card does not name contributes nothing and is reported by name in
 * {@link ModelWeightedUsage.excludedModels}, with {@link ModelWeightedUsage.coveredTurns} against
 * {@link ModelWeightedUsage.totalTurns} so a reader can see how much of the session the number covers.
 * Giving an unrecognised model a default weight would silently price a new model as an old one, which is the
 * exact failure that makes a spend panel worth less than no panel.
 *
 * Pure: totals in, weighted units out. Nothing here reads a file.
 */
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import type { ModelUsageTotals, UsageTotals } from "./sessionCost.js";

/** The model families this card can weight. A transcript naming anything else is excluded by name. */
export type ClaudeUsageModelFamily = "haiku-4.5" | "sonnet-5" | "opus-5" | "opus-5.5" | "fable-5" | "fable-5.1";

/**
 * What one token of each kind costs, relative to one fresh Sonnet 5 input token.
 *
 * @internal — reachable through {@link ModelWeightCardRow}; nothing imports it by name.
 */
export interface ModelTokenWeights {
  readonly input: number;
  readonly output: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
}

/**
 * One family's weights, and the model-id prefixes that resolve to it.
 *
 * @internal — reachable through {@link ModelWeightCard.rows}.
 */
export interface ModelWeightCardRow {
  readonly family: ClaudeUsageModelFamily;
  /**
   * Matched longest-first, so `claude-fable-5-1` can never resolve to the `claude-fable-5` row, nor
   * `claude-opus-5-5` to the `claude-opus-5` one.
   */
  readonly modelPrefixes: readonly string[];
  readonly weights: ModelTokenWeights;
}

/** A dated set of ratios, carried with every number derived from it. */
export interface ModelWeightCard {
  readonly id: string;
  readonly asOf: string;
  readonly basis: string;
  readonly rows: readonly ModelWeightCardRow[];
}

/**
 * The committed ratio card.
 *
 * Derived from Anthropic's published list prices, divided
 * through by Sonnet 5's $2/MTok input rate: Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25, Opus 5.5
 * $4/$20, Fable 5 and 5.1 $10/$50. Cache reads are 0.1x a family's own input rate and cache writes 1.25x
 * it, except two whose published cache-read rate is lower: Fable 5.1 at $0.25/MTok (0.025x its input) and
 * Opus 5.5 at $0.20/MTok (0.05x its input). Cache writes are carried at the 5-minute
 * 1.25x multiplier; sessions here use the 1-hour TTL, which writes at 2x — at ~1.0% of fleet tokens that
 * choice moves a total by well under a percent, and the transcript cannot distinguish the two anyway.
 *
 * Re-derive the fleet split this card is calibrated against:
 *
 * ```
 * slopweaver session depth --json
 * ```
 */
export const CLAUDE_MODEL_WEIGHT_CARD: ModelWeightCard = {
  asOf: "2026-09-24",
  basis: "one fresh Sonnet 5 input token = 1 unit",
  id: "anthropic-list-price-ratio-2026-09-24",
  rows: [
    {
      family: "haiku-4.5",
      modelPrefixes: ["claude-haiku-4-5"],
      weights: { cacheCreation: 0.625, cacheRead: 0.05, input: 0.5, output: 2.5 },
    },
    {
      family: "sonnet-5",
      modelPrefixes: ["claude-sonnet-5"],
      weights: { cacheCreation: 1.25, cacheRead: 0.1, input: 1, output: 5 },
    },
    {
      family: "opus-5",
      modelPrefixes: ["claude-opus-5"],
      weights: { cacheCreation: 3.125, cacheRead: 0.25, input: 2.5, output: 12.5 },
    },
    {
      family: "opus-5.5",
      modelPrefixes: ["claude-opus-5-5"],
      weights: { cacheCreation: 2.5, cacheRead: 0.1, input: 2, output: 10 },
    },
    {
      family: "fable-5.1",
      modelPrefixes: ["claude-fable-5-1", "claude-mythos-5-1"],
      weights: { cacheCreation: 6.25, cacheRead: 0.125, input: 5, output: 25 },
    },
    {
      family: "fable-5",
      modelPrefixes: ["claude-fable-5", "claude-mythos-5"],
      weights: { cacheCreation: 6.25, cacheRead: 0.5, input: 5, output: 25 },
    },
  ],
};

/**
 * One family's weighted contribution.
 *
 * @internal — reachable through {@link ModelWeightedUsage.byFamily}.
 */
export interface WeightedModelUsage {
  readonly family: ClaudeUsageModelFamily;
  readonly units: number;
  readonly totals: UsageTotals;
}

/** A weighted total, with the coverage that says how much of the session it speaks for. */
export interface ModelWeightedUsage {
  readonly units: number;
  readonly coveredTurns: number;
  readonly totalTurns: number;
  /** Model ids this card does not name, verbatim and sorted. Never silently weighted. */
  readonly excludedModels: readonly string[];
  readonly byFamily: readonly WeightedModelUsage[];
}

/**
 * Which family a transcript's model id belongs to.
 *
 * Prefixes are matched LONGEST FIRST rather than in card order, because `claude-fable-5-1` also starts with
 * `claude-fable-5` and card order is not a contract a future editor would know to preserve.
 *
 * @param model the model id exactly as the transcript reported it
 * @returns the family, or `undefined` when this card names none
 */
export function claudeUsageModelFamily({ model }: { model: string }): ClaudeUsageModelFamily | undefined {
  const candidates = CLAUDE_MODEL_WEIGHT_CARD.rows
    .flatMap((row) => row.modelPrefixes.map((prefix) => ({ family: row.family, prefix })))
    .toSorted((left, right) => right.prefix.length - left.prefix.length);
  return candidates.find((candidate) => model.startsWith(candidate.prefix))?.family;
}

/** An empty total, the identity a family's fold starts from. */
const ZERO: UsageTotals = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  turns: 0,
};

/** One family's totals folded together as the weighting accumulates them. */
function addTotals({ left, right }: { left: UsageTotals; right: UsageTotals }): UsageTotals {
  return {
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    turns: left.turns + right.turns,
  };
}

/** The totals folded so far for one family, zero before that family's first entry. */
function familyTotals({
  byFamily,
  family,
}: {
  byFamily: ReadonlyMap<ClaudeUsageModelFamily, UsageTotals>;
  family: ClaudeUsageModelFamily;
}): UsageTotals {
  const folded = byFamily.get(family);
  if (folded === undefined) {
    return ZERO;
  }
  return folded;
}

/** What one family's totals are worth in index units. */
function unitsOf({ totals, weights }: { totals: UsageTotals; weights: ModelTokenWeights }): number {
  return (
    totals.inputTokens * weights.input +
    totals.outputTokens * weights.output +
    totals.cacheCreationTokens * weights.cacheCreation +
    totals.cacheReadTokens * weights.cacheRead
  );
}

/**
 * What a set of totals would be worth at one family's weights — the repricing a "same work on another model"
 * question needs, whichever family actually served the turns.
 *
 * @param totals the tokens to price
 * @param family the family whose weights price them
 * @param card the ratios to apply (defaults to {@link CLAUDE_MODEL_WEIGHT_CARD})
 * @returns the index units
 */
export function familyUnits({
  totals,
  family,
  card = CLAUDE_MODEL_WEIGHT_CARD,
}: {
  totals: UsageTotals;
  family: ClaudeUsageModelFamily;
  card?: ModelWeightCard;
}): number {
  return unitsOf({ totals, weights: card.rows.find((row) => row.family === family)!.weights });
}

/**
 * Weight a per-model split into comparable index units.
 *
 * Reports `NOT MEASURED` only when the split is empty — a session with turns but no recognised model is a
 * measured zero with its coverage stated, which is a different fact from having read nothing at all.
 *
 * @param usage the per-model split, from `sessions/sessionCost.ts`'s `modelUsageTotals`
 * @param card the ratios to apply (defaults to {@link CLAUDE_MODEL_WEIGHT_CARD})
 * @returns the weighted total, or why there is none
 */
export function modelWeightedUsage({
  usage,
  card = CLAUDE_MODEL_WEIGHT_CARD,
}: {
  usage: readonly ModelUsageTotals[];
  card?: ModelWeightCard;
}): Measured<ModelWeightedUsage> {
  if (usage.length === 0) {
    return unmeasurable({ why: "no per-model usage was folded for this session" });
  }
  const byFamily = new Map<ClaudeUsageModelFamily, UsageTotals>();
  const excluded: string[] = [];
  let totalTurns = 0;
  let coveredTurns = 0;
  for (const entry of usage) {
    totalTurns += entry.totals.turns;
    const family = claudeUsageModelFamily({ model: entry.model });
    if (family === undefined) {
      excluded.push(entry.model);
      continue;
    }
    coveredTurns += entry.totals.turns;
    byFamily.set(family, addTotals({ left: familyTotals({ byFamily, family }), right: entry.totals }));
  }
  const families = [...byFamily.entries()]
    .map(([family, totals]) => {
      const row = card.rows.find((candidate) => candidate.family === family)!;
      return { family, totals, units: unitsOf({ totals, weights: row.weights }) };
    })
    .toSorted((left, right) => right.units - left.units);
  return measured({
    value: {
      byFamily: families,
      coveredTurns,
      excludedModels: excluded.toSorted(),
      totalTurns,
      units: families.reduce((sum, entry) => sum + entry.units, 0),
    },
  });
}
