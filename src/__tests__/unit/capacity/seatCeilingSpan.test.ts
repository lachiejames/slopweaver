/**
 * `measureFleetCeiling` — pure. The span it is asked to measure must be two ISO instants in order; every other
 * input is irrelevant to that refusal, so each case passes none and the register's default thresholds.
 */
import { describe, expect, it } from "vitest";
import { measureFleetCeiling } from "../../../capacity/seatCeiling.js";
import { unwrapErr } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { HOUR_FROM, HOUR_TO, weekly } from "./seatCeilingFixtures.js";

describe("measureFleetCeiling — the span", () => {
  it("refuses a span whose end is before its start", () => {
    const result = measureFleetCeiling({
      plans: weekly("alpha"),
      fromIso: HOUR_TO,
      problems: [],
      samples: [],
      thresholds: DEFAULT_THRESHOLDS.claude,
      ticks: [],
      toIso: HOUR_FROM,
    });
    expect(unwrapErr(result)).toEqual([
      "the span 2026-10-04T01:00:00.000Z → 2026-10-04T00:00:00.000Z is not two ISO instants in order",
    ]);
  });

  it("refuses an empty span, whose two ends are the same instant", () => {
    const result = measureFleetCeiling({
      plans: weekly("alpha"),
      fromIso: HOUR_FROM,
      problems: [],
      samples: [],
      thresholds: DEFAULT_THRESHOLDS.claude,
      ticks: [],
      toIso: HOUR_FROM,
    });
    expect(unwrapErr(result)).toEqual([
      "the span 2026-10-04T00:00:00.000Z → 2026-10-04T00:00:00.000Z is not two ISO instants in order",
    ]);
  });

  it("refuses a span end that is not an instant", () => {
    const result = measureFleetCeiling({
      plans: weekly("alpha"),
      fromIso: HOUR_FROM,
      problems: [],
      samples: [],
      thresholds: DEFAULT_THRESHOLDS.claude,
      ticks: [],
      toIso: "next tuesday",
    });
    expect(unwrapErr(result)).toEqual([
      "the span 2026-10-04T00:00:00.000Z → next tuesday is not two ISO instants in order",
    ]);
  });
});
