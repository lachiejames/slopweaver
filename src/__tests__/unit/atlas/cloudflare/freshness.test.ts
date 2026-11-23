import { describe, expect, it } from "vitest";

import {
  assessCloudflareFreshness,
  CLOUDFLARE_FRESHNESS_WINDOW_MS,
  cloudflareHistoricalQualifier,
} from "../../../../atlas/cloudflare/freshness.js";

const DAY_MS = 86_400_000;
const NOW_MS = Date.parse("2026-01-10T00:00:00.000Z");

describe("assessCloudflareFreshness", () => {
  it("reports never-synced when there is no prior success", () => {
    const result = assessCloudflareFreshness({ lastSuccessAt: null, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("never-synced");
    expect(result.mayQuoteAsCurrent).toBe(false);
  });

  it("reports current within the two-day limit", () => {
    const lastSuccessAt = new Date(NOW_MS - DAY_MS).toISOString();
    const result = assessCloudflareFreshness({ lastSuccessAt, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("current");
    expect(result.mayQuoteAsCurrent).toBe(true);
  });

  it("reports historical past the two-day limit", () => {
    const lastSuccessAt = new Date(NOW_MS - 3 * DAY_MS).toISOString();
    const result = assessCloudflareFreshness({ lastSuccessAt, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("historical");
    expect(result.mayQuoteAsCurrent).toBe(false);
  });

  it("takes its two-day window off its own descriptor", () => {
    expect(CLOUDFLARE_FRESHNESS_WINDOW_MS).toBe(2 * DAY_MS);
  });

  it("reports historical when the latest attempt failed, even if recent", () => {
    const lastSuccessAt = new Date(NOW_MS - 1000).toISOString();
    const result = assessCloudflareFreshness({ lastSuccessAt, latestAttemptFailed: true, nowMs: NOW_MS });
    expect(result.verdict).toBe("historical");
    expect(result.mayQuoteAsCurrent).toBe(false);
  });

  it("reports indeterminate for a future timestamp", () => {
    const lastSuccessAt = new Date(NOW_MS + DAY_MS).toISOString();
    const result = assessCloudflareFreshness({ lastSuccessAt, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("indeterminate");
  });

  it("reports indeterminate for an unparseable timestamp", () => {
    const result = assessCloudflareFreshness({
      lastSuccessAt: "not-a-date",
      latestAttemptFailed: false,
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("indeterminate");
  });

  it("honors an explicit window override", () => {
    const lastSuccessAt = new Date(NOW_MS - 5 * DAY_MS).toISOString();
    const result = assessCloudflareFreshness({
      latestAttemptFailed: false,
      lastSuccessAt,
      nowMs: NOW_MS,
      windowMs: 7 * DAY_MS,
    });
    expect(result.verdict).toBe("current");
  });
});

describe("cloudflareHistoricalQualifier", () => {
  it("is empty for a current assessment", () => {
    const assessment = assessCloudflareFreshness({
      lastSuccessAt: new Date(NOW_MS).toISOString(),
      latestAttemptFailed: false,
      nowMs: NOW_MS,
    });
    expect(cloudflareHistoricalQualifier({ assessment })).toBe("");
  });

  it("names never-synced when there is no prior success", () => {
    const assessment = assessCloudflareFreshness({ lastSuccessAt: null, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(cloudflareHistoricalQualifier({ assessment })).toBe(" [never synced]");
  });

  it("names the historical timestamp otherwise", () => {
    const lastSuccessAt = new Date(NOW_MS - 3 * DAY_MS).toISOString();
    const assessment = assessCloudflareFreshness({ lastSuccessAt, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(cloudflareHistoricalQualifier({ assessment })).toBe(` [historical as of ${lastSuccessAt}]`);
  });
});
