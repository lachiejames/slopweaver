/**
 * `corpusFreshnessWindowMs`: the window each source answers. The override map is private, so a source
 * answering four hours is pinned by its value, not by whether it declares an override.
 */
import { describe, expect, it } from "vitest";

import { corpusFreshnessWindowMs, DEFAULT_CORPUS_FRESHNESS_WINDOW_MS } from "../../../corpus/freshnessPolicy.js";

const HOUR_MS = 3_600_000;

describe("corpusFreshnessWindowMs", () => {
  it("the default window is four hours", () => {
    expect(DEFAULT_CORPUS_FRESHNESS_WINDOW_MS).toBe(14_400_000);
  });

  it("notion is eight hours", () => {
    expect(corpusFreshnessWindowMs({ source: "notion" })).toBe(8 * HOUR_MS);
  });

  it("gmail is twelve hours", () => {
    expect(corpusFreshnessWindowMs({ source: "gmail" })).toBe(12 * HOUR_MS);
  });

  it("calendar is a day", () => {
    expect(corpusFreshnessWindowMs({ source: "calendar" })).toBe(24 * HOUR_MS);
  });

  it("fathom is a day", () => {
    expect(corpusFreshnessWindowMs({ source: "fathom" })).toBe(24 * HOUR_MS);
  });

  it("gives slack a four-hour window, the same as the default", () => {
    expect(corpusFreshnessWindowMs({ source: "slack" })).toBe(4 * HOUR_MS);
  });

  it("gives linear a four-hour window, the same as the default", () => {
    expect(corpusFreshnessWindowMs({ source: "linear" })).toBe(4 * HOUR_MS);
  });

  it("gives github a four-hour window, the same as the default", () => {
    expect(corpusFreshnessWindowMs({ source: "github" })).toBe(4 * HOUR_MS);
  });
});
