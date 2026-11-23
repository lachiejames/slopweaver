/** The seat-ceiling document, folded into the tick's capacity observation. */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { capacityDocument, draftWithCeiling, seatCeilingDocument } from "../tickDraftDocumentsFixture.js";
import { factsOf, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — the seat ceiling, folded into capacity", () => {
  it("copies a measured ceiling's NUMBER into the capacity facts, and none of the runway behind it", () => {
    const sources = unwrap(
      draftWithCeiling({
        seatCeiling: seatCeilingDocument({
          ceiling: { burnPerWorkingSeatHour: 0.007, kind: "measured", plans: [], seats: 4, sustainable: 0.03 },
        }),
      }),
    );

    expect(factsOf({ observation: sources.capacity }).workingSeatCeiling).toStrictEqual({ kind: "measured", seats: 4 });
  });

  it("carries an unmeasurable ceiling's own reason", () => {
    const sources = unwrap(
      draftWithCeiling({
        seatCeiling: seatCeilingDocument({ ceiling: { kind: "unmeasurable", reason: "no plan was read" } }),
      }),
    );

    expect(factsOf({ observation: sources.capacity }).workingSeatCeiling).toStrictEqual({
      kind: "unmeasurable",
      reason: "no plan was read",
    });
  });

  it("keeps a ceiling measured before the tick started as unmeasurable, naming when it was taken", () => {
    const sources = unwrap(
      draftWithCeiling({
        seatCeiling: seatCeilingDocument({
          ceiling: { kind: "measured", seats: 4 },
          toIso: "2026-09-12T20:00:00.000Z",
        }),
      }),
    );

    expect(factsOf({ observation: sources.capacity }).workingSeatCeiling).toStrictEqual({
      kind: "unmeasurable",
      reason:
        "--seat-ceiling seat-ceiling.json was captured at 2026-09-12T20:00:00.000Z, before this tick started at " +
        "2026-09-12T21:18:42.000Z: a reading from another tick is not recorded as this one's",
    });
  });

  it("emits NO key when no seat ceiling was supplied, so an older capture judges as it did", () => {
    const sources = sourcesWith({ capture: capacityDocument(), kind: "capacity" });

    expect("workingSeatCeiling" in factsOf({ observation: sources.capacity })).toBe(false);
  });

  it("refuses the draft over a supplied ceiling document that is not the producer's", () => {
    const lines = unwrapErr(
      draftWithCeiling({ seatCeiling: seatCeilingDocument({ ceiling: { kind: "measured", seats: -1 } }) }),
    );

    expect(lines.join("\n")).toContain("--seat-ceiling seat-ceiling.json");
  });
});
