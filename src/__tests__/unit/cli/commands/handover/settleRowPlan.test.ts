import { describe, expect, it } from "vitest";

import { settlePlan } from "../../../../../cli/commands/handover/settleRowPlan.js";

describe("settlePlan", () => {
  it("reads an answered settle off its flags", () => {
    expect(settlePlan({ positionals: ["the-ask"], values: { as: "answered", witness: " #2440 " } })).toEqual({
      disposition: undefined,
      reason: undefined,
      settlement: "answered",
      slug: "the-ask",
      witness: "#2440",
    });
  });

  it("refuses a settle naming no row", () => {
    expect(settlePlan({ positionals: [], values: { as: "answered", witness: "#1" } })).toEqual({
      refusal: "which ask? Pass its slug",
    });
  });

  it("refuses an --as outside the three endings", () => {
    expect(settlePlan({ positionals: ["the-ask"], values: { as: "closed", witness: "#1" } })).toEqual({
      refusal: "--as must be filed, answered or declined",
    });
  });

  it("refuses a blank witness", () => {
    expect(settlePlan({ positionals: ["the-ask"], values: { as: "filed", witness: "  " } })).toEqual({
      refusal: "--witness is required for --as filed — the doc slug, the permalink, or the anchor behind it",
    });
  });

  it("refuses a decline that says no why", () => {
    expect(settlePlan({ positionals: ["the-ask"], values: { as: "declined", witness: "talk:x" } })).toEqual({
      refusal: "--reason is required for --as declined — only the owner declines an ask, and a decline says why",
    });
  });
});
