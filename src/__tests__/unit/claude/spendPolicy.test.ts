/**
 * The owner's usage limit applied to dollars: the integer comparison at, under and over the limit, the freshness
 * bound, and every way a reading is not evidence.
 */
import { describe, expect, it } from "vitest";

import {
  CLAUDE_SPEND_FRESH_MS,
  type ClaudeSpendReading,
  claudeSpendVerdict,
  formatSpend,
} from "../../../claude/spendPolicy.js";

const NOW = "2026-11-04T10:00:00.000Z";

/** A fresh reading of a 500.00 USD month with `usedMinor` spent. */
function readingOf({ usedMinor, ...over }: { usedMinor: number } & Partial<ClaudeSpendReading>): ClaudeSpendReading {
  return {
    alias: "plan-six",
    currency: "USD",
    decimalPlaces: 2,
    isEnabled: true,
    monthlyLimitMinor: 50_000,
    observedAtIso: "2026-11-04T09:30:00.000Z",
    spendLimitReached: false,
    usedMinor,
    ...over,
  };
}

describe("claudeSpendVerdict", () => {
  it("is open under the limit, with the headroom left in minor units", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor: 10_000 }),
      usageLimitPercent: 50,
    });
    expect(verdict).toEqual({
      currency: "USD",
      headroomMinor: 15_000,
      kind: "open",
      reason: "100.00 USD spent of 500.00 USD this month, usage limit 50% = 250.00 USD, 150.00 USD left",
      usedFraction: 0.4,
    });
  });

  it("is at the usage limit exactly at it — fifty percent and no more", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor: 25_000 }),
      usageLimitPercent: 50,
    });
    expect(verdict).toEqual({
      kind: "usage-limit",
      reason: "250.00 USD spent of 500.00 USD this month, usage limit 50% = 250.00 USD, at its usage limit",
    });
  });

  it("is open one cent under the limit", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor: 24_999 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("open");
  });

  it("is at the usage limit over it, on a 10% limit", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor: 5_001 }),
      usageLimitPercent: 10,
    });
    expect(verdict.kind).toBe("usage-limit");
  });

  it("is at the usage limit at the whole month's limit on a 100% limit", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor: 50_000 }),
      usageLimitPercent: 100,
    });
    expect(verdict.kind).toBe("usage-limit");
  });

  it("is not measured with no reading, and names the verb that reads one", () => {
    const verdict = claudeSpendVerdict({ alias: "plan-six", nowIso: NOW, reading: undefined, usageLimitPercent: 50 });
    expect(verdict).toEqual({
      kind: "not-measured",
      reason: "no spend reading recorded — `slopweaver claude spend --plan plan-six` reads one",
    });
  });

  it("still trusts a reading exactly an hour old", () => {
    const observedAtIso = new Date(Date.parse(NOW) - CLAUDE_SPEND_FRESH_MS).toISOString();
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ observedAtIso, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("open");
  });

  it("is not measured on a reading over an hour old", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ observedAtIso: "2026-11-04T08:59:59.999Z", usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict).toEqual({
      kind: "not-measured",
      reason: "its spend reading from 2026-11-04T08:59:59.999Z is over an hour old",
    });
  });

  it("is not measured on a reading dated after now", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ observedAtIso: "2026-11-04T10:00:00.001Z", usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });

  it("is not measured on a reading whose instant does not parse", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ observedAtIso: "yesterday", usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });

  it("is provider-refused when extra usage is disabled, whatever the figures", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ isEnabled: false, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict).toEqual({
      kind: "provider-refused",
      reason: "the provider reports extra usage disabled",
    });
  });

  it("is provider-refused when the provider says its spend limit is reached", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ spendLimitReached: true, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("provider-refused");
  });

  it("is not measured when a recorded currency is only whitespace", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ currency: " ", usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });

  it("is not measured when the provider reports no monthly limit", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ monthlyLimitMinor: null, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict).toEqual({
      kind: "not-measured",
      reason: "the provider reports no monthly limit and spend to measure",
    });
  });

  it("is not measured on a zero limit rather than at it", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ monthlyLimitMinor: 0, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("is not measured, never open, on a spend of %s", (usedMinor) => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ usedMinor }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });

  it("is not measured, never open, on a limit that is not a number", () => {
    const verdict = claudeSpendVerdict({
      alias: "plan-six",
      nowIso: NOW,
      reading: readingOf({ monthlyLimitMinor: Number.NaN, usedMinor: 0 }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("not-measured");
  });
});

describe("formatSpend", () => {
  it("prints minor units as major ones at the currency's places", () => {
    expect(formatSpend({ currency: "USD", decimalPlaces: 2, minor: 12_345 })).toBe("123.45 USD");
  });

  it("prints the minor figure as sent when the places are unknown", () => {
    expect(formatSpend({ currency: "JPY", decimalPlaces: null, minor: 700 })).toBe("700 minor units of JPY");
  });
});
