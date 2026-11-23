/** The item-level pieces both digest cards share: the count sentence and an index line's metrics. */
import { describe, expect, it } from "vitest";

import type { DigestItem } from "../../../../outbound/artifact/digestFields.js";
import { countSentence, itemMetrics } from "../../../../outbound/artifact/digestParts.js";

const RED: DigestItem = { count: 4, severity: "red", title: "NZ push-token registration" };
const GREEN: DigestItem = { count: 0, severity: "green", title: "notification transition race" };

describe("countSentence", () => {
  it("names only the non-zero buckets, worst first", () => {
    expect(countSentence({ items: [GREEN, RED, GREEN] })).toBe("1 red, 2 green");
  });

  it("is empty for no items", () => {
    expect(countSentence({ items: [] })).toBe("");
  });
});

describe("itemMetrics", () => {
  it("is the bare count with no trend", () => {
    expect(itemMetrics({ item: RED })).toBe("4");
  });

  it("appends the trend after a comma", () => {
    expect(itemMetrics({ item: { ...RED, trend: "rising" } })).toBe("4, rising");
  });
});
