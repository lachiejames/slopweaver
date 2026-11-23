/**
 * The model weighting that makes two sessions comparable.
 *
 * Three properties carry the design and each has its own describe block: the longest-prefix rule that stops
 * Fable 5.1 being priced as Fable 5, the exclusion-by-name of a model the card does not know, and the fact
 * that the whole thing is an INDEX whose card identity travels with every number.
 */
import { describe, expect, it } from "vitest";
import type { Measured } from "../../../measurement/status.js";
import { CLAUDE_MODEL_WEIGHT_CARD, claudeUsageModelFamily, modelWeightedUsage } from "../../../sessions/modelWeight.js";
import type { ModelUsageTotals, UsageTotals } from "../../../sessions/sessionCost.js";

/**
 * The value of a `Measured` the test asserts is known — throwing rather than branching, the same shape
 * `.claude/rules/testing.md` prescribes for unwrapping a `Result`, so no assertion below carries a
 * conditional.
 */
function unwrapMeasured<T>({ measured }: { measured: Measured<T> }): T {
  if (!measured.known) {
    throw new Error(`expected a measured value, got: ${measured.why}`);
  }
  return measured.value;
}

/** The reason an unmeasurable `Measured` gives, throwing if it turned out to be measured after all. */
function unwrapWhy<T>({ measured }: { measured: Measured<T> }): string {
  if (measured.known) {
    throw new Error("expected an unmeasurable value, got a measured one");
  }
  return measured.why;
}

/** One model's totals, spelled out so every assertion below is arithmetic a reader can redo. */
function totals({
  turns = 1,
  input = 0,
  output = 0,
  cacheRead = 0,
  cacheCreation = 0,
}: {
  turns?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
}): UsageTotals {
  return {
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    inputTokens: input,
    outputTokens: output,
    turns,
  };
}

describe("claudeUsageModelFamily", () => {
  it("resolves Sonnet 5", () => {
    expect(claudeUsageModelFamily({ model: "claude-sonnet-5" })).toBe("sonnet-5");
  });

  it("resolves Opus 5", () => {
    expect(claudeUsageModelFamily({ model: "claude-opus-5" })).toBe("opus-5");
  });

  it("resolves Opus 5.5 to its OWN family, not to Opus 5", () => {
    expect(claudeUsageModelFamily({ model: "claude-opus-5-5" })).toBe("opus-5.5");
  });

  it("resolves Haiku 4.5 from its dated id", () => {
    expect(claudeUsageModelFamily({ model: "claude-haiku-4-5-20251001" })).toBe("haiku-4.5");
  });

  it("resolves Fable 5.1 to its OWN family, not to Fable 5", () => {
    expect(claudeUsageModelFamily({ model: "claude-fable-5-1" })).toBe("fable-5.1");
  });

  it("still resolves plain Fable 5", () => {
    expect(claudeUsageModelFamily({ model: "claude-fable-5" })).toBe("fable-5");
  });

  it("answers undefined for a model the card does not name", () => {
    expect(claudeUsageModelFamily({ model: "claude-nextthing-9" })).toBe(undefined);
  });
});

describe("the two Fable rows differ, which is why the prefix order matters", () => {
  it("prices a Fable 5.1 cache read at a quarter of a Fable 5 one", () => {
    const fable51 = CLAUDE_MODEL_WEIGHT_CARD.rows.find((row) => row.family === "fable-5.1")!;
    const fable5 = CLAUDE_MODEL_WEIGHT_CARD.rows.find((row) => row.family === "fable-5")!;
    expect(fable51.weights.cacheRead).toBe(0.125);
    expect(fable5.weights.cacheRead).toBe(0.5);
  });

  it("gives them the same fresh-input weight, so only the cache tier separates them", () => {
    const fable51 = CLAUDE_MODEL_WEIGHT_CARD.rows.find((row) => row.family === "fable-5.1")!;
    const fable5 = CLAUDE_MODEL_WEIGHT_CARD.rows.find((row) => row.family === "fable-5")!;
    expect(fable51.weights.input).toBe(fable5.weights.input);
  });
});

describe("Opus 5.5 is a cheaper Opus, which is why it cannot share the Opus 5 row", () => {
  it("prices every token kind at its own published rate over Sonnet 5's $2 input", () => {
    const opus55 = CLAUDE_MODEL_WEIGHT_CARD.rows.find((row) => row.family === "opus-5.5")!;
    expect(opus55.weights).toEqual({ cacheCreation: 2.5, cacheRead: 0.1, input: 2, output: 10 });
  });

  it("weights one million Opus 5.5 cache reads at 40% of the same read on Opus 5", () => {
    const opus55 = modelWeightedUsage({
      usage: [{ model: "claude-opus-5-5", totals: totals({ cacheRead: 1_000_000 }) }],
    });
    const opus5 = modelWeightedUsage({ usage: [{ model: "claude-opus-5", totals: totals({ cacheRead: 1_000_000 }) }] });
    expect(unwrapMeasured({ measured: opus55 }).units).toBe(100_000);
    expect(unwrapMeasured({ measured: opus5 }).units).toBe(250_000);
  });
});

