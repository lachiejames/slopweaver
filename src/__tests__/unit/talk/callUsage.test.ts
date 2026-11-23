/*
 * A plan call's usage fold: one row per turn, the report taken latest winning at the turn's first position,
 * whatever order the lines reached the file in (what a call costs per turn as it ages).
 */
import { describe, expect, it } from "vitest";

import { type CallUsage, foldUsage } from "../../../talk/callUsage.js";

const COUNTS = { cachedInputTokens: 30, inputTokens: 41, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 44 };

/** One usage report, overridable. */
const usage = (over: Partial<CallUsage> = {}): CallUsage => ({
  atIso: "2026-09-28T06:00:00.000Z",
  contextWindow: 272_000,
  last: COUNTS,
  total: COUNTS,
  turnId: "u1",
  ...over,
});

describe("foldUsage", () => {
  it("keeps one row per turn, the later report replacing the earlier in place", () => {
    const usages: CallUsage[] = [];
    foldUsage({ entry: usage(), usages });
    foldUsage({ entry: usage({ atIso: "2026-09-28T06:00:05.000Z", turnId: "u2" }), usages });
    const later = usage({ atIso: "2026-09-28T06:00:09.000Z", total: { ...COUNTS, inputTokens: 90 } });
    foldUsage({ entry: later, usages });
    expect(usages.map((row) => [row.turnId, row.total.inputTokens])).toEqual([
      ["u1", 90],
      ["u2", 41],
    ]);
  });

  it("never lets an earlier report that landed late undo a later one", () => {
    const usages: CallUsage[] = [];
    foldUsage({ entry: usage({ atIso: "2026-09-28T06:00:09.000Z", contextWindow: null }), usages });
    foldUsage({ entry: usage(), usages });
    expect(usages).toEqual([usage({ atIso: "2026-09-28T06:00:09.000Z", contextWindow: null })]);
  });
});
