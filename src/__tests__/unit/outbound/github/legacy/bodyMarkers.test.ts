import { describe, expect, it } from "vitest";

import {
  carriesAny,
  READING_ORDER_SENTINELS,
  READING_ORDER_SHAPE_MARKERS,
  RETIRED_TABLE_MARKERS,
} from "../../../../../outbound/github/legacy/bodyMarkers.js";
import { LAYOUT } from "../../../../../outbound/github/legacy/render.js";

describe("carriesAny", () => {
  it("is true when a marker appears on an ordinary line", () => {
    expect(carriesAny({ markers: ["needle"], text: "hay\nneedle\nhay" })).toBe(true);
  });

  it("is false for no markers or no match", () => {
    expect([carriesAny({ markers: [], text: "needle" }), carriesAny({ markers: ["x"], text: "needle" })]).toEqual([
      false,
      false,
    ]);
  });

  it("ignores a marker spelled inside a line that is wholly pasted media", () => {
    const pasted = '<img src="https://github.com/user-attachments/assets/abc" alt="needle">';
    expect(carriesAny({ markers: ["needle"], text: pasted })).toBe(false);
  });
});

describe("marker lists", () => {
  it("lists the reading-order headings and the retired solved badge as the reading-order shape", () => {
    expect(READING_ORDER_SHAPE_MARKERS).toContain(LAYOUT.riskHeading);
    expect(READING_ORDER_SHAPE_MARKERS).toContain("img.shields.io/badge/solved-");
  });

  it("lists the retired table's Next row", () => {
    expect(RETIRED_TABLE_MARKERS[0]).toBe("👉 <strong>Next</strong>");
  });

  it("holds every marker of either shape plus the two shared anchor lines as sentinels", () => {
    expect(READING_ORDER_SENTINELS).toEqual([
      ...READING_ORDER_SHAPE_MARKERS,
      "proof-commit:",
      "proof-patch-id:",
      ...RETIRED_TABLE_MARKERS,
    ]);
  });
});