describe("modelWeightedUsage", () => {
  it("weights one Sonnet input token as exactly one unit, which is the basis", () => {
    const usage: readonly ModelUsageTotals[] = [{ model: "claude-sonnet-5", totals: totals({ input: 1 }) }];
    expect(unwrapMeasured({ measured: modelWeightedUsage({ usage }) }).units).toBe(1);
  });

  it("weights an Opus cache read at 2.5x a Sonnet cache read", () => {
    const sonnet = modelWeightedUsage({
      usage: [{ model: "claude-sonnet-5", totals: totals({ cacheRead: 1_000_000 }) }],
    });
    const opus = modelWeightedUsage({
      usage: [{ model: "claude-opus-5", totals: totals({ cacheRead: 1_000_000 }) }],
    });
    expect(unwrapMeasured({ measured: sonnet }).units).toBe(100_000);
    expect(unwrapMeasured({ measured: opus }).units).toBe(250_000);
  });

  it("sums across families and reports the biggest contributor first", () => {
    const usage: readonly ModelUsageTotals[] = [
      { model: "claude-sonnet-5", totals: totals({ cacheRead: 1_000_000, turns: 10 }) },
      { model: "claude-fable-5-1", totals: totals({ cacheRead: 1_000_000, turns: 2 }) },
    ];
    const value = unwrapMeasured({ measured: modelWeightedUsage({ usage }) });
    expect(value.units).toBe(225_000);
    expect(value.byFamily.map((entry) => entry.family)).toEqual(["fable-5.1", "sonnet-5"]);
  });

  it("shows the inversion the whole card exists for: fewer turns, more units", () => {
    const usage: readonly ModelUsageTotals[] = [
      { model: "claude-sonnet-5", totals: totals({ cacheRead: 1_000_000, turns: 10 }) },
      { model: "claude-fable-5-1", totals: totals({ cacheRead: 1_000_000, turns: 2 }) },
    ];
    const value = unwrapMeasured({ measured: modelWeightedUsage({ usage }) });
    const fable = value.byFamily.find((entry) => entry.family === "fable-5.1")!;
    const sonnet = value.byFamily.find((entry) => entry.family === "sonnet-5")!;
    expect(fable.totals.turns).toBe(2);
    expect(sonnet.totals.turns).toBe(10);
    expect(fable.units).toBe(125_000);
    expect(sonnet.units).toBe(100_000);
  });

  it("folds two ids of one family into a single row", () => {
    const usage: readonly ModelUsageTotals[] = [
      { model: "claude-haiku-4-5", totals: totals({ input: 100, turns: 1 }) },
      { model: "claude-haiku-4-5-20251001", totals: totals({ input: 100, turns: 1 }) },
    ];
    const value = unwrapMeasured({ measured: modelWeightedUsage({ usage }) });
    expect(value.byFamily.length).toBe(1);
    expect(value.byFamily[0]!.totals.turns).toBe(2);
    expect(value.units).toBe(100);
  });
});

describe("an unknown model is excluded by name, never given a default weight", () => {
  const usage: readonly ModelUsageTotals[] = [
    { model: "claude-opus-5", totals: totals({ input: 1000, turns: 7 }) },
    { model: "claude-nextthing-9", totals: totals({ input: 999_999, turns: 3 }) },
  ];
  const value = unwrapMeasured({ measured: modelWeightedUsage({ usage }) });

  it("contributes nothing to the units", () => {
    expect(value.units).toBe(2500);
  });

  it("names the model it could not weight", () => {
    expect(value.excludedModels).toEqual(["claude-nextthing-9"]);
  });

  it("reports coverage against the session's whole turn count", () => {
    expect(value.coveredTurns).toBe(7);
    expect(value.totalTurns).toBe(10);
  });
});

describe("an empty split is unmeasurable rather than zero", () => {
  it("says so, because a zero would read as a free session", () => {
    const result = modelWeightedUsage({ usage: [] });
    expect(result.known).toBe(false);
    expect(unwrapWhy({ measured: result })).toContain("no per-model usage");
  });
});

describe("the card travels with the numbers derived from it", () => {
  it("carries a dated id", () => {
    expect(CLAUDE_MODEL_WEIGHT_CARD.id).toBe("anthropic-list-price-ratio-2026-09-24");
    expect(CLAUDE_MODEL_WEIGHT_CARD.asOf).toBe("2026-09-24");
  });

  it("states the basis its ratios are normalised to", () => {
    expect(CLAUDE_MODEL_WEIGHT_CARD.basis).toBe("one fresh Sonnet 5 input token = 1 unit");
  });

  it("covers every family the fleet actually runs", () => {
    expect(CLAUDE_MODEL_WEIGHT_CARD.rows.map((row) => row.family).toSorted()).toEqual([
      "fable-5",
      "fable-5.1",
      "haiku-4.5",
      "opus-5",
      "opus-5.5",
      "sonnet-5",
    ]);
  });
});
