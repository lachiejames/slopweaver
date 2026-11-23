/*
 * `parseRolloutObservation` — a healthy reading is an observation with no evidence, an exhausted one carries its
 * evidence, and a line with no `rate_limits` is no observation at all.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutObservation } from "../../../../codex/quotaLog.js";
import { REAL_HEALTHY_WEEKLY_LINE, REAL_USAGE_LIMIT_REACHED_LINE } from "../../../codexRolloutLines.js";

describe("parseRolloutObservation — a HEALTHY reading is a fact, not an absence", () => {
  it("reports a healthy line as an observation with no evidence, carrying its own scope and instant", () => {
    expect(parseRolloutObservation({ line: REAL_HEALTHY_WEEKLY_LINE })).toEqual({
      evidence: undefined,
      limitId: "codex",
      observedAtIso: "2026-09-13T05:51:14.803Z",
    });
  });

  it("reports an exhausted line as an observation CARRYING its evidence", () => {
    expect(parseRolloutObservation({ line: REAL_USAGE_LIMIT_REACHED_LINE })).toEqual({
      evidence: {
        kind: "usage-limit",
        limitId: "premium",
        observedAtIso: "2026-09-11T07:31:24.319Z",
      },
      limitId: "premium",
      observedAtIso: "2026-09-11T07:31:24.319Z",
    });
  });

  it("returns undefined for a line carrying no rate_limits at all — nobody looked, which is a third state", () => {
    const line = JSON.stringify({ payload: { type: "agent_message" }, timestamp: "2026-09-13T00:00:00.000Z" });

    expect(parseRolloutObservation({ line })).toBeUndefined();
  });
});
