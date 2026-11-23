import { describe, expect, it } from "vitest";

import { carriesAny, DESCRIPTION_SENTINELS, descriptionShapeOf } from "../../../../outbound/github/bodyMarkers.js";
import { RETIRED_TABLE_MARKERS } from "../../../../outbound/github/legacy/bodyMarkers.js";
import { LAYOUT } from "../../../../outbound/github/render.js";

describe("carriesAny", () => {
  it("is true when one marker appears", () => {
    expect(carriesAny({ markers: ["x", "needle"], text: "hay needle hay" })).toBe(true);
  });

  it("is false when none appears or there are no markers", () => {
    expect([carriesAny({ markers: ["x"], text: "hay" }), carriesAny({ markers: [], text: "hay" })]).toEqual([
      false,
      false,
    ]);
  });
});

describe("descriptionShapeOf", () => {
  it("reads a body carrying a C3 heading as c3", () => {
    expect(descriptionShapeOf({ text: `intro\n\n${LAYOUT.problemHeading}\n` })).toBe("c3");
  });

  it("reads a body carrying only a retired-table marker as retired-table", () => {
    expect(descriptionShapeOf({ text: RETIRED_TABLE_MARKERS[0]! })).toBe("retired-table");
  });

  it("reads a reading-order marker as reading-order", () => {
    expect(descriptionShapeOf({ text: '<img src="img.shields.io/badge/solved-gold">' })).toBe("reading-order");
  });

  it("reads plain prose as none", () => {
    expect(descriptionShapeOf({ text: "Just words." })).toBe("none");
  });

  it("prefers c3 when a body carries markers of two shapes", () => {
    expect(descriptionShapeOf({ text: `${RETIRED_TABLE_MARKERS[0]!}\n${LAYOUT.rerunOpen}` })).toBe("c3");
  });
});

describe("DESCRIPTION_SENTINELS", () => {
  it("lists the C3 headings, the two badge hosts and the older shapes' markers", () => {
    expect(DESCRIPTION_SENTINELS).toContain(LAYOUT.notCheckedHeading);
    expect(DESCRIPTION_SENTINELS).toContain("img.shields.io/badge/risk-");
    expect(DESCRIPTION_SENTINELS).toContain("proof-commit:");
  });
});
