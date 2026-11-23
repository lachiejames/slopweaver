import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CodexPriceEstimate,
  type CodexRateCard,
  parseCodexRateCard,
  priceCodexAttempt,
} from "../../../codex/pricing.js";
import { readCodexRateCard } from "../../../codex/pricingStore.js";
import type { CodexUsage, UsageMeasurement } from "../../../codex/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/**
 * The example rate card, which lives HERE and never in `src/`.
 *
 * There is no Codex tariff in this repository on purpose (`src/codex/pricing.ts` opens with why), so the only
 * complete card in the tree is a fixture. Its numbers are invented for arithmetic that can be checked by
 * hand — a round $1/$2 per million — and its `source` says so, so nobody can lift it into an install.
 */
const CARD: CodexRateCard = {
  counterMapping: {
    cacheWriteIncludedInInput: false,
    cachedInputIncludedInInput: true,
    reasoningIncludedInOutput: true,
    verifiedBy: "a test fixture — these are invented round numbers, not a published tariff",
  },
  currency: "USD",
  effectiveFromIso: "2026-01-01T00:00:00.000Z",
  effectiveToIso: "2026-12-31T23:59:59.000Z",
  models: [
    {
      model: "gpt-6-astra",
      perMillionTokens: { cacheWriteInput: 4, cachedInput: 0.5, input: 1, output: 2 },
    },
  ],
  schemaVersion: 1,
  source: "a test fixture — invented round numbers, never a published tariff",
};

/** The same card as the JSON an operator would actually write. */
const CARD_JSON = {
  counterMapping: {
    cacheWriteIncludedInInput: false,
    cachedInputIncludedInInput: true,
    reasoningIncludedInOutput: true,
    verifiedBy: "a test fixture — these are invented round numbers, not a published tariff",
  },
  currency: "USD",
  effectiveFromIso: "2026-01-01T00:00:00.000Z",
  effectiveToIso: "2026-12-31T23:59:59.000Z",
  models: [{ model: "gpt-6-astra", perMillionTokens: { cacheWriteInput: 4, cachedInput: 0.5, input: 1, output: 2 } }],
  schemaVersion: 1,
  source: "a test fixture — invented round numbers, never a published tariff",
};

function usage({
  input = 0,
  cached = 0,
  cacheWrite = 0,
  output = 0,
  reasoning = 0,
}: {
  input?: number;
  cached?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
} = {}): UsageMeasurement {
  const counters: CodexUsage = {
    cache_write_input_tokens: cacheWrite,
    cached_input_tokens: cached,
    input_tokens: input,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
  };
  return { kind: "measured", usage: counters };
}

/** A priced estimate's amount, unwrapped by throwing rather than by a conditional in an assertion. */
function amountOf({ estimate }: { estimate: CodexPriceEstimate }): number {
  if (estimate.kind !== "priced") {
    throw new Error(`expected a priced estimate, got unpriced: ${estimate.reason}`);
  }
  return estimate.amount;
}

/** An unpriced estimate's reason, unwrapped by throwing. */
function reasonOf({ estimate }: { estimate: CodexPriceEstimate }): string {
  if (estimate.kind !== "unpriced") {
    throw new Error(`expected an unpriced estimate, got ${String(estimate.amount)}`);
  }
  return estimate.reason;
}

const IN_PERIOD = "2026-06-01T00:00:00.000Z";

