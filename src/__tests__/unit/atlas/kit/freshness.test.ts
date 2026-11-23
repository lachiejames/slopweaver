import { describe, expect, it } from "vitest";

import { assessFreshness, historicalQualifier } from "../../../../atlas/kit/freshness.js";
import { DEFAULT_ATLAS_FRESHNESS_WINDOW_MS } from "../../../../atlas/kit/freshnessWindow.js";

const NOW_MS = Date.parse("2026-01-10T00:00:00.000Z");

describe("assessFreshness", () => {
  it("is never-synced when there is no recorded success", () => {
    const result = assessFreshness({ lastSuccessAt: null, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("never-synced");
    expect(result.mayQuoteAsCurrent).toBe(false);
  });

  it("is current inside the four-hour default window", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString(),
      latestAttemptFailed: false,
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("current");
    expect(result.mayQuoteAsCurrent).toBe(true);
    expect(result.windowMs).toBe(DEFAULT_ATLAS_FRESHNESS_WINDOW_MS);
  });

  it("is historical past the four-hour default window", () => {
    const pastTheWindow = new Date(NOW_MS - DEFAULT_ATLAS_FRESHNESS_WINDOW_MS - 60_000).toISOString();
    const result = assessFreshness({ lastSuccessAt: pastTheWindow, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("historical");
    expect(result.mayQuoteAsCurrent).toBe(false);
    expect(result.notes[0]).toContain("past the 4h window");
  });

  it("defaults the window to four hours", () => {
    expect(DEFAULT_ATLAS_FRESHNESS_WINDOW_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("is historical when the latest attempt failed, even if recent", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 60_000).toISOString(),
      latestAttemptFailed: true,
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("historical");
  });

  it("is indeterminate for an unparseable timestamp", () => {
    const result = assessFreshness({ lastSuccessAt: "not-a-date", latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("indeterminate");
    expect(result.ageMs).toBeNull();
  });

  it("is indeterminate for a future timestamp", () => {
    const future = new Date(NOW_MS + 60_000).toISOString();
    const result = assessFreshness({ lastSuccessAt: future, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(result.verdict).toBe("indeterminate");
  });

  it("honours a custom window", () => {
    const twoDaysAgo = new Date(NOW_MS - 2 * 86_400_000).toISOString();
    const result = assessFreshness({
      lastSuccessAt: twoDaysAgo,
      latestAttemptFailed: false,
      nowMs: NOW_MS,
      windowMs: 7 * 86_400_000,
    });
    expect(result.verdict).toBe("current");
  });

  it("is current on a bounded live read inside the window, however old the stored sync is", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 30 * 86_400_000).toISOString(),
      latestAttemptFailed: false,
      liveReadAt: new Date(NOW_MS - 60_000).toISOString(),
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("current");
    expect(result.mayQuoteAsCurrent).toBe(true);
    expect(result.notes[0]).toBe("this rests on a bounded live read inside 4h, not on the stored generation");
  });

  it("is current on a bounded live read even when nothing has ever synced", () => {
    const result = assessFreshness({
      lastSuccessAt: null,
      latestAttemptFailed: false,
      liveReadAt: new Date(NOW_MS - 1000).toISOString(),
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("current");
    expect(result.ageMs).toBeNull();
  });

  it("ignores a live read that is itself past the window", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 30 * 86_400_000).toISOString(),
      latestAttemptFailed: false,
      liveReadAt: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString(),
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("historical");
  });

  it("ignores a live read stamped in the future", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 30 * 86_400_000).toISOString(),
      latestAttemptFailed: false,
      liveReadAt: new Date(NOW_MS + 60_000).toISOString(),
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("historical");
  });

  it("ignores an unreadable live-read stamp", () => {
    const result = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 30 * 86_400_000).toISOString(),
      latestAttemptFailed: false,
      liveReadAt: "not-a-date",
      nowMs: NOW_MS,
    });
    expect(result.verdict).toBe("historical");
  });
});

describe("historicalQualifier", () => {
  it("is empty for a current assessment", () => {
    const assessment = assessFreshness({
      lastSuccessAt: new Date(NOW_MS - 60_000).toISOString(),
      latestAttemptFailed: false,
      nowMs: NOW_MS,
    });
    expect(historicalQualifier({ assessment })).toBe("");
  });

  it("names never-synced when there is no success", () => {
    const assessment = assessFreshness({ lastSuccessAt: null, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(historicalQualifier({ assessment })).toBe(" [never synced]");
  });

  it("names the historical date when stale", () => {
    const eightDaysAgo = new Date(NOW_MS - 8 * 86_400_000).toISOString();
    const assessment = assessFreshness({ lastSuccessAt: eightDaysAgo, latestAttemptFailed: false, nowMs: NOW_MS });
    expect(historicalQualifier({ assessment })).toBe(` [historical as of ${eightDaysAgo}]`);
  });
});