describe("priceCodexAttempt", () => {
  it("charges no token twice: a cached subset is removed from its parent before the parent is billed", () => {
    // 1,000,000 input of which 400,000 are cached. The card calls cached a SUBSET, so 600,000 is billed at
    // $1/M and 400,000 at $0.50/M: 0.60 + 0.20 = 0.80. Billing the raw input would give 1.20.
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage({ cached: 400_000, input: 1_000_000 }),
    });

    expect(amountOf({ estimate })).toBeCloseTo(0.8, 10);
  });

  it("bills reasoning at the output rate whether or not the card calls it a subset", () => {
    const included = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage({ output: 1_000_000, reasoning: 300_000 }),
    });
    const separate = priceCodexAttempt({
      rateCard: { ...CARD, counterMapping: { ...CARD.counterMapping, reasoningIncludedInOutput: false } },
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage({ output: 700_000, reasoning: 300_000 }),
    });

    expect(amountOf({ estimate: included })).toBeCloseTo(2, 10);
    expect(amountOf({ estimate: separate })).toBeCloseTo(2, 10);
  });

  it("prices a MEASURED zero at zero, which is a number, not an absence", () => {
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage(),
    });

    expect(amountOf({ estimate })).toBe(0);
  });

  it("refuses to price an attempt the SDK never measured, naming the reason it was not measured", () => {
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: { kind: "not-measured", reason: "aborted" },
    });

    expect(reasonOf({ estimate })).toBe("the attempt reported no usage (aborted)");
  });

  it("prices nothing from a card whose counter mapping names nobody who verified it", () => {
    const estimate = priceCodexAttempt({
      rateCard: { ...CARD, counterMapping: { ...CARD.counterMapping, verifiedBy: "" } },
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage({ input: 1_000_000 }),
    });

    expect(reasonOf({ estimate })).toContain("names nobody who verified it");
  });

  it("refuses an unknown model by name rather than pricing it at another model's rate", () => {
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-7-unpublished",
      startedAtIso: IN_PERIOD,
      usage: usage({ input: 1_000_000 }),
    });

    expect(reasonOf({ estimate })).toBe("the card names no rate for the requested model gpt-7-unpublished");
  });

  it("refuses an attempt that started outside the card's effective period", () => {
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: "2025-06-01T00:00:00.000Z",
      usage: usage({ input: 1_000_000 }),
    });

    expect(reasonOf({ estimate })).toContain("outside the card's period from 2026-01-01T00:00:00.000Z");
  });

  it("refuses rather than clamping when a declared subset is LARGER than its parent", () => {
    // The card says cached sits inside input. A reading with more cached than input contradicts that, and a
    // clamp would price it anyway — a plausible number the card cannot explain.
    const estimate = priceCodexAttempt({
      rateCard: CARD,
      requestedModel: "gpt-6-astra",
      startedAtIso: IN_PERIOD,
      usage: usage({ cached: 900, input: 100 }),
    });

    expect(reasonOf({ estimate })).toContain("leaves a negative parent");
  });
});

describe("parseCodexRateCard", () => {
  it("accepts a complete card and carries its provenance through", () => {
    const card = unwrap(parseCodexRateCard({ value: CARD_JSON }));

    expect(card.currency).toBe("USD");
    expect(card.models.length).toBe(1);
    expect(card.counterMapping.cachedInputIncludedInInput).toBe(true);
  });

  it("reports EVERY problem rather than the first, because the failure list is the whole interface", () => {
    const broken = parseCodexRateCard({ value: { ...CARD_JSON, currency: "", models: [] } });

    expect(broken.isErr()).toBe(true);
    expect(broken._unsafeUnwrapErr().problems.length).toBeGreaterThan(1);
  });

  it("refuses a value that is not an object at all", () => {
    expect(unwrapErr(parseCodexRateCard({ value: "a card" })).problems).toEqual(["a rate card must be a JSON object"]);
  });

  it("refuses a model entry whose rates are not four finite non-negative numbers", () => {
    const negative = parseCodexRateCard({
      value: {
        ...CARD_JSON,
        models: [
          { model: "gpt-6-astra", perMillionTokens: { cacheWriteInput: 4, cachedInput: 0.5, input: -1, output: 2 } },
        ],
      },
    });

    expect(negative.isErr()).toBe(true);
    expect(negative._unsafeUnwrapErr().problems.join(" ")).toContain("models[0]");
  });
});

describe("readCodexRateCard", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway directory inside this file's own temp-root sandbox. */
  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), "codex-rates-"));
    dirs.push(dir);
    return dir;
  }

  it("round-trips a card written to disk", () => {
    const path = join(scratch(), "rates.json");
    writeFileSync(path, JSON.stringify(CARD_JSON), "utf8");

    const card = unwrap(readCodexRateCard({ path }));

    expect(card.models[0]?.perMillionTokens.input).toBe(1);
  });

  it("names the path when the file is not there, rather than pricing nothing silently", () => {
    const path = join(scratch(), "absent.json");

    const card = readCodexRateCard({ path });

    expect(card.isErr()).toBe(true);
    expect(card._unsafeUnwrapErr().code).toBe("RATE_CARD_UNREADABLE");
    expect(card._unsafeUnwrapErr().message).toContain(`could not read the rate card at ${path}`);
  });

  it("reports a file that is not JSON as a read failure, not as an empty card", () => {
    const path = join(scratch(), "rates.json");
    writeFileSync(path, "not json at all", "utf8");

    const card = readCodexRateCard({ path });

    expect(card.isErr()).toBe(true);
    expect(card._unsafeUnwrapErr().code).toBe("RATE_CARD_UNREADABLE");
  });

  it("reports a readable file whose CONTENT is not a card through the validator's own messages", () => {
    const path = join(scratch(), "rates.json");
    writeFileSync(path, JSON.stringify({ schemaVersion: 1 }), "utf8");

    const card = readCodexRateCard({ path });

    expect(card.isErr()).toBe(true);
    expect(card._unsafeUnwrapErr().code).toBe("RATE_CARD_INVALID");
    expect(card._unsafeUnwrapErr().problems.join(" ")).toContain("models");
  });
});
